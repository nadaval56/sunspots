// Cycle page: NOAA observed vs. predicted (cycle.json at runtime), "this day in history"
// (silso-by-day.json, a static file) and the long SILSO record (bundled at build time).
// Time runs left→right also in this RTL page (docs/DECISIONS.md #18).
import { MEDIA_BASE } from "../config";
import { dateToYear, monthToYear, niceTicks, peakSmoothed, thisDay, type CycleData, type SilsoByDay } from "../lib/cycle";
import yearly from "../data/silso-yearly.json";

const SVG = "http://www.w3.org/2000/svg";
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, "/");
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const monthLabel = (m: string) => `${HE_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(v >= 100 ? 0 : 1));

// --- a small time-series chart ------------------------------------------------------

type Pt = [number, number]; // [decimal year, value]
interface Layer {
  cls: string;
  pts?: Pt[];
  band?: [number, number, number][]; // [year, low, high]
}
interface ChartSpec {
  x0: number;
  x1: number;
  yMax: number;
  layers: Layer[];
  xTicks: number[];
  marks?: { x: number; label: string; cls?: string }[];
  /** Nearest data point at decimal year x → [x of the point, y for the dot, tooltip html]. */
  probe: (x: number) => [number, number | null, string] | null;
  label: string;
  height?: number;
}

function pathOf(pts: Pt[], sx: (x: number) => number, sy: (y: number) => number): string {
  let d = "";
  let pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
    pen = true;
  }
  return d;
}

const charts: [HTMLElement, ChartSpec][] = [];
let lastWidth = 0;
window.addEventListener("resize", () => {
  if (Math.abs(window.innerWidth - lastWidth) < 40) return;
  lastWidth = window.innerWidth;
  for (const [host, spec] of charts) drawChart(host, spec);
});

function renderChart(host: HTMLElement, spec: ChartSpec) {
  charts.push([host, spec]);
  lastWidth = window.innerWidth;
  drawChart(host, spec);
}

/** The viewBox follows the real width, so labels keep their size on a phone. */
function drawChart(host: HTMLElement, spec: ChartSpec) {
  const W = Math.max(280, Math.round(host.clientWidth || 760));
  const H = Math.round(Math.min(spec.height ?? 300, Math.max(220, W * 0.62)));
  const padL = 36, padR = 10, padT = 22, padB = 26;
  // drop every other x tick until labels have room
  let xTicks = spec.xTicks;
  while (xTicks.length > 2 && ((W - padL - padR) / xTicks.length) < 52) xTicks = xTicks.filter((_, i) => i % 2 === 0);
  spec = { ...spec, xTicks };
  const sx = (x: number) => padL + ((x - spec.x0) / (spec.x1 - spec.x0)) * (W - padL - padR);
  const sy = (y: number) => padT + (1 - y / spec.yMax) * (H - padT - padB);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "ts-chart", role: "img", "aria-label": spec.label });

  for (const t of niceTicks(spec.yMax)) {
    if (t > spec.yMax) break;
    svgEl("line", { x1: padL, x2: W - padR, y1: sy(t), y2: sy(t), class: "grid" }, svg);
    svgEl("text", { x: padL - 6, y: sy(t) + 4, class: "axis-label", "text-anchor": "end" }, svg).textContent = String(t);
  }
  for (const t of spec.xTicks) {
    svgEl("line", { x1: sx(t), x2: sx(t), y1: H - padB, y2: H - padB + 4, class: "axis" }, svg);
    svgEl("text", { x: sx(t), y: H - 6, class: "axis-label", "text-anchor": "middle" }, svg).textContent = String(t);
  }
  svgEl("line", { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: "axis" }, svg);

  for (const m of spec.marks ?? []) {
    svgEl("line", { x1: sx(m.x), x2: sx(m.x), y1: padT, y2: H - padB, class: m.cls ?? "mark" }, svg);
    const nearLeft = sx(m.x) < W * 0.3; // Hebrew label: grows leftwards from the line, rightwards near the left edge
    svgEl("text", { x: sx(m.x) + (nearLeft ? 4 : -4), y: padT - 6, class: "mark-label", direction: "rtl", "text-anchor": nearLeft ? "end" : "start" }, svg).textContent = m.label;
  }
  for (const l of spec.layers) {
    if (l.band?.length) {
      const top = l.band.map(([x, , hi]) => `${sx(x).toFixed(1)},${sy(hi).toFixed(1)}`);
      const bot = l.band.map(([x, lo]) => `${sx(x).toFixed(1)},${sy(lo).toFixed(1)}`).reverse();
      svgEl("path", { d: `M${top.join("L")}L${bot.join("L")}Z`, class: l.cls }, svg);
    } else if (l.pts?.length) {
      svgEl("path", { d: pathOf(l.pts, sx, sy), class: l.cls }, svg);
    }
  }

  const cross = svgEl("line", { y1: padT, y2: H - padB, class: "crosshair", visibility: "hidden" }, svg);
  const dot = svgEl("circle", { r: 4, class: "probe-dot", visibility: "hidden" }, svg);
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const x = spec.x0 + (((e.clientX - box.left) / box.width) * W - padL) / (W - padL - padR) * (spec.x1 - spec.x0);
    const hit = spec.probe(x);
    if (!hit) return hide();
    const [px, py, html] = hit;
    cross.setAttribute("x1", String(sx(px)));
    cross.setAttribute("x2", String(sx(px)));
    cross.setAttribute("visibility", "visible");
    if (py != null) {
      dot.setAttribute("cx", String(sx(px)));
      dot.setAttribute("cy", String(sy(py)));
      dot.setAttribute("visibility", "visible");
    } else dot.setAttribute("visibility", "hidden");
    tip.hidden = false;
    tip.innerHTML = html;
    const left = (sx(px) / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 80), box.width - 80)}px`;
  });
  svg.addEventListener("pointerleave", hide);
  host.replaceChildren(svg, tip);
}

