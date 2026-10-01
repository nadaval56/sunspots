import { describe, expect, it } from "vitest";
import { dateToYear, monthToYear, niceTicks, peakSmoothed, thisDay, type CycleData, type SilsoByDay } from "./cycle";

const table: SilsoByDay = {
  first_year: 1818,
  last_year: 1977,
  last_date: "1977-12-31",
  days: { "10-01": Array.from({ length: 160 }, (_, i) => (i === 0 ? -1 : 1818 + i - 1800)), "02-29": Array(160).fill(-1) },
};

describe("thisDay", () => {
  const today = new Date(2026, 9, 1); // 1 Oct 2026, local time
  it("picks the same calendar day N years back", () => {
    expect(thisDay(table, today, 50)).toEqual({ year: 1976, key: "10-01", value: 176 });
    expect(thisDay(table, today, 200)).toEqual({ year: 1826, key: "10-01", value: 26 });
  });
  it("returns null for missing values and out-of-range years", () => {
    expect(thisDay(table, today, 208).value).toBeNull(); // 1818: −1
    expect(thisDay(table, today, 300).value).toBeNull(); // before the series
    expect(thisDay(table, new Date(2028, 1, 29), 100).value).toBeNull();
  });
});

describe("axes and peaks", () => {
  it("converts months and dates to decimal years", () => {
    expect(monthToYear("2024-01")).toBeCloseTo(2024 + 0.5 / 12, 6);
    expect(dateToYear(new Date(Date.UTC(2026, 0, 1)))).toBe(2026);
  });
  it("makes round ticks", () => {
    expect(niceTicks(230)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(niceTicks(0)).toEqual([0]);
  });
  it("finds the smoothed peak", () => {
    const d: CycleData = {
      observed: [["2019-12", 1, 1.8], ["2024-10", 166, 160.9], ["2024-11", 150, null], ["2025-01", 137, 150.2]],
      predicted: [],
    };
    expect(peakSmoothed(d, "2019-12")).toEqual({ month: "2024-10", value: 160.9 });
  });
});
