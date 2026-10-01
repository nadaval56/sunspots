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
