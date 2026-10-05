import io
import json
from datetime import timedelta

import numpy as np
import pytest
from PIL import Image, ImageDraw

from pipeline import channels, ingest, solar, sources, synthetic
from pipeline.validate import ValidationError, expected_radius, validate_channel

from .conftest import T, jpeg

AIA_R = expected_radius(sources.SDO_0171, T, 1024)


def aia_frame(corona: bool = True) -> np.ndarray:
    """SDO-browse-like frame: disk centred at (511.5, 511.5), R from AIA_R_1AU,
    a faint corona out to ~1.1R and a label at the bottom."""
    rng = np.random.default_rng(1)
    im = Image.new("RGB", (1024, 1024), "black")
    d = ImageDraw.Draw(im)
    c = 511.5
    if corona:
        r = 1.1 * AIA_R
        d.ellipse([c - r, c - r, c + r, c + r], fill=(60, 40, 0))
    d.ellipse([c - AIA_R, c - AIA_R, c + AIA_R, c + AIA_R], fill=(170, 120, 10))
    d.text((40, 990), "SDO/AIA 171 2026-09-25 06:00:00 UT", fill="white")
    rgb = np.asarray(im).astype(np.int16)
    rgb = rgb + rng.integers(-12, 12, size=rgb.shape) * (rgb > 0)  # texture, >40KB
    return np.clip(rgb, 0, 255).astype(np.uint8)


def make_fetcher(per_spec):
    """per_spec: {SourceSpec.name: [(t, status, bytes)] | Exception}; Ic falls back to synthetic."""
    def fetch(spec, target):
        got = per_spec.get(spec.name)
        if isinstance(got, Exception):
            raise got
        if got is None and spec.kind == "jsoc" and spec.product.startswith("Ic"):
            yield from ingest.synthetic_fetcher(spec, target)
            return
        yield from got or []
    return fetch


# --- geometry ---------------------------------------------------------------------

def test_aia_crop_geometry_matches_continuum_framing(store):
    frame = validate_channel(jpeg(aia_frame()), 200, sources.SDO_0171, T, T, fit=False)
    assert frame.geometry == "known"
    assert frame.disk.cx == pytest.approx(511.5) and frame.disk.r == pytest.approx(AIA_R)
    e = channels.store(store, channels.CHANNELS[2], T, frame)
    assert e["cx"] == pytest.approx(0.5, abs=0.002)
    assert e["cy"] == pytest.approx(0.5, abs=0.002)
    assert e["r"] == pytest.approx(1 / 2.1, abs=0.002)
    assert e["key"] == "latest/aia171.webp" and store.get("latest/aia171_512.webp")
    # AIA is cropped, not masked: the corona just above the limb survives.
    im = np.asarray(Image.open(io.BytesIO(store.get(e["key"]))).convert("L"))
    y = int(e["cy"] * 1024)
    x = int((e["cx"] + 1.03 * e["r"]) * 1024)
    assert im[y, x] > 20


def test_magnetogram_is_masked_and_falls_back_to_continuum_disk(store):
    # An AIA-sized disk fails the HMI radius check; the continuum disk is used instead.
    hmi_disk = solar.Disk(511.5, 511.5, AIA_R)
    frame = validate_channel(jpeg(aia_frame()), 200, sources.JSOC_M_1K, T, T, fit=True, fallback_disk=hmi_disk)
    assert frame.geometry == "continuum"
    with pytest.raises(ValidationError, match="disk fit"):
        validate_channel(jpeg(aia_frame()), 200, sources.JSOC_M_1K, T, T, fit=True)
    e = channels.store(store, channels.CHANNELS[1], T, frame)
    im = np.asarray(Image.open(io.BytesIO(store.get(e["key"]))).convert("L"))
    assert im[int(e["cy"] * 1024), int((e["cx"] + 1.03 * e["r"]) * 1024)] == 0


def test_real_hmi_magnetogram_fit_matches_synthetic_geometry():
    rgb = synthetic.render(T)
    grey = np.repeat(rgb.mean(axis=-1, keepdims=True), 3, axis=-1).astype(np.uint8)
    frame = validate_channel(jpeg(grey), 200, sources.JSOC_M_1K, T, T, fit=True)
    assert frame.geometry == "fit"


def test_saturated_and_blank_aia_rejected(saturated_4500_jpeg):
    with pytest.raises(ValidationError, match="saturated"):
        validate_channel(saturated_4500_jpeg, 200, sources.SDO_1700, T, T, fit=False)
    rng = np.random.default_rng(2)
    grey = rng.integers(90, 110, size=(1024, 1024, 3), dtype=np.uint8)
    with pytest.raises(ValidationError, match="no disk"):
        validate_channel(jpeg(grey), 200, sources.SDO_0304, T, T, fit=False)


