// Pure helpers for the cycle page (no DOM), tested in cycle.test.ts.

/** cycle.json, written by pipeline/daily.py (build_cycle). Missing values are null. */
export interface CycleData {
  generated_at?: string;
  observed: [string, number | null, number | null][]; // month, ssn, smoothed_ssn
  predicted: [string, number, number | null, number | null][]; // month, predicted, low, high
}

/** site/public/data/silso-by-day.json, written by scripts/build_this_day.py. */
export interface SilsoByDay {
  first_year: number;
  last_year: number;
  last_date: string;
  days: Record<string, number[]>; // "MM-DD" → SN per year (index = year − first_year), −1 = no value
}

/** "2024-10" → 2024.79 (middle of the month, in decimal years). */
export function monthToYear(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y + (m - 0.5) / 12;
}

/** Decimal year of a date (UTC). */
export function dateToYear(d: Date): number {
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  return y + (d.getTime() - start) / (Date.UTC(y + 1, 0, 1) - start);
}

export interface ThisDay {
  year: number;
  key: string; // MM-DD
  value: number | null; // null: no observation (or before/after the series)
}

/** Sunspot number on the same calendar day, `yearsBack` years before `today`. */
export function thisDay(table: SilsoByDay, today: Date, yearsBack: number): ThisDay {
  const key = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const year = today.getFullYear() - yearsBack;
  const row = table.days[key];
  let value: number | null = null;
  if (row && year >= table.first_year && year <= table.last_year) {
    const v = row[year - table.first_year];
    value = typeof v === "number" && v >= 0 ? v : null;
  }
  return { year, key, value };
}

/** Round axis ticks: 0, step, 2·step … ≥ max. */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Highest smoothed value in [from, to) months, e.g. the peak of cycle 25. */
export function peakSmoothed(data: CycleData, from: string, to = "9999-99"): { month: string; value: number } | null {
  let best: { month: string; value: number } | null = null;
  for (const [m, , s] of data.observed) {
    if (m < from || m >= to || s == null) continue;
    if (!best || s > best.value) best = { month: m, value: s };
  }
  return best;
}
