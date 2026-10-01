"""Acceptance fixture from BRIEF §6.5 and §5.3."""
from datetime import datetime, timezone

import numpy as np
import pytest

from pipeline import solar, sources, synthetic

FIXTURE = [  # day, x, y, cx, cy, R  (JSOC Ic_1k, 06:00 UTC)
    (23, 668.2, 547.8, 508.6, 518.0, 475.6),
    (24, 771.7, 541.0, 508.6, 518.0, 475.7),
    (25, 857.2, 530.6, 508.6, 518.0, 475.8),
    (26, 922.8, 520.1, 508.6, 518.0, 476.0),
    (27, 966.4, 508.0, 508.8, 517.4, 475.9),
]


def obs():
    return [
        (datetime(2026, 9, d, 6, tzinfo=timezone.utc), x, y, solar.Disk(cx, cy, r))
        for d, x, y, cx, cy, r in FIXTURE
    ]


def test_b0_reference_value():
    assert solar.b0_deg(datetime(2026, 9, 23, 6, tzinfo=timezone.utc)) == pytest.approx(7.03, abs=0.02)


def test_rotation_fixture_with_b0():
    fit = solar.fit_rotation(obs(), correct_b0=True)
    assert fit.omega == pytest.approx(13.64, abs=0.1)
    assert fit.mean_lat == pytest.approx(3.1, abs=0.15)
    assert max(fit.lats) - min(fit.lats) <= 0.4  # stable within ±0.2°
    assert fit.p_syn == pytest.approx(26.4, abs=0.2)
    assert fit.p_sid == pytest.approx(24.6, abs=0.2)
    assert fit.rms < 0.3


def test_latitude_drifts_without_b0():
    fit = solar.fit_rotation(obs(), correct_b0=False)
    assert max(fit.lats) - min(fit.lats) > 3  # the "wandering" latitude


def test_heliographic_roundtrip():
    disk = solar.Disk(500, 500, 400)
    for B, L in [(0, 0), (20, -40), (-35, 60), (3.1, 12)]:
        x, y, visible = solar.heliographic_to_pixel(B, L, disk, 7.0)
        assert visible
        b2, l2 = solar.pixel_to_heliographic(x, y, disk, 7.0)
        assert (b2, l2) == pytest.approx((B, L), abs=1e-6)


def test_earth_sun_distance_range():
    d_peri = solar.earth_sun_distance_au(datetime(2026, 1, 3, tzinfo=timezone.utc))
    d_aph = solar.earth_sun_distance_au(datetime(2026, 7, 4, tzinfo=timezone.utc))
    assert d_peri == pytest.approx(0.983, abs=0.002)
    assert d_aph == pytest.approx(1.017, abs=0.002)


def test_fit_disk_on_synthetic_jsoc_frame():
    t = datetime(2026, 9, 25, 6, tzinfo=timezone.utc)
    disk = solar.fit_disk(synthetic.render(t))
    assert disk.cx == pytest.approx(508.7, abs=0.6)
    assert disk.cy == pytest.approx(517.6, abs=0.6)
    assert disk.r == pytest.approx(sources.HMI_R_1AU / solar.earth_sun_distance_au(t), abs=0.8)


def test_snodgrass_equator():
    assert solar.snodgrass_sidereal(0) == pytest.approx(14.713)
    assert solar.snodgrass_sidereal(30) < solar.snodgrass_sidereal(0)
    assert np.isfinite(solar.synodic_to_sidereal(27.0))
