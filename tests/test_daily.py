import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest

from pipeline import backfill, daily, ingest, noaa

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 9, 27, 1, 0, tzinfo=timezone.utc)


def test_parse_srs():
    srs = noaa.parse_srs((FIX / "srs_sample.txt").read_text())
    assert srs["issued"] == "2026-09-25T00:30:00Z"
    assert [r["region"] for r in srs["regions"]] == [4231, 4232, 4234, 4235]  # plage 4229 excluded
    r = srs["regions"][0]
    assert (r["lat"], r["lon"], r["area"], r["mcintosh"], r["spots"], r["mag"]) == (3, 24, 310, "Eki", 18, "Beta-Gamma")
    assert srs["regions"][2]["lat"] == -14 and srs["regions"][2]["lon"] == -35
    assert r["valid_at"] == "2026-09-25T00:00:00Z"


def test_parse_srs_none():
    text = "I.  Regions with Sunspots.  Locations Valid at 24/2400Z\nNmbr Location  Lo  Area  Z   LL   NN Mag Type\nNone\nIA. H-alpha"
    assert noaa.parse_srs(text)["regions"] == []


def test_parse_location():
    assert noaa.parse_location("S14E35") == (-14, -35)


@pytest.mark.parametrize("flux,cls", [(2.4e-6, "C2.4"), (1.1e-4, "X1.1"), (5e-5, "M5.0"), (3e-8, "A3.0")])
def test_flare_class(flux, cls):
    assert noaa.flare_class(flux) == cls


def test_regions_from_json_prefers_latest_and_skips_plage():
    rows = [
        {"observed_date": "2026-09-23", "region": 4200, "latitude": 1, "longitude": 2, "area": 10, "number_spots": 1},
        {"observed_date": "2026-09-24", "region": 4231, "location": "N03W24", "area": 310, "number_spots": 18},
        {"observed_date": "2026-09-24", "region": 4229, "location": "N18W82", "area": 0, "number_spots": 0},
    ]
    out = noaa.regions_from_json(rows)
    assert [r["region"] for r in out] == [4231] and out[0]["lat"] == 3 and out[0]["lon"] == 24


def test_regions_json_longitude_is_east_positive():
    # real row shape (2026-10-01): location N08W51 with longitude -51
    rows = [{"observed_date": "2026-09-02", "region": 4518, "latitude": 8, "longitude": -51, "area": 10, "number_spots": 2}]
    out = noaa.regions_from_json(rows)
    assert out[0]["lon"] == 51 and out[0]["valid_at"] == "2026-09-03T00:00:00Z"


def test_xray_series_long_channel_only():
    rows = [{"time_tag": f"2026-09-25T00:{m:02d}:00Z", "energy": e, "flux": 1e-6 * (m + 1)}
            for m in range(25) for e in ("0.05-0.4nm", "0.1-0.8nm")]
    rows.append({"time_tag": "2026-09-25T00:30:00Z", "energy": "0.1-0.8nm", "flux": 0.0})  # gap
    x = noaa.xray_series(rows, step=10)
    assert x["latest"]["t"] == "2026-09-25T00:24:00Z"
    assert len(x["series"]) == 4  # 0, 10, 20 + latest


@pytest.mark.skipif(not shutil.which("ffprobe"), reason="ffmpeg not installed")
def test_synthetic_backfill_builds_valid_timelapse(store, monkeypatch):
    monkeypatch.setenv("SUNSPOTS_SYNTHETIC", "1")
    res = backfill.run(store, NOW, days=2, archive_days=3, step_hours=4, fetch=ingest.synthetic_fetcher)
    assert res["stored"] == 13 and res["failed"] == 0 and res["archived"] == 3

    mp4 = store.root / "timelapse_30d.mp4"
    probe = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(mp4)]))
    v = probe["streams"][0]
    assert v["codec_name"] == "h264" and v["width"] == 1024 and v["pix_fmt"] == "yuv420p"
    head = mp4.read_bytes()[:4096]
    assert head.find(b"moov") != -1 and (head.find(b"mdat") == -1 or head.find(b"moov") < head.find(b"mdat"))
    assert (store.root / "timelapse_30d.webm").stat().st_size > 0
    assert (store.root / "timelapse_poster.webp").exists()

    today = json.loads((store.root / "today.json").read_text())
    assert today["image"]["source"] == "jsoc" and today["fallback_banner"] is None
    assert today["regions"] and today["timelapse"]["frames"] == 13

    lab = json.loads((store.root / "lab.json").read_text())
    assert [f["date"] for f in lab["frames"]] == ["2026-09-24", "2026-09-25", "2026-09-26"]
    assert all(abs(f["cx"] - 0.5) < 0.01 for f in lab["frames"])

    # rerun is idempotent: nothing new to fetch
    again = backfill.run(store, NOW, days=2, archive_days=0, step_hours=4, timelapse=False, fetch=ingest.synthetic_fetcher)
    assert again["stored"] == 0 and again["skipped"] == 13


def test_fallback_banner_in_today(store, monkeypatch):
    monkeypatch.setenv("SUNSPOTS_SYNTHETIC", "1")
    entry = {"t": "2026-09-27T00:30:00Z", "key": "frames/x.webp", "source": "sdo-1700", "cx": .5, "cy": .5, "r": .47, "b0": 7}
    ingest.update_manifest(store, entry, NOW)
    today = daily.build_today(store, NOW, None, [])
    assert "אולטרה-סגול" in today["fallback_banner"]
