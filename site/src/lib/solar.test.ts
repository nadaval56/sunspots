import { describe, expect, it } from "vitest";
import { b0Deg, fitRotation, heliographicToPixel, pixelToHeliographic, type Observation } from "./solar";

// BRIEF §6.5: leading spot, JSOC Ic_1k at 06:00 UTC, 23–27 Sep 2026.
const FIXTURE: [number, number, number, number, number, number][] = [
  [23, 668.2, 547.8, 508.6, 518.0, 475.6],
  [24, 771.7, 541.0, 508.6, 518.0, 475.7],
  [25, 857.2, 530.6, 508.6, 518.0, 475.8],
  [26, 922.8, 520.1, 508.6, 518.0, 476.0],
  [27, 966.4, 508.0, 508.8, 517.4, 475.9],
];
const obs: Observation[] = FIXTURE.map(([d, px, py, cx, cy, r]) => ({
  t: new Date(Date.UTC(2026, 8, d, 6)),
  px,
  py,
  disk: { cx, cy, r },
}));

describe("BRIEF §6.5 acceptance fixture", () => {
  it("B0 on 23 Sep 06:00 is +7.03°", () => {
    expect(b0Deg(new Date(Date.UTC(2026, 8, 23, 6)))).toBeCloseTo(7.03, 1);
  });

  it("recovers the rotation with B0 correction", () => {
    const f = fitRotation(obs, true);
    expect(Math.abs(f.omega - 13.64)).toBeLessThan(0.1);
    expect(Math.abs(f.meanLat - 3.1)).toBeLessThan(0.15);
    expect(Math.max(...f.lats) - Math.min(...f.lats)).toBeLessThanOrEqual(0.4);
    expect(Math.abs(f.pSyn - 26.4)).toBeLessThan(0.2);
    expect(Math.abs(f.pSid - 24.6)).toBeLessThan(0.2);
    expect(f.rms).toBeLessThan(0.3);
  });

  it("latitude wanders without B0 correction", () => {
    const f = fitRotation(obs, false);
    expect(Math.max(...f.lats) - Math.min(...f.lats)).toBeGreaterThan(3);
  });
});

it("heliographic round trip", () => {
  const disk = { cx: 500, cy: 500, r: 400 };
  for (const [B, L] of [[0, 0], [20, -40], [-35, 60]]) {
    const p = heliographicToPixel(B, L, disk, 7);
    const hg = pixelToHeliographic(p.x, p.y, disk, 7)!;
    expect(hg.B).toBeCloseTo(B, 6);
    expect(hg.L).toBeCloseTo(L, 6);
  }
});
