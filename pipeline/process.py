"""Crop, mask and encode a validated frame (BRIEF §5.1 step 4)."""
from __future__ import annotations

import io
import math
from dataclasses import dataclass

import numpy as np
from PIL import Image

from . import solar

CROP_FACTOR = 1.05  # square side = 2·1.05·R
MASK_FACTOR = 1.012  # everything outside is blacked out (removes the label)


@dataclass
class Processed:
    image: Image.Image  # square, disk centred
    cx: float  # normalised 0..1 within the square
    cy: float
    r: float


def crop_and_mask(rgb: np.ndarray, disk: solar.Disk, mask: bool = True) -> Processed:
    """Square crop of side 2·1.05·R around the disk; black out beyond 1.012R if `mask`."""
    half = CROP_FACTOR * disk.r
    x0 = int(math.floor(disk.cx - half))
    y0 = int(math.floor(disk.cy - half))
    side = int(math.ceil(2 * half))
    h, w = rgb.shape[:2]

    out = np.zeros((side, side, 3), dtype=np.uint8)
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(w, x0 + side), min(h, y0 + side)
    out[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] = rgb[sy0:sy1, sx0:sx1, :3]

    ccx, ccy = disk.cx - x0, disk.cy - y0
    if mask:
        yy, xx = np.mgrid[0:side, 0:side]
        outside = (xx - ccx) ** 2 + (yy - ccy) ** 2 > (MASK_FACTOR * disk.r) ** 2
        out[outside] = 0
    return Processed(Image.fromarray(out), ccx / side, ccy / side, disk.r / side)


def encode(image: Image.Image, size: int, fmt: str = "WEBP", quality: int = 80) -> bytes:
    im = image if image.width == size else image.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, fmt, quality=quality)
    return buf.getvalue()
