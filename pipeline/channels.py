"""Extra image channels ("filters") for the home page.

Each hourly ingest also stores the latest magnetogram and AIA 171/304/1700
frames, taken near the continuum frame's time, cropped to the same framing
(square of side 2·1.05·R, disk centred) so overlays line up when the visitor
switches channels. Only the latest image per channel is kept:

    latest/<id>.webp, latest/<id>_512.webp, latest/channels.json

The continuum entry points at the hourly frame itself (no copy). An extra
channel that is stale, missing or invalid is skipped; it never fails the run.
See docs/DECISIONS.md (#45–#49).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable

from . import process, solar, sources
from .sources import SourceSpec
from .storage import Storage, get_json, put_json
from .validate import ValidationError, ValidFrame, validate_channel

CHANNELS_KEY = "latest/channels.json"
LATEST_CACHE = "public, max-age=300"
KEEP_FOR = timedelta(hours=6)  # a failed channel keeps its previous entry this long
# The continuum entry must really be visible light; an sdo-1700 fallback frame
# is not listed as "אור נראה".
CONTINUUM_SOURCES = {"jsoc", "sdo-hmi"}

Fetcher = Callable[[SourceSpec, datetime], Iterable[tuple[datetime, int, bytes]]]


@dataclass(frozen=True)
class Channel:
    id: str
    label: str
    note: str
    spec: SourceSpec | None = None  # None: the hourly continuum frame
    fit: bool = False  # Kåsa fit (HMI) vs known geometry (AIA)
    mask: bool = False  # black out beyond 1.012R like the continuum frame


CHANNELS: list[Channel] = [
    Channel(
        "continuum",
        "אור נראה",
        "פני השמש (הפוטוספרה) באור נראה, בצבע מלאכותי. כתמי השמש כהים כי הם קרים יותר מהסביבה שלהם.",
    ),
    Channel(
        "magnetogram",
        "שדה מגנטי",
        "מפת השדה המגנטי: לבן הוא שדה שמצביע אלינו, שחור הוא שדה שמצביע הרחק מאיתנו, ואפור הוא שדה חלש. ליד כל קבוצת כתמים יש אזורים לבנים ושחורים צמודים.",
        sources.JSOC_M_1K,
        fit=True,
        mask=True,
    ),
    Channel(
        "aia171",
        "עטרה (171 Å)",
        "אולטרה-סגול קיצוני: גז בטמפרטורה של כ-600,000 מעלות בעטרה, שזורם בלולאות לאורך קווי השדה המגנטי מעל האזורים הפעילים.",
        sources.SDO_0171,
    ),
    Channel(
        "aia304",
        "כרומוספרה (304 Å)",
        "אולטרה-סגול קיצוני: הכרומוספרה ושכבת המעבר שמעליה, בטמפרטורה של כ-50,000 מעלות. בשוליים נראות לפעמים בליטות (פרומיננסים) של גז מעל פני השמש.",
        sources.SDO_0304,
    ),
    Channel(
        "aia1700",
        "אולטרה-סגול (1700 Å)",
        "אולטרה-סגול: פני השמש והשכבה שמעליהם. כתמי השמש כהים, והאזורים הבהירים סביבם הם פקולות, מקומות שבהם השדה המגנטי מרוכז.",
        sources.SDO_1700,
    ),
]


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def latest_key(cid: str, suffix: str = "") -> str:
    return f"latest/{cid}{suffix}.webp"


def continuum_entry(frame: dict | None) -> dict | None:
    """channels.json entry for the hourly frame (a manifest entry); no copy."""
    if not frame or frame.get("source") not in CONTINUUM_SOURCES:
        return None
    ch = CHANNELS[0]
    return {
        "id": ch.id,
        "label": ch.label,
        "t": frame["t"],
        "key": frame["key"],
        "key_512": frame["key"].replace(".webp", "_512.webp"),
        "source": frame["source"],
        "cx": frame["cx"],
        "cy": frame["cy"],
        "r": frame["r"],
        "b0": frame["b0"],
        "note": ch.note,
    }


def acquire(
    ch: Channel, ref: datetime, fetch: Fetcher, fallback_disk: solar.Disk | None
) -> tuple[datetime | None, ValidFrame | None, list[str]]:
    failures: list[str] = []
    try:
        got_any = False
        for t, status, data in fetch(ch.spec, ref):
            got_any = True
            try:
                return t, validate_channel(data, status, ch.spec, t, ref, ch.fit, fallback_disk), failures
            except ValidationError as e:
                failures.append(f"{t:%Y%m%d_%H%M}: {e}")
        if not got_any:
            failures.append("no frame within ±30 min")
    except Exception as e:  # noqa: BLE001 - network errors skip this channel only
        failures.append(str(e))
    return None, None, failures


def store(storage: Storage, ch: Channel, t: datetime, frame: ValidFrame) -> dict:
    p = process.crop_and_mask(frame.rgb, frame.disk, mask=ch.mask)
    key, key_512 = latest_key(ch.id), latest_key(ch.id, "_512")
    storage.put(key, process.encode(p.image, 1024), "image/webp", LATEST_CACHE)
    storage.put(key_512, process.encode(p.image, 512), "image/webp", LATEST_CACHE)
    return {
        "id": ch.id,
        "label": ch.label,
        "t": iso(t),
        "key": key,
        "key_512": key_512,
        "source": ch.spec.name,
        "cx": round(p.cx, 5),
        "cy": round(p.cy, 5),
        "r": round(p.r, 5),
        "b0": round(solar.b0_deg(t), 3),
        "note": ch.note,
    }


def merge(previous: dict | None, fresh: dict[str, dict], now: datetime) -> list[dict]:
    """Fresh entries win; otherwise keep a previous entry younger than KEEP_FOR."""
    prev = {e["id"]: e for e in (previous or {}).get("channels", [])}
    out = []
    for ch in CHANNELS:
        e = fresh.get(ch.id)
        if e is None and ch.id in prev and now - parse_iso(prev[ch.id]["t"]) < KEEP_FOR:
            e = prev[ch.id]
        if e is not None:
            out.append(e)
    return out


def run(
    storage: Storage,
    continuum: dict | None,
    target: datetime,
    now: datetime,
    fetch: Fetcher,
    continuum_disk: solar.Disk | None = None,
) -> dict[str, dict]:
    """Fetch, store and index the extra channels. Returns a per-channel log record.

    continuum: this hour's frame (manifest entry) or None if it failed.
    continuum_disk: its disk in source pixels, used as the magnetogram's
    geometry if the magnetogram's own fit fails (same HMI geometry).
    """
    ref = parse_iso(continuum["t"]) if continuum else target
    fresh: dict[str, dict] = {}
    log: dict[str, dict] = {}
    c = continuum_entry(continuum)
    if c:
        fresh["continuum"] = c
    for ch in CHANNELS[1:]:
        t, frame, failures = acquire(ch, ref, fetch, continuum_disk if ch.fit else None)
        rec: dict = {"ok": False, "frame": None, "failures": failures}
        if frame is not None:
            try:
                fresh[ch.id] = store(storage, ch, t, frame)
                rec.update(ok=True, frame=iso(t), geometry=frame.geometry)
            except Exception as e:  # noqa: BLE001 - a storage error skips this channel only
                failures.append(f"store: {e}")
        log[ch.id] = rec
    channels = merge(get_json(storage, CHANNELS_KEY), fresh, now)
    put_json(storage, CHANNELS_KEY, {"generated_at": iso(now), "channels": channels}, "max-age=300")
    for ch_id, rec in log.items():
        if not rec["ok"]:
            rec["kept_previous"] = any(e["id"] == ch_id for e in channels)
    return log
