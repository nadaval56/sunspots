import io
from datetime import datetime, timezone

import numpy as np
import pytest
from PIL import Image

from pipeline import synthetic
from pipeline.storage import LocalStorage

T = datetime(2026, 9, 25, 6, tzinfo=timezone.utc)


def jpeg(rgb: np.ndarray, quality: int = 90) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "JPEG", quality=quality)
    return buf.getvalue()


@pytest.fixture
def good_jpeg() -> bytes:
    return synthetic.render_jpeg(T)


@pytest.fixture
def saturated_4500_jpeg() -> bytes:
    """Mimics the Sept 2026 AIA 4500 failure: disk pixels stuck at (254, 255, 127)."""
    rgb = synthetic.render(T, label=False)
    on = rgb.sum(axis=-1) > 30
    rgb[on] = (254, 255, 127)
    rng = np.random.default_rng(0)
    noise = rng.integers(0, 2, size=rgb.shape, dtype=np.uint8)  # keep size above 40KB
    rgb = np.where(on[..., None], rgb, noise * 20)
    return jpeg(rgb.astype(np.uint8))


@pytest.fixture
def store(tmp_path) -> LocalStorage:
    return LocalStorage(tmp_path / "media")