# --- ingest integration -------------------------------------------------------------

def test_stale_or_missing_channel_is_skipped_without_failing_ingest(store):
    good = jpeg(aia_frame())
    fetch = make_fetcher({
        "jsoc-m": [(T - timedelta(hours=3), 200, good)],  # stale
        "sdo-171": [],  # missing
        "sdo-304": RuntimeError("connection reset"),
        "sdo-1700": [(T + timedelta(minutes=2), 200, good)],
    })
    entry = ingest.run(store, T, now=T, fetch=fetch)
    assert entry is not None and entry["source"] == "jsoc"
    idx = ingest.get_json(store, channels.CHANNELS_KEY)
    assert [c["id"] for c in idx["channels"]] == ["continuum", "aia1700"]
    manifest = ingest.get_json(store, "manifest.json")  # main frame still published
    assert manifest["latest"]["key"] == entry["key"]
    rec = [json.loads(l) for l in store.get(f"logs/ingest/{T:%Y-%m}.jsonl").splitlines()][-1]
    assert rec["ok"] is True
    ch = rec["channels"]
    assert ch["aia1700"]["ok"] and not ch["magnetogram"]["ok"]
    assert "stale" in ch["magnetogram"]["failures"][0]
    assert "no frame" in ch["aia171"]["failures"][0]
    assert "connection reset" in ch["aia304"]["failures"][0]


