"""Daily job (BRIEF §5.4): permanent archive frame, 30-day timelapse, today.json, lab.json.

    python -m pipeline.daily                      # everything, for yesterday
    python -m pipeline.daily --only timelapse
"""
from __future__ import annotations

import argparse
import io
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from . import config, ingest, noaa, process, solar, sources
from .storage import Storage, get_json, get_storage, put_json

DAILY_INDEX = "daily/index.json"
ARCHIVE_SIZE = 2048
ARCHIVE_CACHE = "public, max-age=31536000, immutable"
MEDIA_CACHE = "max-age=3600"
FALLBACK_BANNER = (
    "ערוץ האור הנראה אינו זמין זמנית. מוצגת תמונה באולטרה-סגול קרוב, "
    "שבה כתמי השמש כהים והאזורים הבהירים הם פקולות."
)


# --- 1. permanent daily archive -------------------------------------------------

def archive_day(storage: Storage, day: date, fetch: ingest.Fetcher | None = None) -> dict | None:
    target = datetime.combine(day, time(6), tzinfo=timezone.utc)
    acq, failures = ingest.acquire(target, sources.DAILY_CHAIN, fetch or ingest.default_fetcher())
    if not acq:
        print(f"daily archive {day}: no frame ({'; '.join(failures)})", file=sys.stderr)
        return None
    p = process.crop_and_mask(acq.frame.rgb, acq.frame.disk)
    size = min(ARCHIVE_SIZE, p.image.width)  # never upscale a 1k fallback
    base = f"daily/{day:%Y}/{day:%Y%m%d}"
    storage.put(f"{base}.webp", process.encode(p.image, size, "WEBP", 85), "image/webp", ARCHIVE_CACHE)
    storage.put(f"{base}.jpg", process.encode(p.image, size, "JPEG", 88), "image/jpeg", ARCHIVE_CACHE)
    entry = {
        "date": day.isoformat(),
        "t": ingest.iso(acq.time),
        "key": f"{base}.webp",
        "jpg": f"{base}.jpg",
        "size": size,
        "source": acq.spec.name,
        "product": acq.spec.product,
        "cx": round(p.cx, 5),
        "cy": round(p.cy, 5),
        "r": round(p.r, 5),
        "b0": round(solar.b0_deg(acq.time), 3),
    }
    index = get_json(storage, DAILY_INDEX, {"days": []})
    days = {d["date"]: d for d in index["days"]}
    days[entry["date"]] = entry
    put_json(storage, DAILY_INDEX, {"days": sorted(days.values(), key=lambda d: d["date"])})
    return entry


# --- 2. timelapse -----------------------------------------------------------------

