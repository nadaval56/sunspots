#!/usr/bin/env python3
"""Verify the R2 setup end to end (docs/R2_SETUP.md, step 8).

Reads the same environment variables as the pipeline. Prints one line per
check and exits non-zero if any check fails. Never prints secret values.

    R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=sunspots-media \
    PUBLIC_MEDIA_BASE=https://pub-xxxx.r2.dev SITE_ORIGIN=https://nadaval56.github.io \
    python scripts/check_r2.py
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from pipeline import config  # noqa: E402

KEY = "healthcheck/r2-check.json"
results: list[tuple[bool, str]] = []


def check(ok: bool, msg: str) -> bool:
    results.append((ok, msg))
    print(("✅ " if ok else "❌ ") + msg)
    return ok


def main() -> int:
    missing = [n for n in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY") if not os.environ.get(n)]
    if not check(not missing, "secrets present" + (f" (missing: {', '.join(missing)})" if missing else "")):
        return 1
    check(len(config.R2_ACCOUNT_ID) == 32, "R2_ACCOUNT_ID looks like an account id (32 hex characters)")

    from pipeline.storage import R2Storage

    try:
        s = R2Storage()
    except Exception as e:  # noqa: BLE001
        check(False, f"connect to bucket '{config.R2_BUCKET}': {e}")
        return 1

    body = f'{{"checked_at": {int(time.time())}}}'.encode()
    try:
        s.put(KEY, body, "application/json", "no-store")
        check(True, f"write to bucket '{config.R2_BUCKET}'")
    except Exception as e:  # noqa: BLE001
        check(False, f"write to bucket '{config.R2_BUCKET}': {type(e).__name__}: {e}")
        return 1
    check(s.get(KEY) == body, "read back the same bytes")
    check(KEY in s.list("healthcheck/"), "list objects")

    base = os.environ.get("PUBLIC_MEDIA_BASE", "").rstrip("/")
    if base and "sunspots.example" not in base:
        url = f"{base}/{KEY}"
        origin = os.environ.get("SITE_ORIGIN", "")
        try:
            r = requests.get(url, headers={"Origin": origin} if origin else {}, timeout=20)
            check(r.status_code == 200 and r.content == body, f"public URL serves the object ({url} → HTTP {r.status_code})")
            if origin:
                allow = r.headers.get("Access-Control-Allow-Origin", "")
                check(allow in (origin, "*"), f"CORS allows {origin} (got '{allow or 'nothing'}')")
        except requests.RequestException as e:
            check(False, f"public URL {url}: {e}")
    else:
        print("ℹ️  PUBLIC_MEDIA_BASE not set: skipping the public-access and CORS checks")

    s.delete(KEY)
    failed = [m for ok, m in results if not ok]
    print("\nAll checks passed." if not failed else f"\n{len(failed)} check(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
