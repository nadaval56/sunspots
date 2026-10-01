"""One-off backfill (BRIEF §5.5).

    python -m pipeline.backfill --days 30                 # hourly frames + timelapse + json
    python -m pipeline.backfill --days 30 --archive-days 120
    SUNSPOTS_SYNTHETIC=1 python -m pipeline.backfill --days 30   # offline dev data
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from . import daily, ingest
from .storage import Storage, get_storage


FLUSH_EVERY = 24


def hourly_targets(now: datetime, days: int, step_hours: int = 1) -> list[datetime]:
    end = ingest.target_time(now)
    start = end - timedelta(days=days)
    out, t = [], start
    while t <= end:
        out.append(t)
        t += timedelta(hours=step_hours)
    return out


def run(
    storage: Storage,
    now: datetime,
    days: int,
    archive_days: int | None = None,
    step_hours: int = 1,
    timelapse: bool = True,
    fetch: ingest.Fetcher | None = None,
) -> dict:
    # Skip only hours already listed in the manifest. A frame file without a
    # manifest entry (e.g. a run killed by its timeout) is fetched again.
    manifest = ingest.get_json(storage, ingest.MANIFEST_KEY, {"frames": []}) or {"frames": []}
    existing = {f["key"] for f in manifest.get("frames", [])}
    new: list[dict] = []
    failed = skipped = 0
    for target in hourly_targets(now, days, step_hours):
        if any(k.startswith(f"frames/{target:%Y/%m/%d/%H}") for k in existing):
            skipped += 1
            continue
        entry = ingest.run(storage, target, now=now, fetch=fetch, write_manifest=False)
        if entry:
            new.append(entry)
            if len(new) % FLUSH_EVERY == 0:  # survive a CI timeout mid-run
                ingest.update_manifest(storage, new, now)
        else:
            failed += 1
    ingest.update_manifest(storage, new, now)

    archived = 0
    for i in range(archive_days if archive_days is not None else days, 0, -1):
        if daily.archive_day(storage, (now - timedelta(days=i)).date(), fetch):
            archived += 1

    tl = daily.build_timelapse(storage) if timelapse else None
    daily.build_today(storage, now, tl, [])
    daily.build_lab(storage, now)
    return {"stored": len(new), "failed": failed, "skipped": skipped, "archived": archived, "timelapse": tl}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--archive-days", type=int, help="daily archive depth (default: --days)")
    ap.add_argument("--step-hours", type=int, default=1)
    ap.add_argument("--no-timelapse", action="store_true")
    args = ap.parse_args(argv)
    res = run(
        get_storage(),
        datetime.now(timezone.utc),
        args.days,
        args.archive_days,
        args.step_hours,
        not args.no_timelapse,
    )
    print(res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
