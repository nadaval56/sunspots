// Pure, testable logic of the rotation lab (BRIEF §6). The DOM side lives in
// src/scripts/lab.ts; the solar geometry itself lives in ./solar.ts.
import { b0Deg, fitRotation, pixelToHeliographic, snodgrassSidereal, type RotationFit } from "./solar";
import type { LabFrame } from "./types";

/** A mark, normalized to the image: [x, y] in 0..1, y down. */
export type Mark = [number, number];
/** One track: marks keyed by the frame's date (YYYY-MM-DD). */
export type Track = Record<string, Mark>;

/** Minimum number of marked days before the lab reports a period. */
export const MIN_DAYS = 3;

export interface TrackPoint {
  frame: LabFrame;
  index: number;
  days: number; // since the first frame of the set
  L: number; // heliographic longitude from the central meridian, west positive, deg
  B: number; // heliographic latitude, deg
  X: number; // screen x in solar radii, west positive
}

export interface TrackResult {
  points: TrackPoint[];
  /** Straight-line fit of L(t); null with fewer than 2 points. */
  fit: (RotationFit & { a: number }) | null;
  /** Expected sidereal period at the mean latitude (Snodgrass & Ulrich 1990), days. */
  expectedSid: number | null;
}

const diskOf = (f: LabFrame) => ({ cx: f.cx, cy: f.cy, r: f.r });
const timeOf = (f: LabFrame) => new Date(f.t);

/** Keeps a mark inside 0.985 R so the inverse projection is always defined. */
export function clampToDisk(f: LabFrame, x: number, y: number, limit = 0.985): Mark {
  const dx = x - f.cx, dy = y - f.cy, d = Math.hypot(dx, dy), lim = f.r * limit;
  return d > lim ? [f.cx + (dx * lim) / d, f.cy + (dy * lim) / d] : [x, y];
}

export function onDisk(f: LabFrame, x: number, y: number, limit = 0.985): boolean {
  return Math.hypot(x - f.cx, y - f.cy) <= f.r * limit;
}

/** Turns one track's marks into heliographic points and fits the rotation (BRIEF §6.2). */
export function computeResults(frames: LabFrame[], track: Track, correctB0: boolean): TrackResult {
  if (!frames.length) return { points: [], fit: null, expectedSid: null };
  const t0 = timeOf(frames[0]).getTime();
  const points: TrackPoint[] = [];
  frames.forEach((frame, index) => {
    const m = track[frame.date];
    if (!m) return;
    const [x, y] = clampToDisk(frame, m[0], m[1], 0.9999);
    const hg = pixelToHeliographic(x, y, diskOf(frame), correctB0 ? b0Deg(timeOf(frame)) : 0);
    if (!hg) return;
    points.push({
      frame,
      index,
      days: (timeOf(frame).getTime() - t0) / 864e5,
      L: hg.L,
      B: hg.B,
      X: (x - frame.cx) / frame.r,
    });
  });
  if (points.length < 2) return { points, fit: null, expectedSid: null };

  const f = fitRotation(
    points.map((p) => {
      const [x, y] = clampToDisk(p.frame, track[p.frame.date][0], track[p.frame.date][1], 0.9999);
      return { t: timeOf(p.frame), px: x, py: y, disk: diskOf(p.frame) };
    }),
    correctB0,
  );
  // fitRotation counts days from the first marked point; re-anchor to the first frame.
  const a = f.intercept - f.omega * points[0].days;
  return { points, fit: { ...f, a }, expectedSid: 360 / snodgrassSidereal(f.meanLat) };
}

/** Screen x (in solar radii) of a point on a rotating sphere at the fitted rate (BRIEF §6.2). */
export function sphereX(fit: { a: number; omega: number; meanLat: number }, t: number): number {
  return Math.cos((fit.meanLat * Math.PI) / 180) * Math.sin(((fit.a + fit.omega * t) * Math.PI) / 180);
}

/** Fraction of an orbit of radius d·R in which a body is seen against the disk: asin(1/d)/π (BRIEF §6.3.1). */
export function scheinerVisibleFraction(d: number): number {
  return Math.asin(1 / Math.max(1, d)) / Math.PI;
}

/**
 * Screen x of Scheiner's alternative: a small moon on a circular orbit of radius d·R,
 * seen edge on. Its angular rate is chosen so that it crosses the disk in the same time
 * as the measured spot and passes the central meridian at the same moment; with d = 1 it
 * is the rotating-sphere curve, and as d grows it tends to a constant-speed line.
 * Returns the curve over the crossing, [t, x] pairs.
 */
export function scheinerCurve(fit: { a: number; omega: number; meanLat: number }, d: number, steps = 80): [number, number][] {
  const asinDeg = (Math.asin(1 / Math.max(1, d)) * 180) / Math.PI;
  const omegaMoon = (fit.omega * asinDeg) / 90; // deg/day
  const tc = -fit.a / fit.omega;
  const half = 90 / fit.omega; // the spot needs 180/ω days to cross
  const cB = Math.cos((fit.meanLat * Math.PI) / 180);
  const out: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const t = tc - half + (2 * half * k) / steps;
    out.push([t, cB * d * Math.sin((omegaMoon * (t - tc) * Math.PI) / 180)]);
  }
  return out;
}

/** Orbital period, in days, of the moon in `scheinerCurve` (it completes 360° at omegaMoon). */
export function scheinerPeriod(fit: { omega: number }, d: number): number {
  const asinDeg = (Math.asin(1 / Math.max(1, d)) * 180) / Math.PI;
  return 360 / ((fit.omega * asinDeg) / 90);
}

/** Calendar days between two YYYY-MM-DD dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
}

/** Frames whose date falls within `span` consecutive calendar days starting at `start` (BRIEF §6.3.4). */
export function windowFrom<T extends { date: string }>(days: T[], start: string, span = 14): T[] {
  return days
    .filter((d) => {
      const k = daysBetween(start, d.date);
      return k >= 0 && k < span;
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}

/** "−3.1" with a real minus sign. */
export function signed(v: number, digits = 1): string {
  return (v < 0 ? "−" : "") + Math.abs(v).toFixed(digits);
}
