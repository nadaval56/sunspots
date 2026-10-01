"""Build the static SILSO tables for the cycle page (BRIEF §4.4, §7.3.5).

    python -m scripts.build_this_day

Reads data/silso_daily.csv (WDC-SILSO daily total sunspot number, `;`-separated:
year;month;day;decimal_year;SN;stddev;n_obs;provisional, SN = -1 when missing) and writes:

  site/public/data/silso-by-day.json   {"first_year", "last_year", "last_date", "days": {"MM-DD": [SN per year]}}
      A dense array per calendar day, indexed by year - first_year. -1 = no value
      (missing in SILSO, a 29 Feb of a non-leap year, or after last_date). The page
      fetches it and picks "today minus 50/100/200 years" in the browser, so it never
      goes stale when the year changes.
  site/src/data/silso-yearly.json      [[year, mean SN, days with data], ...]
      Yearly means of the daily values, imported by cycle.astro at build time.

Only the standard library, so it runs anywhere. Re-run after refreshing the CSV.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / "data/silso_daily.csv"
BY_DAY = ROOT / "site/public/data/silso-by-day.json"
YEARLY = ROOT / "site/src/data/silso-yearly.json"


def read_rows(path: Path = CSV):
    for line in path.read_text().splitlines():
        parts = [p.strip() for p in line.split(";")]
        if len(parts) < 5 or not parts[0].isdigit():
            continue
        yield int(parts[0]), int(parts[1]), int(parts[2]), int(float(parts[4]))


def build(rows) -> tuple[dict, list]:
    rows = list(rows)
    first, last = rows[0][0], rows[-1][0]
    n = last - first + 1
    days: dict[str, list[int]] = {}
    sums: dict[int, list[int]] = {}
    for y, m, d, sn in rows:
        key = f"{m:02d}-{d:02d}"
        arr = days.setdefault(key, [-1] * n)
        arr[y - first] = sn
        if sn >= 0:
            s = sums.setdefault(y, [0, 0])
            s[0] += sn
            s[1] += 1
    y, m, d, _ = rows[-1]
    by_day = {
        "source": "WDC-SILSO, Royal Observatory of Belgium, Brussels",
        "first_year": first,
        "last_year": last,
        "last_date": f"{y:04d}-{m:02d}-{d:02d}",
        "days": dict(sorted(days.items())),
    }
    yearly = [[yr, round(s[0] / s[1], 1), s[1]] for yr, s in sorted(sums.items())]
    return by_day, yearly


def main() -> int:
    by_day, yearly = build(read_rows())
    BY_DAY.parent.mkdir(parents=True, exist_ok=True)
    YEARLY.parent.mkdir(parents=True, exist_ok=True)
    BY_DAY.write_text(json.dumps(by_day, separators=(",", ":")))
    YEARLY.write_text(json.dumps(yearly, separators=(",", ":")))
    print(f"{BY_DAY.relative_to(ROOT)}: {BY_DAY.stat().st_size / 1024:.0f} KB, "
          f"{YEARLY.relative_to(ROOT)}: {YEARLY.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
