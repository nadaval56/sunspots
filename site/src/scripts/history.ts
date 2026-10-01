// History page: two long SILSO series, bundled at build time (scripts/build_history_series.py).
import { niceTicks } from "../lib/cycle";
import { nearest, renderChart, type Pt } from "../lib/tschart";
import gn from "../data/gn-yearly.json";
import sn from "../data/sn-yearly.json";

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const ticks = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let y = from; y <= to; y += step) out.push(y);
  return out;
};

/** Sunspot groups per year, 1610–1800, with the Maunder minimum shaded. */
function renderMaunder(host: HTMLElement) {
  const rows = (gn as [number, number][]).filter(([y]) => y <= 1800);
  // 0.05 is the series' floor for "no group seen"
  const shown = (v: number) => (v < 0.1 ? "0" : v.toFixed(1));
  renderChart(host, {
    x0: 1610,
    x1: 1801,
    yMax: niceTicks(Math.max(...rows.map((r) => r[1]))).at(-1)!,
    xTicks: ticks(1625, 1800, 25),
    height: 260,
    spans: [{ x0: 1645, x1: 1715, label: "מינימום מאונדר" }],
    label:
      "ממוצע שנתי של מספר קבוצות הכתמים מ-1610 עד 1800. בין 1645 ל-1715 המספר כמעט אפס, ולפני התקופה ואחריה יש עליות וירידות של מחזור.",
    layers: [{ cls: "line-smooth", pts: rows.map(([y, v]) => [y + 0.5, v] as Pt) }],
    probe: (x) => {
      const r = nearest(rows, (r) => r[0] + 0.5, x);
      return r ? [r[0] + 0.5, r[1], `<strong class="num">${r[0]}</strong><br>קבוצות ביום, בממוצע: <span class="num">${shown(r[1])}</span>`] : null;
    },
  });
}

/** The yearly sunspot number since 1700, Schwabe's discovery marked. */
function renderCycles(host: HTMLElement) {
  const rows = sn as [number, number][];
  const last = rows.at(-1)![0];
  renderChart(host, {
    x0: 1700,
    x1: last + 1,
    yMax: niceTicks(Math.max(...rows.map((r) => r[1]))).at(-1)!,
    xTicks: ticks(1700, last, 50),
    height: 260,
    marks: [{ x: 1843, label: "שוואבה, 1843" }],
    label: `ממוצע שנתי של מספר הכתמים מ-1700 עד ${last}. רואים את הגלים של המחזור, בגבהים שונים ובמרחקים שונים זה מזה.`,
    layers: [{ cls: "line-smooth", pts: rows.map(([y, v]) => [y + 0.5, v] as Pt) }],
    probe: (x) => {
      const r = nearest(rows, (r) => r[0] + 0.5, x);
      return r ? [r[0] + 0.5, r[1], `<strong class="num">${r[0]}</strong><br>ממוצע: <span class="num">${r[1].toFixed(0)}</span>`] : null;
    },
  });
}

const m = $("#maunder-chart");
if (m) renderMaunder(m);
const c = $("#cycles-chart");
if (c) renderCycles(c);
