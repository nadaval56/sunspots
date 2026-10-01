// A small time-series chart in hand-written SVG (BRIEF §7.1: no chart library).
// Used by the cycle and history pages. Time runs left→right also in RTL pages
// (docs/DECISIONS.md #18).
import { niceTicks } from "./cycle";

const SVG = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

export type Pt = [number, number]; // [decimal year, value]
export interface Layer {
  cls: string;
  pts?: Pt[];
  band?: [number, number, number][]; // [year, low, high]
}
export interface ChartSpec {
  x0: number;
  x1: number;
  yMax: number;
  layers: Layer[];
  xTicks: number[];
  marks?: { x: number; label: string; cls?: string }[];
  /** Shaded periods, e.g. a minimum: drawn behind the data, label at the top. */
  spans?: { x0: number; x1: number; label: string }[];
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

export function renderChart(host: HTMLElement, spec: ChartSpec) {
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

  for (const s of spec.spans ?? []) {
    svgEl("rect", { x: sx(s.x0), y: padT, width: Math.max(1, sx(s.x1) - sx(s.x0)), height: H - padT - padB, class: "span" }, svg);
    svgEl("text", { x: (sx(s.x0) + sx(s.x1)) / 2, y: padT - 6, class: "mark-label", direction: "rtl", "text-anchor": "middle" }, svg).textContent = s.label;
  }
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

export function nearest<T>(rows: T[], xOf: (r: T) => number, x: number): T | null {
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

