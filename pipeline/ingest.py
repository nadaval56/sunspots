"""Hourly ingest (BRIEF §5.1).

    python -m pipeline.ingest                 # current hour
    python -m pipeline.ingest --target 2026-09-23T06:00Z
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Iterator

from . import channels, config, noaa, process, solar, sources, synthetic
from .sources import SourceSpec
from .storage import Storage, get_json, get_storage, put_json
from .validate import ValidationError, ValidFrame, validate

MANIFEST_KEY = "manifest.json"
FRAME_CACHE = "public, max-age=31536000, immutable"
MAX_CANDIDATES_PER_SOURCE = 3

# (frame_time, http_status, bytes)
Download = tuple[datetime, int, bytes]
Fetcher = Callable[[SourceSpec, datetime], Iterable[Download]]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def target_time(now: datetime) -> datetime:
    """Last whole hour minus 30 minutes, so JSOC has time to publish."""
    return now.replace(minute=0, second=0, microsecond=0) - timedelta(minutes=30)


def http_fetcher(spec: SourceSpec, target: datetime) -> Iterator[Download]:
    for t, url in sources.candidates(spec, target)[:MAX_CANDIDATES_PER_SOURCE]:
        resp = sources.http_get(url)
        yield t, resp.status_code, resp.content


def synthetic_fetcher(spec: SourceSpec, target: datetime) -> Iterator[Download]:
    if spec.kind != "jsoc" or not spec.product.startswith("Ic"):
        return  # extra channels (pipeline/channels.py) have no synthetic stand-in
    t = target.replace(minute=(target.minute // 15) * 15, second=0, microsecond=0)
    size = 2048 if spec.size >= 2048 else 1024  # keep 4k synthetic renders cheap
    yield t, 200, synthetic.render_jpeg(t, size)


def default_fetcher() -> Fetcher:
    return synthetic_fetcher if sources.synthetic_enabled() else http_fetcher


@dataclass
class Acquired:
    spec: SourceSpec
    time: datetime
    frame: ValidFrame
    failures: list[str] = field(default_factory=list)


def acquire(target: datetime, chain: list[SourceSpec], fetch: Fetcher) -> tuple[Acquired | None, list[str]]:
    """Walk the fallback chain; return the first frame that passes validation."""
    failures: list[str] = []
    for spec in chain:
        name = f"{spec.name}:{spec.product}"
        try:
            got_any = False
            for t, status, data in fetch(spec, target):
                got_any = True
                try:
                    frame = validate(data, status, spec, t, target)
                    return Acquired(spec, t, frame, failures), failures
                except ValidationError as e:
                    failures.append(f"{name} {t:%Y%m%d_%H%M}: {e}")
            if not got_any:
                failures.append(f"{name}: no frame within ±30 min")
        except Exception as e:  # noqa: BLE001 - network errors mean "try next source"
            failures.append(f"{name}: {e}")
    return None, failures


def frame_key(t: datetime, suffix: str = "") -> str:
    return f"frames/{t:%Y/%m/%d/%H%M}{suffix}.webp"


def store_frame(storage: Storage, acq: Acquired) -> dict:
    p = process.crop_and_mask(acq.frame.rgb, acq.frame.disk)
    key = frame_key(acq.time)
    storage.put(key, process.encode(p.image, 1024), "image/webp", FRAME_CACHE)
    storage.put(frame_key(acq.time, "_512"), process.encode(p.image, 512), "image/webp", FRAME_CACHE)
    return {
        "t": iso(acq.time),
        "key": key,
        "source": acq.spec.name,
        "cx": round(p.cx, 5),
        "cy": round(p.cy, 5),
        "r": round(p.r, 5),
        "b0": round(solar.b0_deg(acq.time), 3),
    }


def update_manifest(storage: Storage, entries: dict | list[dict] | None, now: datetime) -> dict:
    m = get_json(storage, MANIFEST_KEY, {"frames": []})
    frames = {f["key"]: f for f in m.get("frames", [])}
    for e in [entries] if isinstance(entries, dict) else entries or []:
        frames[e["key"]] = e
    cutoff = now - timedelta(days=config.ROLLING_DAYS)
    kept = sorted((f for f in frames.values() if parse_iso(f["t"]) >= cutoff), key=lambda f: f["t"])
    latest = kept[-1] if kept else None
    manifest = {
        "generated_at": iso(now),
        "latest": latest,
        "fallback": bool(latest and latest["source"] == "sdo-1700"),
        "frames": kept,
    }
    put_json(storage, MANIFEST_KEY, manifest, "max-age=300")
    return manifest


def prune(storage: Storage, now: datetime) -> list[str]:
    """Delete hourly frames older than 31 days. Never touches daily/."""
    cutoff = (now - timedelta(days=config.DELETE_AFTER_DAYS)).strftime("%Y/%m/%d")
    removed = []
    for key in storage.list("frames/"):
        day = "/".join(key.split("/")[1:4])
        if day < cutoff:
            storage.delete(key)
            removed.append(key)
    return removed


def append_log(storage: Storage, now: datetime, record: dict) -> None:
    key = f"logs/ingest/{now:%Y-%m}.jsonl"
    prev = storage.get(key) or b""
    line = json.dumps(record, ensure_ascii=False).encode() + b"\n"
    storage.put(key, prev + line, "application/x-ndjson")


def run(
    storage: Storage,
    target: datetime,
    now: datetime | None = None,
    fetch: Fetcher | None = None,
    chain: list[SourceSpec] | None = None,
    write_manifest: bool = True,
    with_channels: bool | None = None,
) -> dict | None:
    """Ingest one hour. with_channels (default: write_manifest) also refreshes
    the extra channels in latest/ (pipeline/channels.py); they never affect
    the main frame or the return value."""
    now = now or utcnow()
    fetch = fetch or default_fetcher()
    acq, failures = acquire(target, chain or sources.HOURLY_CHAIN, fetch)
    entry = store_frame(storage, acq) if acq else None
    if write_manifest:
        update_manifest(storage, entry, now)
        prune(storage, now)
    record = {
        "at": iso(now),
        "target": iso(target),
        "ok": entry is not None,
        "source": entry["source"] if entry else None,
        "frame": entry["t"] if entry else None,
        "failures": failures,
    }
    if write_manifest if with_channels is None else with_channels:
        record["channels"] = run_channels(storage, entry, acq, target, now, fetch)
    append_log(storage, now, record)
    return entry


def run_channels(
    storage: Storage, entry: dict | None, acq: Acquired | None, target: datetime, now: datetime, fetch: Fetcher
) -> dict:
    # The continuum disk doubles as the magnetogram's geometry only when both
    # are JSOC 1k HMI quick-looks (identical framing at the same time).
    hmi_disk = acq.frame.disk if acq and acq.spec == sources.JSOC_IC_1K else None
    try:
        return channels.run(storage, entry, target, now, fetch, hmi_disk)
    except Exception as e:  # noqa: BLE001 - extra channels must never fail the run
        return {"error": str(e)}


XRAY_KEY = "xray.json"


def refresh_xray(storage: Storage, now: datetime | None = None) -> str | None:
    """Hourly copy of the GOES X-ray curve for the home page, so it is never more
    than an hour old (today.json is rebuilt only once a day). 49 hours from the
    3-day file: the page shows all of yesterday plus today, on the Israel clock.
    Returns an error message, or None. Never raises: the graph must not fail the ingest."""
    if sources.synthetic_enabled():
        return None
    try:
        x = noaa.xray_series(noaa._get_json(noaa.URLS["xrays_3day"]), hours=49)
    except Exception as e:  # noqa: BLE001
        return f"xrays: {e}"
    if not x:
        return "xrays: no valid samples"
    put_json(storage, XRAY_KEY, {"generated_at": iso(now or utcnow()), **x}, "max-age=300")
    return None


REGIONS_KEY = "regions.json"
REGIONS_KEEP_HOURS = 36  # how long a fuller previous list beats a suspiciously short new one


def accept_regions(new: list[dict], prev: dict | None, now: datetime) -> str | None:
    """Why the new list must not replace prev, or None to accept it.

    NOAA's feed is read hourly now, so a half-written day must not wipe markers
    off the plate: an empty or less-than-half list is held back while the
    previous one is under REGIONS_KEEP_HOURS old. An older day never wins."""
    if not prev or not prev.get("regions"):
        return None if new else "empty"
    if new and new[0].get("valid_at", "") < prev.get("valid_at", ""):
        return f"older than {prev['valid_at']}"
    fresh = now - parse_iso(prev["generated_at"]) < timedelta(hours=REGIONS_KEEP_HOURS)
    if fresh and len(new) * 2 < len(prev["regions"]):
        return f"{len(new)} regions after {len(prev['regions'])}"
    return None


def refresh_regions(storage: Storage, now: datetime | None = None) -> str | None:
    """Hourly copy of NOAA's active regions, so a region numbered during the day is
    marked on the plate within the hour (today.json is rebuilt only once a day).
    Returns an error message, or None. Never raises: it must not fail the ingest."""
    if sources.synthetic_enabled():
        return None
    now = now or utcnow()
    try:
        regions = noaa.regions_from_json(noaa._get_json(noaa.URLS["regions"]))
    except Exception as e:  # noqa: BLE001
        return f"regions: {e}"
    why = accept_regions(regions, get_json(storage, REGIONS_KEY), now)
    if why:
        return f"regions: kept the previous list ({why})"
    valid_at = regions[0]["valid_at"] if regions else None
    put_json(storage, REGIONS_KEY, {"generated_at": iso(now), "valid_at": valid_at, "source": "solar_regions.json", "regions": regions}, "max-age=300")
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--target", help="ISO UTC time; default: last hour − 30 min")
    args = ap.parse_args(argv)
    now = utcnow()
    target = parse_iso(args.target) if args.target else target_time(now)
    storage = get_storage()
    entry = run(storage, target, now)
    for error in (refresh_xray(storage, now), refresh_regions(storage, now)):
        if error:
            print(f"ingest: {error}", file=sys.stderr)
    if entry is None:
        print(f"ingest: no valid frame for {iso(target)}", file=sys.stderr)
        return 1
    print(f"ingest: stored {entry['key']} from {entry['source']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