function nearest<T>(rows: T[], xOf: (r: T) => number, x: number): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const r of rows) {
    const d = Math.abs(xOf(r) - x);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

// --- 1. the current cycle (NOAA) -----------------------------------------------------

function renderCycle(data: CycleData) {
  const host = $("#cycle-chart");
  const obs = data.observed;
  const pred = data.predicted;
  const x0 = obs.length ? monthToYear(obs[0][0]) - 0.04 : 2008.9;
  const x1 = Math.max(pred.length ? monthToYear(pred[pred.length - 1][0]) : 0, obs.length ? monthToYear(obs[obs.length - 1][0]) : 0) + 0.04;
  const yMaxRaw = Math.max(
    10,
    ...obs.map((r) => r[1] ?? 0),
    ...pred.map((r) => r[3] ?? r[1]),
  );
  const yMax = niceTicks(yMaxRaw).at(-1) ?? yMaxRaw;
  const xTicks: number[] = [];
  for (let y = Math.ceil(x0 / 2) * 2; y <= x1; y += 2) xTicks.push(y);

  // one row per month: observed, smoothed, predicted, low, high
  const rows = new Map<string, { m: string; ssn?: number | null; sm?: number | null; p?: number; lo?: number | null; hi?: number | null }>();
  for (const [m, ssn, sm] of obs) rows.set(m, { m, ssn, sm });
  for (const [m, p, lo, hi] of pred) rows.set(m, { ...(rows.get(m) ?? { m }), p, lo, hi });
  const all = [...rows.values()].sort((a, b) => (a.m < b.m ? -1 : 1));

  const now = dateToYear(new Date());
  renderChart(host, {
    x0,
    x1,
    yMax,
    xTicks,
    label: "מספר הכתמים החודשי מאז סוף 2008: נצפה, ממוצע מוחלק, ותחזית NOAA עם טווח.",
    marks: [
      { x: monthToYear("2019-12"), label: "תחילת מחזור 25" },
      ...(now > x0 && now < x1 ? [{ x: now, label: "היום", cls: "mark mark-now" }] : []),
    ],
    layers: [
      { cls: "band", band: pred.filter((r) => r[2] != null && r[3] != null).map((r) => [monthToYear(r[0]), r[2]!, r[3]!]) },
      { cls: "line-monthly", pts: obs.map((r) => [monthToYear(r[0]), r[1] ?? NaN]) },
      { cls: "line-smooth", pts: obs.map((r) => [monthToYear(r[0]), r[2] ?? NaN]) },
      { cls: "line-pred", pts: pred.map((r) => [monthToYear(r[0]), r[1]]) },
    ],
    probe: (x) => {
      const r = nearest(all, (r) => monthToYear(r.m), x);
      if (!r) return null;
      const lines = [`<strong>${monthLabel(r.m)}</strong>`];
      if (r.ssn != null) lines.push(`חודשי: <span class="num">${fmt(r.ssn)}</span>`);
      if (r.sm != null) lines.push(`מוחלק: <span class="num">${fmt(r.sm)}</span>`);
      if (r.p != null) {
        lines.push(`תחזית: <span class="num">${fmt(r.p)}</span>`);
        if (r.lo != null && r.hi != null) lines.push(`טווח: <span class="num ltr">${fmt(r.lo)}–${fmt(r.hi)}</span>`);
      }
      const y = r.sm ?? r.p ?? r.ssn ?? null;
      return [monthToYear(r.m), y, lines.join("<br>")];
    },
  });

  const p24 = peakSmoothed(data, "2008-12", "2019-12");
  const p25 = peakSmoothed(data, "2019-12");
  const lastObs = obs.at(-1);
  const facts: string[] = [];
  if (p24) facts.push(`השיא של מחזור 24 (בממוצע המוחלק): <span class="num">${fmt(p24.value)}</span>, ב${monthLabel(p24.month)}.`);
  if (p25) facts.push(`השיא של מחזור 25 עד עכשיו: <span class="num">${fmt(p25.value)}</span>, ב${monthLabel(p25.month)}.`);
  if (lastObs) facts.push(`החודש האחרון בנתונים: ${monthLabel(lastObs[0])}, עם <span class="num">${fmt(lastObs[1])}</span> כתמים בממוצע ליום.`);
  $("#cycle-facts").innerHTML = facts.map((f) => `<li>${f}</li>`).join("");
  if (data.generated_at) $("#cycle-updated").textContent = `הנתונים עודכנו ב-${new Date(data.generated_at).toLocaleDateString("he-IL")}.`;
}

// --- 2. this day in history (SILSO) --------------------------------------------------

let table: SilsoByDay | null = null;

function renderThisDay(day: Date) {
  if (!table) return;
  const box = $("#this-day-cards");
  box.replaceChildren();
  for (const back of [50, 100, 200]) {
    const r = thisDay(table, day, back);
    const card = document.createElement("div");
    card.className = "stat";
    const dt = document.createElement("dt");
    dt.className = "label";
    dt.textContent = `לפני ${back} שנה`;
    const dd = document.createElement("dd");
    const date = new Date(r.year, day.getMonth(), day.getDate());
    const dateText = r.key === "02-29" && date.getMonth() !== 1 ? `29 בפברואר ${r.year}` : date.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
    dd.innerHTML =
      r.value == null
        ? `<span class="big muted-val">אין נתון</span><span class="sub">${dateText}</span>`
        : `<span class="big num">${r.value}</span><span class="sub">${dateText}</span>`;
    card.append(dt, dd);
    box.append(card);
  }
  const last = table.last_date;
  $("#this-day-note").textContent = `הנתונים היומיים של SILSO מגיעים עד ${new Date(last + "T12:00:00Z").toLocaleDateString("he-IL")}. "אין נתון" פירושו שבאותו יום לא נשמרה תצפית.`;
}

async function setupThisDay() {
  table = await getJSON<SilsoByDay>(`${BASE}data/silso-by-day.json`);
  if (!table) {
    $("#this-day-cards").textContent = "לא הצלחנו לטעון את הנתונים ההיסטוריים.";
    return;
  }
  const input = $<HTMLInputElement>("#this-day-date");
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  input.value = iso(today);
  input.addEventListener("change", () => {
    const [y, m, d] = input.value.split("-").map(Number);
    if (y && m && d) renderThisDay(new Date(y, m - 1, d));
  });
  renderThisDay(today);
}

// --- 3. two centuries (SILSO yearly means, bundled) ---------------------------------

function renderLongTerm() {
  const rows = yearly as [number, number, number][];
  const thisYear = new Date().getFullYear();
  const pts: Pt[] = rows.map(([y, v]) => [y + 0.5, v]);
  const yMax = niceTicks(Math.max(...rows.map((r) => r[1]))).at(-1)!;
  const xTicks: number[] = [];
  for (let y = 1825; y <= rows.at(-1)![0]; y += 25) xTicks.push(y);
  renderChart($("#longterm-chart"), {
    x0: rows[0][0],
    x1: rows.at(-1)![0] + 1,
    yMax,
    xTicks,
    height: 260,
    label: `ממוצע שנתי של מספר הכתמים, ${rows[0][0]} עד ${rows.at(-1)![0]}, לפי SILSO.`,
    layers: [{ cls: "line-smooth", pts }],
    probe: (x) => {
      const r = nearest(rows, (r) => r[0] + 0.5, x);
      if (!r) return null;
      const partial = r[0] === thisYear || r[2] < 200 ? `<br><span class="sub">מבוסס על ${r[2]} ימי תצפית</span>` : "";
      return [r[0] + 0.5, r[1], `<strong class="num">${r[0]}</strong><br>ממוצע: <span class="num">${fmt(r[1])}</span>${partial}`];
    },
  });
}

async function main() {
  renderLongTerm();
  setupThisDay();
  const data = await getJSON<CycleData>(`${MEDIA_BASE}/cycle.json`);
  if (data && (data.observed?.length || data.predicted?.length)) {
    renderCycle(data);
  } else {
    $("#cycle-chart").innerHTML = `<p class="banner-warn">נתוני המחזור מ-NOAA עדיין לא זמינים. הם יופיעו כאן אחרי הריצה היומית הבאה.</p>`;
    $("#cycle-legend").hidden = true;
  }
}

main();
