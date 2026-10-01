"""Image sources and the fallback chain (BRIEF §4.1, §4.2)."""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

from . import config

JSOC_BASE = "https://jsoc1.stanford.edu/data/hmi/images"
SDO_BROWSE = "https://sdo.gsfc.nasa.gov/assets/img/browse"
SDO_LATEST = "https://sdo.gsfc.nasa.gov/assets/img/latest"


@dataclass(frozen=True)
class SourceSpec:
    name: str  # stored in manifest.source
    kind: str  # jsoc | sdo | synthetic
    product: str  # JSOC product suffix or SDO channel
    size: int  # nominal image width in px
    ref_radius_1au: float  # expected disk radius in px at 1 AU (scaled by 1/distance)
    fallback_banner: bool = False

    def index_url(self, day: datetime) -> str:
        if self.kind == "jsoc":
            return f"{JSOC_BASE}/{day:%Y/%m/%d}/"
        return f"{SDO_BROWSE}/{day:%Y/%m/%d}/"

    @property
    def filename_re(self) -> re.Pattern:
        if self.kind == "jsoc":
            return re.compile(rf"(\d{{8}}_\d{{6}})_{re.escape(self.product)}\.jpg")
        return re.compile(rf"(\d{{8}}_\d{{6}})_{self.size}_{re.escape(self.product)}\.jpg")

    def file_url(self, stamp: str) -> str:
        day = datetime.strptime(stamp, "%Y%m%d_%H%M%S")
        if self.kind == "jsoc":
            return f"{JSOC_BASE}/{day:%Y/%m/%d}/{stamp}_{self.product}.jpg"
        return f"{SDO_BROWSE}/{day:%Y/%m/%d}/{stamp}_{self.size}_{self.product}.jpg"


# Disk radius at 1 AU in a 1024 px frame, measured on real frames 2026-10-01
# (Kåsa fit × Earth–Sun distance): JSOC Ic_1k and SDO HMIIC 475.2, AIA 1700 400.0.
HMI_R_1AU = 475.2
AIA_R_1AU = 400.0
JSOC_IC_1K = SourceSpec("jsoc", "jsoc", "Ic_1k", 1024, HMI_R_1AU)
JSOC_IC_4K = SourceSpec("jsoc", "jsoc", "Ic_4k", 4096, HMI_R_1AU * 4)
SDO_HMIIC = SourceSpec("sdo-hmi", "sdo", "HMIIC", 1024, HMI_R_1AU)
SDO_1700 = SourceSpec("sdo-1700", "sdo", "1700", 1024, AIA_R_1AU, fallback_banner=True)

HOURLY_CHAIN = [JSOC_IC_1K, SDO_HMIIC, SDO_1700]
DAILY_CHAIN = [JSOC_IC_4K, JSOC_IC_1K, SDO_HMIIC, SDO_1700]

# Extra "filters" for the home page (pipeline/channels.py). Latest frame only.
JSOC_M_1K = SourceSpec("jsoc-m", "jsoc", "M_1k", 1024, HMI_R_1AU)
SDO_0171 = SourceSpec("sdo-171", "sdo", "0171", 1024, AIA_R_1AU)
SDO_0304 = SourceSpec("sdo-304", "sdo", "0304", 1024, AIA_R_1AU)


def synthetic_enabled() -> bool:
    return os.environ.get("SUNSPOTS_SYNTHETIC") == "1"


_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers["User-Agent"] = config.USER_AGENT
    return _session


def http_get(url: str) -> requests.Response:
    """GET with BRIEF §1 retry policy: two retries with a pause, then raise."""
    last: Exception | None = None
    for attempt in range(config.HTTP_RETRIES + 1):
        try:
            resp = session().get(url, timeout=config.HTTP_TIMEOUT)
            if resp.status_code < 500:
                return resp
            last = RuntimeError(f"HTTP {resp.status_code}")
        except requests.RequestException as e:
            last = e
        if attempt < config.HTTP_RETRIES:
            time.sleep(config.HTTP_RETRY_PAUSE)
    raise RuntimeError(f"GET {url} failed: {last}")


def parse_stamp(stamp: str) -> datetime:
    return datetime.strptime(stamp, "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)


def list_available(spec: SourceSpec, day: datetime) -> list[tuple[datetime, str]]:
    """Parse the per-day directory index into (time, url) pairs."""
    resp = http_get(spec.index_url(day))
    if resp.status_code != 200:
        return []
    stamps = sorted(set(spec.filename_re.findall(resp.text)))
    return [(parse_stamp(s), spec.file_url(s)) for s in stamps]


def candidates(
    spec: SourceSpec, target: datetime, tolerance: timedelta = timedelta(minutes=30)
) -> list[tuple[datetime, str]]:
    """Frames within ±tolerance of target, closest first."""
    days = {(target - tolerance).date(), (target + tolerance).date()}
    found: list[tuple[datetime, str]] = []
    for d in sorted(days):
        found.extend(list_available(spec, datetime(d.year, d.month, d.day, tzinfo=timezone.utc)))
    near = [(t, u) for t, u in found if abs(t - target) <= tolerance]
    return sorted(near, key=lambda tu: abs(tu[0] - target))
