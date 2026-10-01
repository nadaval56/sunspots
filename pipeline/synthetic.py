"""Synthetic HMI-like continuum images for offline development and tests.

The real hosts may be unreachable from a dev sandbox. With SUNSPOTS_SYNTHETIC=1
the pipeline renders frames that mimic JSOC Ic_1k geometry (off-centre disk,
bottom label, orange colour map, limb darkening) with spots that rotate at
the Snodgrass rate and are projected with the correct B0. Never used in CI
against R2.
"""
from __future__ import annotations

import io
import math
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageDraw

from . import solar

EPOCH = datetime(2026, 9, 23, 6, tzinfo=timezone.utc)

# (B deg, L at EPOCH deg, umbra radius deg, penumbra radius deg)
SPOTS = [
    (3.1, 12.0, 0.9, 2.2),  # mimics the §6.5 leading spot
    (12.5, -47.0, 0.5, 1.2),
    (-14.0, -120.0, 1.1, 2.6),
    (-8.0, 150.0, 0.7, 1.7),
    (18.0, 80.0, 0.6, 1.4),
]


def _synodic_rate(B: float) -> float:
    return solar.snodgrass_sidereal(B) - 360 / solar.SIDEREAL_YEAR_DAYS


def render(t: datetime, size: int = 1024, label: bool = True, seed: int | None = None) -> np.ndarray:
    scale = size / 1024
    cx, cy = 508.7 * scale, 517.6 * scale
    r = 477.3 / solar.earth_sun_distance_au(t) * scale
    b0 = math.radians(solar.b0_deg(t))
    days = (t - EPOCH).total_seconds() / 86400

    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    X = (xx - cx) / r
    Y = -(yy - cy) / r
    rho2 = X * X + Y * Y
    on = rho2 <= 1
    Z = np.sqrt(np.clip(1 - rho2, 0, 1))

    sinB = Y * math.cos(b0) + Z * math.sin(b0)
    B = np.arcsin(np.clip(sinB, -1, 1))
    L = np.arctan2(X, Z * math.cos(b0) - Y * math.sin(b0))

    intensity = 1 - 0.62 * (1 - Z) - 0.12 * (1 - Z) ** 2  # limb darkening
    rng = np.random.default_rng(seed if seed is not None else int(t.timestamp()) // 3600)
    intensity *= 1 + 0.015 * rng.standard_normal(intensity.shape).astype(np.float32)

    for sb, sl, umbra, penumbra in SPOTS:
        lon = math.radians(((sl + _synodic_rate(sb) * days + 180) % 360) - 180)
        lat = math.radians(sb)
        cosd = np.sin(B) * math.sin(lat) + np.cos(B) * math.cos(lat) * np.cos(L - lon)
        d = np.degrees(np.arccos(np.clip(cosd, -1, 1)))
        intensity = np.where(d < penumbra, intensity * 0.68, intensity)
        intensity = np.where(d < umbra, intensity * 0.35, intensity)

    intensity = np.where(on, intensity, 0)
    rgb = np.stack(
        [
            np.clip(intensity * 290, 0, 255),
            np.clip(intensity * 150, 0, 255),
            np.clip(intensity * 40, 0, 255),
        ],
        axis=-1,
    ).astype(np.uint8)

    if label:
        im = Image.fromarray(rgb)
        ImageDraw.Draw(im).text(
            (int(10 * scale), size - int(20 * scale)),
            f"SDO/HMI Continuum: {t:%Y%m%d_%H%M%S}",
            fill=(255, 255, 255),
        )
        rgb = np.asarray(im)
    return rgb


def render_jpeg(t: datetime, size: int = 1024) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(render(t, size)).save(buf, "JPEG", quality=90)
    return buf.getvalue()
