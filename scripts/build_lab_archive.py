"""Build the lab's fixed sample archive (BRIEF §6.3.3) from the prototype.

The prototype (docs/reference/rotation-lab-prototype.html) embeds nine JSOC
HMI Ic_1k frames, 23.9–1.10.2026 at 06:00 UTC, as base64 JPEGs together with
the disk fit (cx, cy, r normalized to the image) and an example track. This
script writes them to site/public/lab-archive/ as plain files plus index.json
in the same shape as the pipeline's lab.json, so the lab reads both the same way.

Run once:  python -m scripts.build_lab_archive
It also prints our own disk fit (pipeline.solar.fit_disk) next to the
prototype's values; see docs/DECISIONS.md for the discrepancy.
"""

from __future__ import annotations

import base64
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline.solar import b0_deg, fit_disk

ROOT = Path(__file__).resolve().parents[1]
PROTOTYPE = ROOT / "docs/reference/rotation-lab-prototype.html"
OUT = ROOT / "site/public/lab-archive"


def main() -> None:
    html = PROTOTYPE.read_text(encoding="utf-8")
    frames = json.loads(re.search(r"const FRAMES = (\[.*?\]);\n", html).group(1))
    example = json.loads(re.search(r"const EXAMPLE = (\{.*?\});\n", html).group(1))
    OUT.mkdir(parents=True, exist_ok=True)

    entries = []
    for f in frames:
        t = datetime.fromisoformat(f["t"].replace("Z", "+00:00")).astimezone(timezone.utc)
        ymd = t.strftime("%Y%m%d")
        raw = base64.b64decode(f["img"].split(",", 1)[1])
        (OUT / f"{ymd}.jpg").write_bytes(raw)

        img = Image.open(io.BytesIO(raw))
        w = img.size[0]
        own = fit_disk(np.asarray(img.convert("RGB")))
        print(
            f"{ymd} {img.size} prototype=({f['cx']:.4f},{f['cy']:.4f},{f['r']:.4f}) "
            f"fit_disk=({own.cx / w:.4f},{own.cy / w:.4f},{own.r / w:.4f})"
        )
        entries.append(
            {
                "date": t.strftime("%Y-%m-%d"),
                "t": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "key": f"{ymd}.jpg",
                "jpg": f"{ymd}.jpg",
                "source": "jsoc",
                "cx": f["cx"],
                "cy": f["cy"],
                "r": f["r"],
                "b0": round(b0_deg(t), 3),
            }
        )

    index = {
        "generated_at": "2026-10-01T00:00:00Z",
        "description": "Sample archive for the rotation lab: JSOC SDO/HMI Ic_1k, 06:00 UTC daily, 23.9–1.10.2026.",
        "credit": "Courtesy of NASA/SDO and the HMI science team; images via JSOC, Stanford University.",
        "frames": entries,
        "example_track": {f"{k[:4]}-{k[4:6]}-{k[6:]}": v for k, v in example.items()},
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(entries)} frames to {OUT}")


if __name__ == "__main__":
    main()
