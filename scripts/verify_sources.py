#!/usr/bin/env python3
"""M0: check every data URL from BRIEF §4 and print status, size and freshness.

    python scripts/verify_sources.py            # table to stdout
    python scripts/verify_sources.py --json     # machine-readable
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from pipeline import config, sources  # noqa: E402

NOAA = "https://services.swpc.noaa.gov"


def urls(now: datetime) -> list[tuple[str, str]]:
    y = now - timedelta(days=1)
    return [
        ("JSOC index (today)", sources.JSOC_IC_1K.index_url(now)),
        ("JSOC index (yesterday)", sources.JSOC_IC_1K.index_url(y)),
        ("SDO latest HMIIC 1024", f"{sources.SDO_LATEST}/latest_1024_HMIIC.jpg"),
        ("SDO latest 1700 1024", f"{sources.SDO_LATEST}/latest_1024_1700.jpg"),
        ("SDO browse index (today)", sources.SDO_HMIIC.index_url(now)),
        ("NOAA observed cycle", f"{NOAA}/json/solar-cycle/observed-solar-cycle-indices.json"),
        ("NOAA predicted cycle", f"{NOAA}/json/solar-cycle/predicted-solar-cycle.json"),
        ("NOAA daily SSN", f"{NOAA}/json/solar-cycle/swpc_observed_ssn.json"),
        ("NOAA SRS text", f"{NOAA}/text/srs.txt"),
        ("NOAA solar_regions.json", f"{NOAA}/json/solar_regions.json"),
        ("NOAA flare probabilities", f"{NOAA}/json/solar_probabilities.json"),
        ("GOES X-ray 1 day", f"{NOAA}/json/goes/primary/xrays-1-day.json"),
        ("SILSO daily CSV", "https://www.sidc.be/SILSO/INFO/sndtotcsv.php"),
    ]


def probe(name: str, url: str, now: datetime) -> dict:
    row = {"name": name, "url": url, "status": None, "bytes": None, "age_h": None, "note": ""}
    try:
        r = requests.get(url, timeout=config.HTTP_TIMEOUT, headers={"User-Agent": config.USER_AGENT})
        row["status"] = r.status_code
        row["bytes"] = len(r.content)
        lm = r.headers.get("Last-Modified")
        if lm:
            row["age_h"] = round((now - parsedate_to_datetime(lm)).total_seconds() / 3600, 1)
        ctype = r.headers.get("Content-Type", "")
        if "json" in ctype or url.endswith(".json"):
            try:
                data = r.json()
                sample = data[-1] if isinstance(data, list) and data else data
                keys = list(sample.keys())[:8] if isinstance(sample, dict) else type(sample).__name__
                row["note"] = f"json {len(data) if isinstance(data, list) else 1} items, keys={keys}"
            except ValueError:
                row["note"] = "invalid json"
        elif "html" in ctype:
            row["note"] = f"index, {r.text.count('.jpg')} jpg links"
    except requests.RequestException as e:
        row["note"] = f"error: {type(e).__name__}: {str(e)[:80]}"
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    now = datetime.now(timezone.utc)
    rows = [probe(n, u, now) for n, u in urls(now)]
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        print(f"Checked at {now:%Y-%m-%d %H:%M} UTC\n")
        print(f"| {'source':26} | status | {'bytes':>9} | {'age h':>6} | note")
        print(f"|{'-' * 28}|--------|{'-' * 11}|{'-' * 8}|------")
        for r in rows:
            print(
                f"| {r['name']:26} | {str(r['status'] or '-'):6} | {str(r['bytes'] or '-'):>9} "
                f"| {str(r['age_h'] if r['age_h'] is not None else '-'):>6} | {r['note']}"
            )
    return 0 if all(r["status"] == 200 for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
