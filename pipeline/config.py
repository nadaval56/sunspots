"""Runtime configuration from environment variables."""
from __future__ import annotations

import os
from pathlib import Path

DOMAIN = os.environ.get("SUNSPOTS_DOMAIN", "sunspots.co.il")
USER_AGENT = f"SunspotsEdu/1.0 (+https://{DOMAIN}/about)"

STORAGE = os.environ.get("STORAGE", "local")  # local | r2
LOCAL_MEDIA_DIR = Path(os.environ.get("LOCAL_MEDIA_DIR", "media-local"))

# R2 (S3 API). Filled from GitHub secrets in CI — see docs/HUMAN_TODO.md.
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.environ.get("R2_BUCKET", "sunspots-media")

HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT", "30"))
HTTP_RETRIES = 2  # BRIEF §1: retry twice with a pause, then fall back
HTTP_RETRY_PAUSE = float(os.environ.get("HTTP_RETRY_PAUSE", "5"))

ROLLING_DAYS = 30  # manifest window
DELETE_AFTER_DAYS = 31  # hourly frames older than this are removed
LAB_DAYS = 14
