import { describe, expect, it } from "vitest";
import { computeResults, scheinerCurve, scheinerVisibleFraction, sphereX, windowFrom, type Track } from "./lab";
import { b0Deg } from "./solar";
import type { LabFrame } from "./types";

// BRIEF §6.5: leading spot in JSOC Ic_1k (1024 px) at 06:00 UTC, with the brief's disk fits.
const FIXTURE: [number, number, number, number, number, number][] = [
  [23, 668.2, 547.8, 508.6, 518.0, 475.6],
  [24, 771.7, 541.0, 508.6, 518.0, 475.7],
  [25, 857.2, 530.6, 508.6, 518.0, 475.8],
  [26, 922.8, 520.1, 508.6, 518.0, 476.0],
  [27, 966.4, 508.0, 508.8, 517.4, 475.9],
];
const S = 1024;
const frames: LabFrame[] = FIXTURE.map(([d, , , cx, cy, r]) => {
  const t = new Date(Date.UTC(2026, 8, d, 6));
  return {
    date: `2026-09-${d}`,
    t: t.toISOString(),
    key: `fixture/${d}.jpg`,
    jpg: `fixture/${d}.jpg`,
    source: "jsoc",
    cx: cx / S,
    cy: cy / S,
    r: r / S,
    b0: b0Deg(t),
  };
});
const track: Track = Object.fromEntries(FIXTURE.map(([d, px, py]) => [`2026-09-${d}`, [px / S, py / S]]));

describe("lab results on the BRIEF §6.5 fixture", () => {
  it("recovers ω, periods, latitude and fit quality with B0 correction", () => {
    const r = computeResults(frames, track, true);
    expect(r.points).toHaveLength(5);
    const f = r.fit!;
    expect(Math.abs(f.omega - 13.64)).toBeLessThan(0.1);
    expect(Math.abs(f.pSyn - 26.4)).toBeLessThan(0.2);
    expect(Math.abs(f.pSid - 24.6)).toBeLessThan(0.2);
    expect(Math.abs(f.meanLat - 3.1)).toBeLessThan(0.15);
    for (const p of r.points) expect(Math.abs(p.B - f.meanLat)).toBeLessThanOrEqual(0.2);
    expect(f.rms).toBeLessThan(0.3);
    // Snodgrass at ~3° is ~24.5 d sidereal
    expect(r.expectedSid!).toBeGreaterThan(24.3);
    expect(r.expectedSid!).toBeLessThan(24.7);
  });

  it("latitude wanders without B0 correction", () => {
    const r = computeResults(frames, track, false);
    const lats = r.points.map((p) => p.B);
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(3);
    // monotonic drift, not noise
    for (let i = 1; i < lats.length; i++) expect(lats[i]).toBeGreaterThan(lats[i - 1]);
  });

  it("fit is anchored to the first frame of the set", () => {
    const r = computeResults(frames, { ...track, "2026-09-23": undefined as never }, true);
    const f = r.fit!;
    for (const p of r.points) expect(Math.abs(f.a + f.omega * p.days - p.L)).toBeLessThan(0.5);
  });

  it("needs two points for a fit", () => {
    expect(computeResults(frames, { "2026-09-24": track["2026-09-24"] }, true).fit).toBeNull();
    expect(computeResults(frames, {}, true).points).toHaveLength(0);
  });

  it("the measured screen x follows the rotating-sphere curve", () => {
    const r = computeResults(frames, track, true);
    for (const p of r.points) expect(Math.abs(sphereX(r.fit!, p.days) - p.X)).toBeLessThan(0.01);
  });
});

describe("Scheiner's moon (BRIEF §6.3.1)", () => {
  it("visible fraction asin(1/d)/π", () => {
    expect(scheinerVisibleFraction(1)).toBeCloseTo(0.5, 6);
    expect(Math.round(scheinerVisibleFraction(1.1) * 100)).toBe(36);
    expect(Math.round(scheinerVisibleFraction(2) * 100)).toBe(17);
    expect(scheinerVisibleFraction(3)).toBeCloseTo(Math.asin(1 / 3) / Math.PI, 9);
  });

  it("d = 1 reproduces the sphere; large d tends to constant speed", () => {
    const fit = { a: -25, omega: 13.6, meanLat: 3 };
    for (const [t, x] of scheinerCurve(fit, 1)) expect(x).toBeCloseTo(sphereX(fit, t), 9);
    const far = scheinerCurve(fit, 3, 10);
    const steps = far.slice(1).map((p, i) => p[1] - far[i][1]);
    const spread = (Math.max(...steps) - Math.min(...steps)) / Math.max(...steps);
    expect(spread).toBeLessThan(0.2);
    // and it still enters and leaves at the limb
    expect(Math.abs(far[0][1])).toBeCloseTo(Math.cos((3 * Math.PI) / 180), 6);
  });
});

it("windowFrom picks 14 consecutive calendar days", () => {
  const days = ["2026-09-01", "2026-09-05", "2026-09-14", "2026-09-15", "2026-08-31"].map((date) => ({ date }));
  expect(windowFrom(days, "2026-09-01").map((d) => d.date)).toEqual(["2026-09-01", "2026-09-05", "2026-09-14"]);
});
