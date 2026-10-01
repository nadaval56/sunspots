from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from pipeline import ingest, solar, sources, synthetic
from pipeline.validate import ValidationError, saturated_fraction, validate

from .conftest import T, jpeg


# --- validation ---------------------------------------------------------------

def test_good_frame_passes(good_jpeg):
    vf = validate(good_jpeg, 200, sources.JSOC_IC_1K, T, T)
    assert vf.disk.r == pytest.approx(475.6, abs=2)


def test_http_error_rejected(good_jpeg):
    with pytest.raises(ValidationError, match="http 404"):
        validate(good_jpeg, 404, sources.JSOC_IC_1K, T, T)


def test_small_file_rejected():
    with pytest.raises(ValidationError, match="too small"):
        validate(b"x" * 1000, 200, sources.JSOC_IC_1K, T, T)


def test_stale_frame_rejected(good_jpeg):
    with pytest.raises(ValidationError, match="stale"):
        validate(good_jpeg, 200, sources.JSOC_IC_1K, T - timedelta(minutes=61), T)


def test_saturated_4500_rejected(saturated_4500_jpeg):
    assert len(saturated_4500_jpeg) > 40 * 1024
    with pytest.raises(ValidationError, match="saturated"):
        validate(saturated_4500_jpeg, 200, sources.SDO_1700, T, T)


def test_wrong_radius_rejected():
    # an AIA-sized disk (≈400px) presented as HMI must fail the ±3% check
    small = aia_sized(synthetic.render(T))
    with pytest.raises(ValidationError, match="disk radius"):
        validate(jpeg(small), 200, sources.JSOC_IC_1K, T, T)


def test_off_centre_rejected():
    rgb = synthetic.render(T)
    shifted = np.roll(rgb, -30, axis=1)  # ≈35px off centre, limb still in frame
    with pytest.raises(ValidationError, match="centre"):
        validate(jpeg(shifted), 200, sources.JSOC_IC_1K, T, T)


def test_saturated_fraction_zero_on_normal_frame():
    rgb = synthetic.render(T)
    assert saturated_fraction(rgb, solar.fit_disk(rgb)) == 0


# --- fallback chain -------------------------------------------------------------

def make_fetcher(per_source):
    def fetch(spec, target):
        yield from per_source.get(spec.name, [])
    return fetch


def aia_sized(rgb):
    """Shrink an HMI-like frame so its disk matches the AIA 1700 radius (~400px)."""
    from PIL import Image
    small = Image.fromarray(rgb).resize((860, 860))
    out = np.zeros_like(rgb)
    out[82:942, 82:942] = np.asarray(small)
    return out


def test_falls_back_past_jsoc_and_rejects_saturated(good_jpeg, saturated_4500_jpeg, store):
    good_1700 = jpeg(aia_sized(synthetic.render(T)))
    fetch = make_fetcher({
        "jsoc": [(T, 503, b"")],
        "sdo-hmi": [(T - timedelta(days=3), 200, good_jpeg)],  # stuck "latest" style frame
        "sdo-1700": [(T, 200, saturated_4500_jpeg), (T + timedelta(minutes=12), 200, good_1700)],
    })
    acq, failures = ingest.acquire(T, sources.HOURLY_CHAIN, fetch)
    assert acq is not None and acq.spec.name == "sdo-1700"
    assert any("http 503" in f for f in failures)
    assert any("stale" in f for f in failures)
    assert any("saturated" in f for f in failures)


def test_all_sources_fail(store):
    entry = ingest.run(store, T, now=T, fetch=make_fetcher({}))
    assert entry is None
    log = store.get(f"logs/ingest/{T:%Y-%m}.jsonl").decode()
    assert '"ok": false' in log


def test_network_exception_falls_through(good_jpeg):
    def fetch(spec, target):
        if spec.name == "jsoc":
            raise RuntimeError("connection refused")
        yield T, 200, good_jpeg
    acq, failures = ingest.acquire(T, sources.HOURLY_CHAIN, fetch)
    assert acq.spec.name == "sdo-hmi"
    assert "connection refused" in failures[0]


# --- end to end (local storage) -------------------------------------------------

def test_run_stores_frame_and_manifest(store):
    entry = ingest.run(store, T, now=T, fetch=ingest.synthetic_fetcher)
    assert entry["key"] == "frames/2026/09/25/0600.webp"
    assert store.get("frames/2026/09/25/0600_512.webp")
    assert entry["cx"] == pytest.approx(0.5, abs=0.01)
    assert entry["r"] == pytest.approx(1 / 2.1, abs=0.01)
    assert entry["b0"] == pytest.approx(solar.b0_deg(T), abs=1e-3)
    m = ingest.get_json(store, "manifest.json")
    assert m["latest"]["key"] == entry["key"] and not m["fallback"]


def test_manifest_window_and_prune(store):
    old = T - timedelta(days=40)
    ingest.run(store, old, now=old, fetch=ingest.synthetic_fetcher)
    store.put("daily/2026/20260801.webp", b"x", "image/webp")
    ingest.run(store, T, now=T, fetch=ingest.synthetic_fetcher)
    m = ingest.get_json(store, "manifest.json")
    assert [f["t"] for f in m["frames"]] == ["2026-09-25T06:00:00Z"]
    assert not store.list(f"frames/{old:%Y/%m/%d}")
    assert store.get("daily/2026/20260801.webp") == b"x"  # archive untouched


def test_target_time():
    now = datetime(2026, 9, 25, 14, 7, tzinfo=timezone.utc)
    assert ingest.target_time(now) == datetime(2026, 9, 25, 13, 30, tzinfo=timezone.utc)


def test_index_parsing(monkeypatch):
    html = """<a href="20260925_060000_Ic_1k.jpg">x</a> <a href="20260925_061500_Ic_1k.jpg">
              <a href="20260925_060000_M_1k.jpg"> <a href="20260925_070000_Ic_1k.jpg">"""

    class R:
        status_code = 200
        text = html
    monkeypatch.setattr(sources, "http_get", lambda url: R())
    c = sources.candidates(sources.JSOC_IC_1K, datetime(2026, 9, 25, 6, 10, tzinfo=timezone.utc))
    assert [t.strftime("%H%M") for t, _ in c] == ["0615", "0600"]
    assert c[0][1].endswith("/2026/09/25/20260925_061500_Ic_1k.jpg")
