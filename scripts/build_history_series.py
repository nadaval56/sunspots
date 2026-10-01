"""Download the two long SILSO series for the history page (BRIEF §4.4, §7.3.4).

    python -m scripts.build_history_series

Writes, in site/src/data/ (bundled at build time, a few KB each):

  sn-yearly.json  [[year, yearly mean total sunspot number], ...] from 1700.
      SILSO SN_y_tot_V2.0: the official sunspot number (version 2). Years before
      1749 come from sparse observations and are less certain.
  gn-yearly.json  [[year, yearly mean number of sunspot groups], ...] from 1610.
      SILSO GNbb2_y: the "backbone" group number of Svalgaard & Schatten (2016).
      The only one of the long series that starts with the telescope, so it is the
      one that shows the Maunder minimum. 0.05 is the series' floor for "no groups seen".

Re-run when SILSO publishes a new version. Standard library only.
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site/src/data"
UA = {"User-Agent": "SunspotsEdu/1.0 (+https://sunspots.example/about)"}
SN_URL = "https://www.sidc.be/SILSO/DATA/SN_y_tot_V2.0.csv"
GN_URL = "https://www.sidc.be/SILSO/DATA/GroupNumber/GNbb2_y.txt"


def fetch(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def parse_sn(text: str) -> list[list[float]]:
    """`1700.5;   8.3; -1.0;    -1;1` → [[1700, 8.3], ...]; -1 means missing."""
    out = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(";")]
        if len(parts) < 2:
            continue
        try:
            year, value = int(float(parts[0])), float(parts[1])
        except ValueError:
            continue
        if value >= 0:
            out.append([year, value])
    return out


def parse_gn(text: str) -> list[list[float]]:
    """`1610.5  2.64  0.92` → [[1610, 2.64], ...]."""
    out = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            out.append([int(float(parts[0])), float(parts[1])])
        except ValueError:
            continue
    return out


def main() -> None:
    sn = parse_sn(fetch(SN_URL))
    gn = parse_gn(fetch(GN_URL))
    assert sn[0][0] == 1700 and len(sn) > 300, "unexpected SN_y_tot_V2.0 format"
    assert gn[0][0] == 1610 and len(gn) > 400, "unexpected GNbb2_y format"
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sn-yearly.json").write_text(json.dumps(sn, separators=(",", ":")) + "\n")
    (OUT / "gn-yearly.json").write_text(json.dumps(gn, separators=(",", ":")) + "\n")
    print(f"sn-yearly.json: {sn[0][0]}–{sn[-1][0]} ({len(sn)} years)")
    print(f"gn-yearly.json: {gn[0][0]}–{gn[-1][0]} ({len(gn)} years)")


if __name__ == "__main__":
    main()
