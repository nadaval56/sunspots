"""Solar geometry: B0, Earth–Sun distance, disk fitting, heliographic coordinates.

Formulas follow BRIEF §5.2, §5.3 and §6.2. The same math is mirrored in
site/src/lib/solar.ts for the lab; tests/test_solar.py pins both to the
§6.5 acceptance fixture.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np

SIDEREAL_YEAR_DAYS = 365.256
EARTH_RADII_PER_SUN = 109.1


def _julian_day(t: datetime) -> float:
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.timestamp() * 1000 / 864e5 + 2440587.5


def _sun_longitudes(t: datetime) -> tuple[float, float, float]:
    """Return (jd, apparent ecliptic longitude λ [deg], mean anomaly g [deg])."""
    jd = _julian_day(t)
    n = jd - 2451545.0
    L = (280.460 + 0.9856474 * n) % 360
    g = (357.528 + 0.9856003 * n) % 360
    gr = math.radians(g)
    lam = L + 1.915 * math.sin(gr) + 0.020 * math.sin(2 * gr)
    return jd, lam, g


def b0_deg(t: datetime) -> float:
    """Heliographic latitude of disk centre (tilt of the solar axis toward Earth)."""
    jd, lam, _ = _sun_longitudes(t)
    K = 73.6667 + 1.3958333 * (jd - 2396758) / 36525
    s = math.sin(math.radians(lam - K)) * math.sin(math.radians(7.25))
    return math.degrees(math.asin(s))


def earth_sun_distance_au(t: datetime) -> float:
    _, _, g = _sun_longitudes(t)
    gr = math.radians(g)
    return 1.00014 - 0.01671 * math.cos(gr) - 0.00014 * math.cos(2 * gr)


@dataclass(frozen=True)
class Disk:
    cx: float
    cy: float
    r: float


def fit_disk(img: np.ndarray, row_step: int = 4, label_rows_frac: float = 0.06) -> Disk:
    """Kåsa least-squares circle fit to the limb (BRIEF §5.2).

    img: 2-D luminance array or HxWx3 array. Rows in the bottom
    `label_rows_frac` of the image are ignored because JSOC prints a text
    label there.
    """
    if img.ndim == 3:
        lum = img[..., :3].astype(np.float32).mean(axis=2)
    else:
        lum = img.astype(np.float32)
    h, w = lum.shape
    c = lum[int(h * 0.4) : int(h * 0.6), int(w * 0.4) : int(w * 0.6)]
    threshold = 0.2 * float(c.mean())
    mask = lum > threshold

    xs: list[float] = []
    ys: list[float] = []
    last_row = int(h * (1 - label_rows_frac))
    for y in range(0, last_row, row_step):
        idx = np.flatnonzero(mask[y])
        if idx.size < 2:
            continue
        xs.extend((float(idx[0]), float(idx[-1])))
        ys.extend((float(y), float(y)))
    if len(xs) < 6:
        raise ValueError("disk fit: not enough limb points")
    x = np.asarray(xs)
    y = np.asarray(ys)
    A = np.column_stack([x, y, np.ones_like(x)])
    (a, b, cc), *_ = np.linalg.lstsq(A, x**2 + y**2, rcond=None)
    cx, cy = a / 2, b / 2
    r = math.sqrt(cc + cx**2 + cy**2)
    return Disk(float(cx), float(cy), float(r))


def pixel_to_heliographic(
    px: float, py: float, disk: Disk, b0: float
) -> tuple[float, float]:
    """Screen pixel → (B, L) in degrees; L is longitude from central meridian, west positive."""
    X = (px - disk.cx) / disk.r
    Y = -(py - disk.cy) / disk.r
    rho2 = X * X + Y * Y
    if rho2 > 1:
        raise ValueError("point is off the disk")
    Z = math.sqrt(1 - rho2)
    b0r = math.radians(b0)
    sinB = Y * math.cos(b0r) + Z * math.sin(b0r)
    B = math.degrees(math.asin(max(-1.0, min(1.0, sinB))))
    L = math.degrees(math.atan2(X, Z * math.cos(b0r) - Y * math.sin(b0r)))
    return B, L


def heliographic_to_pixel(
    B: float, L: float, disk: Disk, b0: float
) -> tuple[float, float, bool]:
    """(B, L) → screen pixel. Third value is True when the point is on the visible hemisphere."""
    Br, Lr, b0r = math.radians(B), math.radians(L), math.radians(b0)
    X = math.cos(Br) * math.sin(Lr)
    Y = math.sin(Br) * math.cos(b0r) - math.cos(Br) * math.cos(Lr) * math.sin(b0r)
    Z = math.sin(Br) * math.sin(b0r) + math.cos(Br) * math.cos(Lr) * math.cos(b0r)
    return disk.cx + X * disk.r, disk.cy - Y * disk.r, Z >= 0


def snodgrass_sidereal(B: float) -> float:
    """Snodgrass & Ulrich (1990) sidereal rotation rate, deg/day."""
    s2 = math.sin(math.radians(B)) ** 2
    return 14.713 - 2.396 * s2 - 1.787 * s2 * s2


def synodic_to_sidereal(p_syn: float) -> float:
    return 1 / (1 / p_syn + 1 / SIDEREAL_YEAR_DAYS)


@dataclass(frozen=True)
class RotationFit:
    omega: float  # synodic deg/day
    p_syn: float
    p_sid: float
    mean_lat: float
    lats: tuple[float, ...]
    rms: float  # deg, residual of L(t) about the line


def fit_rotation(
    obs: list[tuple[datetime, float, float, Disk]], correct_b0: bool = True
) -> RotationFit:
    """obs: (time, px, py, disk) per day. Returns the straight-line fit of L(t)."""
    t0 = obs[0][0]
    ts, Ls, Bs = [], [], []
    for t, px, py, disk in obs:
        b0 = b0_deg(t) if correct_b0 else 0.0
        B, L = pixel_to_heliographic(px, py, disk, b0)
        ts.append((t - t0).total_seconds() / 86400)
        Ls.append(L)
        Bs.append(B)
    slope, intercept = np.polyfit(ts, Ls, 1)
    resid = np.asarray(Ls) - (slope * np.asarray(ts) + intercept)
    p_syn = 360 / slope
    return RotationFit(
        omega=float(slope),
        p_syn=float(p_syn),
        p_sid=float(synodic_to_sidereal(p_syn)),
        mean_lat=float(np.mean(Bs)),
        lats=tuple(float(b) for b in Bs),
        rms=float(np.sqrt(np.mean(resid**2))),
    )
