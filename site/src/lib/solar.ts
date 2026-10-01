// Solar geometry for the browser. Mirrors pipeline/solar.py; both are pinned
// to the BRIEF §6.5 acceptance fixture (src/lib/solar.test.ts, tests/test_solar.py).

export const SIDEREAL_YEAR_DAYS = 365.256;
export const EARTH_RADII_PER_SUN = 109.1;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface Disk {
  cx: number;
  cy: number;
  r: number;
}

function julianDay(t: Date): number {
  return t.getTime() / 864e5 + 2440587.5;
}

/** Heliographic latitude of the disk centre (BRIEF §5.3), degrees. */
export function b0Deg(t: Date): number {
  const jd = julianDay(t);
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = rad((357.528 + 0.9856003 * n) % 360);
  const lambda = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const K = 73.6667 + (1.3958333 * (jd - 2396758)) / 36525;
  return deg(Math.asin(Math.sin(rad(lambda - K)) * Math.sin(rad(7.25))));
}

/** Screen point → heliographic (B, L) in degrees. L is from the central meridian, west positive. */
export function pixelToHeliographic(px: number, py: number, disk: Disk, b0: number): { B: number; L: number } | null {
  const X = (px - disk.cx) / disk.r;
  const Y = -(py - disk.cy) / disk.r;
  const rho2 = X * X + Y * Y;
  if (rho2 > 1) return null;
  const Z = Math.sqrt(1 - rho2);
  const b = rad(b0);
  const sinB = Y * Math.cos(b) + Z * Math.sin(b);
  return {
    B: deg(Math.asin(Math.max(-1, Math.min(1, sinB)))),
    L: deg(Math.atan2(X, Z * Math.cos(b) - Y * Math.sin(b))),
  };
}

/** Heliographic (B, L) → screen point; `visible` is false on the far hemisphere. */
export function heliographicToPixel(B: number, L: number, disk: Disk, b0: number) {
  const Br = rad(B), Lr = rad(L), b = rad(b0);
  const X = Math.cos(Br) * Math.sin(Lr);
  const Y = Math.sin(Br) * Math.cos(b) - Math.cos(Br) * Math.cos(Lr) * Math.sin(b);
  const Z = Math.sin(Br) * Math.sin(b) + Math.cos(Br) * Math.cos(Lr) * Math.cos(b);
  return { x: disk.cx + X * disk.r, y: disk.cy - Y * disk.r, visible: Z >= 0 };
}

/** Snodgrass & Ulrich (1990) sidereal rotation rate, deg/day. */
export function snodgrassSidereal(B: number): number {
  const s2 = Math.sin(rad(B)) ** 2;
  return 14.713 - 2.396 * s2 - 1.787 * s2 * s2;
}

/** Rotation rate as seen from Earth, deg/day. */
export function synodicRate(B: number): number {
  return snodgrassSidereal(B) - 360 / SIDEREAL_YEAR_DAYS;
}

export function synodicToSidereal(pSyn: number): number {
  return 1 / (1 / pSyn + 1 / SIDEREAL_YEAR_DAYS);
}

export interface Observation {
  t: Date;
  px: number;
  py: number;
  disk: Disk;
}

export interface RotationFit {
  omega: number; // synodic deg/day
  pSyn: number;
  pSid: number;
  meanLat: number;
  lats: number[];
  longs: number[];
  days: number[];
  intercept: number;
  rms: number;
}

/** Straight-line fit of L(t) (BRIEF §6.2). */
export function fitRotation(obs: Observation[], correctB0 = true): RotationFit {
  const t0 = obs[0].t.getTime();
  const days: number[] = [], longs: number[] = [], lats: number[] = [];
  for (const o of obs) {
    const hg = pixelToHeliographic(o.px, o.py, o.disk, correctB0 ? b0Deg(o.t) : 0);
    if (!hg) throw new Error("point off disk");
    days.push((o.t.getTime() - t0) / 864e5);
    longs.push(hg.L);
    lats.push(hg.B);
  }
  const n = days.length;
  const mx = days.reduce((a, b) => a + b, 0) / n;
  const my = longs.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (days[i] - mx) ** 2;
    sxy += (days[i] - mx) * (longs[i] - my);
  }
  const omega = sxy / sxx;
  const intercept = my - omega * mx;
  const rms = Math.sqrt(longs.reduce((a, L, i) => a + (L - (omega * days[i] + intercept)) ** 2, 0) / n);
  const pSyn = 360 / omega;
  return {
    omega,
    pSyn,
    pSid: synodicToSidereal(pSyn),
    meanLat: lats.reduce((a, b) => a + b, 0) / n,
    lats,
    longs,
    days,
    intercept,
    rms,
  };
}