def _font(size: int):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def _stamp(img: Image.Image, t: datetime) -> Image.Image:
    img = img.convert("RGB")
    d = ImageDraw.Draw(img)
    font = _font(max(14, img.width // 40))
    d.text((img.width * 0.025, img.height * 0.95), f"{t:%Y-%m-%d %H:%M} UTC", fill=(235, 235, 235), font=font, anchor="ls")
    return img


def _ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def build_timelapse(storage: Storage, workdir: Path | None = None) -> dict | None:
    manifest = get_json(storage, ingest.MANIFEST_KEY, {"frames": []})
    frames = manifest.get("frames", [])
    if not frames:
        print("timelapse: manifest is empty", file=sys.stderr)
        return None
    tmp = Path(workdir or tempfile.mkdtemp(prefix="timelapse-"))
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        n = 0
        last = None
        for f in frames:
            raw = storage.get(f["key"])
            if not raw:
                continue  # missing frame: skip silently
            img = _stamp(Image.open(io.BytesIO(raw)), ingest.parse_iso(f["t"]))
            img.save(tmp / f"{n:05d}.png")
            last = img
            n += 1
        if n == 0:
            return None
        mp4, webm = tmp / "timelapse_30d.mp4", tmp / "timelapse_30d.webm"
        pattern = ["-framerate", "24", "-pattern_type", "glob", "-i", str(tmp / "*.png")]
        _ffmpeg([*pattern, "-vf", "scale=1024:-2", "-c:v", "libx264", "-crf", "26", "-pix_fmt", "yuv420p",
                 "-movflags", "+faststart", str(mp4)])
        _ffmpeg([*pattern, "-vf", "scale=1024:-2", "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0",
                 "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-pix_fmt", "yuv420p", str(webm)])
        poster = io.BytesIO()
        last.save(poster, "WEBP", quality=80)

        storage.put("timelapse_30d.mp4", mp4.read_bytes(), "video/mp4", MEDIA_CACHE)
        storage.put("timelapse_30d.webm", webm.read_bytes(), "video/webm", MEDIA_CACHE)
        storage.put("timelapse_poster.webp", poster.getvalue(), "image/webp", MEDIA_CACHE)
        return {"frames": n, "from": frames[0]["t"], "to": frames[-1]["t"]}
    finally:
        if workdir is None:
            shutil.rmtree(tmp, ignore_errors=True)


# --- 3. today.json ------------------------------------------------------------------

def build_today(storage: Storage, now: datetime, timelapse: dict | None, errors: list[str]) -> dict:
    manifest = get_json(storage, ingest.MANIFEST_KEY, {}) or {}
    latest = manifest.get("latest")
    data = noaa.collect_today(errors) if not sources.synthetic_enabled() else _synthetic_noaa(now)
    today = {
        "generated_at": ingest.iso(now),
        "image": latest,
        "image_source": latest["source"] if latest else None,
        "fallback_banner": FALLBACK_BANNER if latest and latest["source"] == "sdo-1700" else None,
        "b0": round(solar.b0_deg(now), 3),
        **data,
        "timelapse": timelapse,
        "errors": errors,
    }
    put_json(storage, "today.json", today, "max-age=600")
    return today


def _synthetic_noaa(now: datetime) -> dict:
    """Offline stand-in so the site has data to render. Clearly labelled."""
    srs = noaa.parse_srs((Path(__file__).parent.parent / "tests/fixtures/srs_sample.txt").read_text())
    return {
        "synthetic": True,
        "sunspot_number": {"date": (now - timedelta(days=1)).date().isoformat(), "value": 112},
        "regions": srs["regions"],
        "regions_source": "synthetic (tests/fixtures/srs_sample.txt)",
        "flare_probability": {"date": now.date().isoformat(), "c": 75, "m": 25, "x": 5},
        "xray": {
            "latest": {"t": ingest.iso(now), "flux": 2.4e-6, "class": "C2.4"},
            "series": [[ingest.iso(now - timedelta(minutes=10 * i)), 1.2e-6 * (1.5 + (i % 17) / 10)] for i in range(144)][::-1],
        },
    }


# --- 3b. cycle.json ------------------------------------------------------------------

def build_cycle(storage: Storage, now: datetime, errors: list[str]) -> dict | None:
    """Cycles 24–25 observed vs. the NOAA prediction, for the cycle page.
    On failure the previous cycle.json stays in place."""
    if sources.synthetic_enabled():
        return None  # no offline stand-in: the page says the data is not available
    try:
        cycle = noaa.collect_cycle(errors)
    except Exception as e:  # noqa: BLE001
        errors.append(f"cycle: {e}")
        return None
    if not cycle or not (cycle["observed"] or cycle["predicted"]):
        return None
    cycle["generated_at"] = ingest.iso(now)
    put_json(storage, "cycle.json", cycle, "max-age=3600")
    return cycle


# --- 4. lab.json -----------------------------------------------------------------------

def build_lab(storage: Storage, now: datetime) -> dict:
    index = get_json(storage, DAILY_INDEX, {"days": []})
    days = index["days"][-config.LAB_DAYS :]
    lab = {
        "generated_at": ingest.iso(now),
        "frames": [
            {k: d[k] for k in ("date", "t", "key", "jpg", "source", "cx", "cy", "r", "b0")} for d in days
        ],
        "example_track": None,  # BRIEF §6.4, optional
    }
    put_json(storage, "lab.json", lab, "max-age=3600")
    return lab


def run(storage: Storage, now: datetime, only: str | None = None, archive: bool = True) -> dict:
    errors: list[str] = []
    result: dict = {}
    if archive and only in (None, "archive"):
        result["archive"] = archive_day(storage, (now - timedelta(days=1)).date())
    if only in (None, "timelapse"):
        result["timelapse"] = build_timelapse(storage)
    if only in (None, "cycle"):
        # before today.json, so its `errors` also records cycle failures
        result["cycle"] = build_cycle(storage, now, errors)
    if only in (None, "today"):
        result["today"] = build_today(storage, now, result.get("timelapse"), errors)
    if only in (None, "lab"):
        result["lab"] = build_lab(storage, now)
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", choices=["archive", "timelapse", "cycle", "today", "lab"])
    args = ap.parse_args(argv)
    res = run(get_storage(), ingest.utcnow(), args.only)
    print({k: (v if k not in ("today", "lab", "cycle") else ("written" if v else None)) for k, v in res.items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