def test_channel_errors_never_change_main_frame(store, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("channels exploded")
    monkeypatch.setattr(channels, "run", boom)
    entry = ingest.run(store, T, now=T, fetch=ingest.synthetic_fetcher)
    assert entry["key"] == "frames/2026/09/25/0600.webp"


def test_synthetic_mode_publishes_continuum_only(store):
    entry = ingest.run(store, T, now=T, fetch=ingest.synthetic_fetcher)
    idx = ingest.get_json(store, channels.CHANNELS_KEY)
    assert [c["id"] for c in idx["channels"]] == ["continuum"]
    c = idx["channels"][0]
    assert c["key"] == entry["key"] == "frames/2026/09/25/0600.webp"
    assert c["key_512"] == "frames/2026/09/25/0600_512.webp"
    assert (c["cx"], c["cy"], c["r"], c["b0"]) == (entry["cx"], entry["cy"], entry["r"], entry["b0"])
    assert c["label"] == "אור נראה" and c["note"]
    assert not store.list("latest/continuum")  # no copy


def test_no_channels_when_manifest_not_written(store):
    ingest.run(store, T, now=T, fetch=ingest.synthetic_fetcher, write_manifest=False)
    assert store.get(channels.CHANNELS_KEY) is None


def test_fallback_1700_frame_is_not_listed_as_visible_light():
    e = {"t": "2026-09-25T06:00:00Z", "key": "frames/x.webp", "source": "sdo-1700",
         "cx": 0.5, "cy": 0.5, "r": 0.476, "b0": 7.0}
    assert channels.continuum_entry(e) is None
    assert channels.continuum_entry({**e, "source": "jsoc"})["id"] == "continuum"


# --- channels.json merge -------------------------------------------------------------

def test_merge_keeps_recent_previous_entry_and_drops_old():
    now = T
    prev = {"channels": [
        {"id": "continuum", "t": "2026-09-25T05:00:00Z", "key": "frames/old.webp"},
        {"id": "magnetogram", "t": "2026-09-25T00:30:00Z"},  # 5.5 h old: kept
        {"id": "aia171", "t": "2026-09-24T23:30:00Z"},  # 6.5 h old: dropped
        {"id": "aia304", "t": "2026-09-25T05:30:00Z"},
    ]}
    fresh = {
        "continuum": {"id": "continuum", "t": "2026-09-25T06:00:00Z", "key": "frames/new.webp"},
        "aia1700": {"id": "aia1700", "t": "2026-09-25T06:02:00Z"},
    }
    out = channels.merge(prev, fresh, now)
    assert [e["id"] for e in out] == ["continuum", "magnetogram", "aia304", "aia1700"]
    assert out[0]["key"] == "frames/new.webp"
    assert channels.merge(None, {}, now) == []


def test_failed_hour_keeps_previous_channels_json_entries(store):
    good = jpeg(aia_frame())
    ok = make_fetcher({"sdo-171": [(T, 200, good)]})
    ingest.run(store, T, now=T, fetch=ok)
    later = T + timedelta(hours=2)
    ingest.run(store, later, now=later, fetch=make_fetcher({}))
    ids = [c["id"] for c in ingest.get_json(store, channels.CHANNELS_KEY)["channels"]]
    assert ids == ["continuum", "aia171"]
    much_later = T + timedelta(hours=7)
    ingest.run(store, much_later, now=much_later, fetch=make_fetcher({}))
    ids = [c["id"] for c in ingest.get_json(store, channels.CHANNELS_KEY)["channels"]]
    assert ids == ["continuum"]  # the new hour's continuum; aia171 is 7 h old


# --- hourly X-ray copy ----------------------------------------------------------------

def test_refresh_xray_writes_a_small_series(store, monkeypatch):
    rows = [
        {"time_tag": f"2026-10-01T{h:02d}:{m:02d}:00Z", "energy": "0.1-0.8nm", "flux": 2e-7 + h * 1e-8}
        for h in range(24) for m in range(60)
    ] + [{"time_tag": "2026-10-01T23:59:00Z", "energy": "0.05-0.4nm", "flux": 1e-8}]
    monkeypatch.setattr(sources, "synthetic_enabled", lambda: False)
    monkeypatch.setattr(ingest.noaa, "_get_json", lambda url: rows)
    assert ingest.refresh_xray(store, T) is None
    x = json.loads(store.get(ingest.XRAY_KEY))
    assert x["generated_at"] and x["latest"]["t"] == "2026-10-01T23:59:00Z"
    assert len(x["series"]) == 145  # every 10th minute, plus the last one


def test_refresh_xray_failure_is_reported_not_raised(store, monkeypatch):
    def boom(url):
        raise ConnectionError("NOAA down")

    monkeypatch.setattr(sources, "synthetic_enabled", lambda: False)
    monkeypatch.setattr(ingest.noaa, "_get_json", boom)
    assert "NOAA down" in ingest.refresh_xray(store, T)
    assert store.get(ingest.XRAY_KEY) is None


def test_xray_series_keeps_only_the_last_hours():
    from pipeline import noaa

    rows = [{"time_tag": f"2026-09-{d:02d}T{h:02d}:00:00Z", "energy": "0.1-0.8nm", "flux": 1e-7} for d in (28, 29, 30) for h in range(24)]
    x = noaa.xray_series(rows, step=1, hours=49)
    assert x["series"][0][0] == "2026-09-28T22:00:00Z" and x["latest"]["t"] == "2026-09-30T23:00:00Z"


# --- hourly active regions ---------------------------------------------------------------

def _rows(date: str, regions: list[int]) -> list[dict]:
    return [{"observed_date": date, "region": n, "location": "N10E13", "area": 20, "number_spots": 4} for n in regions]


def _regions(store, monkeypatch, rows, now=T):
    monkeypatch.setattr(sources, "synthetic_enabled", lambda: False)
    monkeypatch.setattr(ingest.noaa, "_get_json", lambda url: rows)
    return ingest.refresh_regions(store, now)


def test_refresh_regions_picks_up_a_region_numbered_during_the_day(store, monkeypatch):
    assert _regions(store, monkeypatch, _rows("2026-10-04", [4545, 4546, 4547, 4548])) is None
    later = _rows("2026-10-04", [4545, 4546, 4547, 4548]) + _rows("2026-10-05", [4544, 4545, 4546, 4547, 4548, 4549])
    assert _regions(store, monkeypatch, later, T + timedelta(hours=9)) is None
    r = json.loads(store.get(ingest.REGIONS_KEY))
    assert 4549 in [x["region"] for x in r["regions"]] and r["valid_at"] == "2026-10-06T00:00:00Z"
    assert r["generated_at"] == ingest.iso(T + timedelta(hours=9))


def test_refresh_regions_holds_back_a_partial_update(store, monkeypatch):
    _regions(store, monkeypatch, _rows("2026-10-04", [4545, 4546, 4547, 4548, 4549]))
    err = _regions(store, monkeypatch, _rows("2026-10-05", [4549]), T + timedelta(hours=1))
    assert "kept the previous" in err
    assert len(json.loads(store.get(ingest.REGIONS_KEY))["regions"]) == 5
    # a day and a half later the short list is believed: regions do rotate off
    assert _regions(store, monkeypatch, _rows("2026-10-05", [4549]), T + timedelta(hours=40)) is None
    assert len(json.loads(store.get(ingest.REGIONS_KEY))["regions"]) == 1


def test_refresh_regions_never_goes_back_a_day(store, monkeypatch):
    _regions(store, monkeypatch, _rows("2026-10-05", [4549]))
    assert "older" in _regions(store, monkeypatch, _rows("2026-10-04", [4545, 4546]), T + timedelta(hours=1))


def test_refresh_regions_failure_is_reported_not_raised(store, monkeypatch):
    def boom(url):
        raise ConnectionError("NOAA down")

    monkeypatch.setattr(sources, "synthetic_enabled", lambda: False)
    monkeypatch.setattr(ingest.noaa, "_get_json", boom)
    assert "NOAA down" in ingest.refresh_regions(store, T)
    assert store.get(ingest.REGIONS_KEY) is None
