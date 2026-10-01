"""NOAA SWPC data (BRIEF §4.3): SRS parser and the today.json payload.

Field names of the SWPC JSON products are read defensively because they could
not be verified from the dev sandbox (docs/STATUS.md). Run
scripts/verify_sources.py on a runner and tighten these readers if needed.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from . import sources

NOAA = "https://services.swpc.noaa.gov"
URLS = {
    "ssn": f"{NOAA}/json/solar-cycle/swpc_observed_ssn.json",
    "srs": f"{NOAA}/text/srs.txt",
    "regions": f"{NOAA}/json/solar_regions.json",
    "probabilities": f"{NOAA}/json/solar_probabilities.json",
    "xrays": f"{NOAA}/json/goes/primary/xrays-1-day.json",
    "cycle_observed": f"{NOAA}/json/solar-cycle/observed-solar-cycle-indices.json",
    "cycle_predicted": f"{NOAA}/json/solar-cycle/predicted-solar-cycle.json",
}

_REGION_RE = re.compile(
    r"^(?P<nmbr>\d{4,5})\s+(?P<ns>[NS])(?P<lat>\d{2})(?P<ew>[EW])(?P<lon>\d{2})\s+"
    r"(?P<lo>\d{1,3})\s+(?P<area>\d{4})\s+(?P<z>\w{3})\s+(?P<ll>\d+)\s+(?P<nn>\d+)\s+(?P<mag>[\w-]+)"
)


def parse_location(loc: str) -> tuple[float, float]:
    """'N03W24' → (lat=+3, lon=+24). West (toward the right limb) is positive."""
    m = re.fullmatch(r"([NS])(\d{2})([EW])(\d{2})", loc.strip())
    if not m:
        raise ValueError(loc)
    lat = int(m[2]) * (1 if m[1] == "N" else -1)
    lon = int(m[4]) * (1 if m[3] == "W" else -1)
    return float(lat), float(lon)


def parse_srs(text: str) -> dict:
    """Parse section I (regions with sunspots) of the Solar Region Summary."""
    issued = None
    valid = None
    regions = []
    in_section_i = False
    for line in text.splitlines():
        if line.startswith(":Issued:"):
            issued = datetime.strptime(line.split(":Issued:")[1].strip(), "%Y %b %d %H%M UTC").replace(
                tzinfo=timezone.utc
            )
        if line.startswith("I.") or line.startswith("I. "):
            in_section_i = True
            m = re.search(r"Valid at (\d{2})/(\d{4})Z", line)
            if m:
                valid = f"{m[1]}/{m[2]}Z"
            continue
        if line.startswith("IA.") or line.startswith("II."):
            in_section_i = False
            continue
        if not in_section_i:
            continue
        m = _REGION_RE.match(line.strip())
        if m:
            lat = int(m["lat"]) * (1 if m["ns"] == "N" else -1)
            lon = int(m["lon"]) * (1 if m["ew"] == "W" else -1)
            regions.append(
                {
                    "region": int(m["nmbr"]),
                    "lat": lat,
                    "lon": lon,
                    "carrington_lon": int(m["lo"]),
                    "area": int(m["area"]),  # millionths of the hemisphere
                    "mcintosh": m["z"],
                    "extent": int(m["ll"]),
                    "spots": int(m["nn"]),
                    "mag": m["mag"],
                }
            )
    return {"issued": issued.strftime("%Y-%m-%dT%H:%M:%SZ") if issued else None, "valid": valid, "regions": regions}


def _get_json(url: str):
    r = sources.http_get(url)
    r.raise_for_status()
    return r.json()


def _first(d: dict, *names, default=None):
    for n in names:
        if n in d and d[n] not in (None, ""):
            return d[n]
    return default


def latest_ssn(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    row = max(rows, key=lambda r: str(_first(r, "Obsdate", "obsdate", "time-tag", "time_tag", default="")))
    return {
        "date": str(_first(row, "Obsdate", "obsdate", "time-tag", "time_tag", default=""))[:10],
        "value": _first(row, "swpc_ssn", "ssn", "SSN"),
    }


def regions_from_json(rows: list[dict]) -> list[dict]:
    """solar_regions.json → same shape as parse_srs. Only the latest observed date is kept."""
    if not rows:
        return []
    dates = [str(_first(r, "observed_date", "date", default="")) for r in rows]
    last = max(dates)
    out = []
    for r, d in zip(rows, dates):
        if d != last:
            continue
        lat, lon = r.get("latitude"), r.get("longitude")
        if (lat is None or lon is None) and r.get("location"):
            try:
                lat, lon = parse_location(r["location"])
            except ValueError:
                continue
        if lat is None or lon is None:
            continue
        area = _first(r, "area", default=0) or 0
        spots = _first(r, "number_spots", "spots", default=0) or 0
        if not area and not spots:
            continue  # plage without spots
        out.append(
            {
                "region": _first(r, "region", "region_number"),
                "lat": float(lat),
                "lon": float(lon),
                "carrington_lon": _first(r, "carrington_longitude"),
                "area": area,
                "mcintosh": _first(r, "spot_class"),
                "spots": spots,
                "mag": _first(r, "mag_class"),
            }
        )
    return out


def latest_probabilities(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    row = max(rows, key=lambda r: str(_first(r, "date", default="")))
    return {
        "date": _first(row, "date"),
        "c": _first(row, "c_class_1_day"),
        "m": _first(row, "m_class_1_day"),
        "x": _first(row, "x_class_1_day"),
    }


def xray_series(rows: list[dict], step: int = 10) -> dict | None:
    """Long-channel (0.1–0.8 nm) flux, thinned to every `step`-th minute for a sparkline."""
    long = [r for r in rows if r.get("energy") == "0.1-0.8nm" and r.get("flux") is not None]
    if not long:
        return None
    long.sort(key=lambda r: r["time_tag"])
    thinned = long[::step] + ([long[-1]] if (len(long) - 1) % step else [])
    return {
        "latest": {"t": long[-1]["time_tag"], "flux": long[-1]["flux"], "class": flare_class(long[-1]["flux"])},
        "series": [[r["time_tag"], r["flux"]] for r in thinned],
    }


def flare_class(flux: float) -> str:
    for letter, base in (("X", 1e-4), ("M", 1e-5), ("C", 1e-6), ("B", 1e-7), ("A", 1e-8)):
        if flux >= base:
            return f"{letter}{flux / base:.1f}"
    return "A0.0"


def collect_today(errors: list[str]) -> dict:
    """Fetch everything for today.json. Each part fails independently."""
    out: dict = {"sunspot_number": None, "regions": [], "regions_source": None, "flare_probability": None, "xray": None}

    try:
        out["sunspot_number"] = latest_ssn(_get_json(URLS["ssn"]))
    except Exception as e:  # noqa: BLE001
        errors.append(f"ssn: {e}")

    try:
        regions = regions_from_json(_get_json(URLS["regions"]))
        if regions:
            out["regions"], out["regions_source"] = regions, "solar_regions.json"
    except Exception as e:  # noqa: BLE001
        errors.append(f"solar_regions.json: {e}")
    if not out["regions"]:
        try:
            r = sources.http_get(URLS["srs"])
            r.raise_for_status()
            srs = parse_srs(r.text)
            out["regions"], out["regions_source"] = srs["regions"], f"srs.txt {srs['issued']}"
        except Exception as e:  # noqa: BLE001
            errors.append(f"srs: {e}")

    try:
        out["flare_probability"] = latest_probabilities(_get_json(URLS["probabilities"]))
    except Exception as e:  # noqa: BLE001
        errors.append(f"probabilities: {e}")

    try:
        out["xray"] = xray_series(_get_json(URLS["xrays"]))
    except Exception as e:  # noqa: BLE001
        errors.append(f"xrays: {e}")
    return out
