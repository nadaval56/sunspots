"""Frame validation (BRIEF §5.1 step 3). Each check returns a reason string on failure."""
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
from PIL import Image

from . import solar
from .sources import SourceSpec

MIN_BYTES = 40 * 1024
MAX_AGE = timedelta(minutes=60)
SATURATION_LEVEL = 250
SATURATION_MAX_FRACTION = 0.05
# BRIEF §5.1 says "all channels ≥250", but its own failing example, AIA 4500
# at (254, 255, 127), would pass that rule. Two clipped channels catch it while
# a normal orange HMI disk (only R near 255) stays valid. See docs/DECISIONS.md.
SATURATION_MIN_CHANNELS = 2
RADIUS_TOLERANCE = 0.03
CENTER_TOLERANCE = 0.03


class ValidationError(Exception):
    pass


@dataclass
class ValidFrame:
    rgb: np.ndarray
    disk: solar.Disk
    geometry: str = "fit"  # fit | known | continuum (extra channels only)


def check_http(status: int, data: bytes) -> None:
    if status != 200:
        raise ValidationError(f"http {status}")
    if len(data) <= MIN_BYTES:
        raise ValidationError(f"too small ({len(data)} bytes)")


def check_freshness(frame_time: datetime, target: datetime) -> None:
    if abs(frame_time - target) >= MAX_AGE:
        raise ValidationError(f"stale: {frame_time.isoformat()} vs target {target.isoformat()}")


def saturated_fraction(rgb: np.ndarray, disk: solar.Disk, radius_frac: float = 0.8) -> float:
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    inside = (xx - disk.cx) ** 2 + (yy - disk.cy) ** 2 <= (radius_frac * disk.r) ** 2
    if not inside.any():
        return 1.0
    chans = rgb[..., :3] if rgb.ndim == 3 else rgb[..., None]
    need = min(SATURATION_MIN_CHANNELS, chans.shape[-1])
    sat = (chans >= SATURATION_LEVEL).sum(axis=-1) >= need
    return float(sat[inside].mean())


def check_saturation(rgb: np.ndarray, disk: solar.Disk) -> None:
    frac = saturated_fraction(rgb, disk)
    if frac >= SATURATION_MAX_FRACTION:
        raise ValidationError(f"saturated: {frac:.1%} of pixels within 0.8R")


def expected_radius(spec: SourceSpec, t: datetime, width: int) -> float:
    return spec.ref_radius_1au * (width / spec.size) / solar.earth_sun_distance_au(t)


def check_disk(disk: solar.Disk, spec: SourceSpec, t: datetime, shape: tuple[int, int]) -> None:
    h, w = shape
    exp_r = expected_radius(spec, t, w)
    if abs(disk.r - exp_r) / exp_r > RADIUS_TOLERANCE:
        raise ValidationError(f"disk radius {disk.r:.1f}px, expected {exp_r:.1f}px ±3%")
    off = np.hypot(disk.cx - w / 2, disk.cy - h / 2)
    if off / w >= CENTER_TOLERANCE:
        raise ValidationError(f"disk centre off by {off:.1f}px")


def decode(data: bytes) -> np.ndarray:
    try:
        return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
    except Exception as e:  # noqa: BLE001 - any decode failure is a validation failure
        raise ValidationError(f"decode failed: {e}") from e


def validate(
    data: bytes, status: int, spec: SourceSpec, frame_time: datetime, target: datetime
) -> ValidFrame:
    check_http(status, data)
    check_freshness(frame_time, target)
    rgb = decode(data)
    try:
        disk = solar.fit_disk(rgb)
    except ValueError as e:
        raise ValidationError(str(e)) from e
    # Saturation is checked before geometry: a blown-out frame (AIA 4500 in
    # Sept 2026) can still fit a plausible circle.
    check_saturation(rgb, disk)
    check_disk(disk, spec, frame_time, rgb.shape[:2])
    return ValidFrame(rgb, disk)


# --- extra channels (pipeline/channels.py) -----------------------------------

# AIA EUV frames have a bright limb and corona, so a threshold fit is unreliable
# (on 2026-10-01 the Kåsa fit gave R=497 for 171 and 440 for 304, vs ~400).
# SDO browse frames are centred, so the disk is placed from known geometry and
# only checked for presence: the disk (<0.9R) must be clearly brighter than a
# ring at 1.15–1.3R. Measured 2026-10-01: 171 ×3.9, 304 ×143, 1700 ×4·10⁴;
# a blank or grey frame gives ×1.
DISK_CONTRAST_MIN = 2.0
DISK_MEAN_MIN = 10.0


def known_disk(spec: SourceSpec, t: datetime, shape: tuple[int, int]) -> solar.Disk:
    h, w = shape
    return solar.Disk((w - 1) / 2, (h - 1) / 2, expected_radius(spec, t, w))


def check_disk_present(rgb: np.ndarray, disk: solar.Disk) -> None:
    h, w = rgb.shape[:2]
    lum = rgb[..., :3].astype(np.float32).mean(axis=-1) if rgb.ndim == 3 else rgb.astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(xx - disk.cx, yy - disk.cy) / disk.r
    inner = float(lum[rr < 0.9].mean())
    ring_mask = (rr > 1.15) & (rr < 1.3) & (yy < h * 0.88)  # skip the bottom label
    ring = float(lum[ring_mask].mean()) if ring_mask.any() else 0.0
    if inner < DISK_MEAN_MIN or inner < DISK_CONTRAST_MIN * ring:
        raise ValidationError(f"no disk at expected position (disk {inner:.1f}, ring {ring:.1f})")


def validate_channel(
    data: bytes,
    status: int,
    spec: SourceSpec,
    frame_time: datetime,
    target: datetime,
    fit: bool,
    fallback_disk: solar.Disk | None = None,
) -> ValidFrame:
    """Validate an extra channel frame.

    fit=True (HMI magnetogram): Kåsa fit checked like the main frame; if it
    fails, use `fallback_disk` (the continuum frame's disk, same instrument and
    geometry) when given. fit=False (AIA): known geometry, see known_disk().
    """
    check_http(status, data)
    check_freshness(frame_time, target)
    rgb = decode(data)
    disk, geometry = None, "known"
    if fit:
        try:
            d = solar.fit_disk(rgb)
            check_disk(d, spec, frame_time, rgb.shape[:2])
            disk, geometry = d, "fit"
        except (ValueError, ValidationError) as e:
            if fallback_disk is None:
                raise ValidationError(f"disk fit: {e}") from e
            disk, geometry = fallback_disk, "continuum"
    if disk is None:
        disk = known_disk(spec, frame_time, rgb.shape[:2])
    check_saturation(rgb, disk)
    check_disk_present(rgb, disk)
    return ValidFrame(rgb, disk, geometry)
