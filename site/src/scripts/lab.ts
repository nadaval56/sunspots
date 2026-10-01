// Rotation lab (BRIEF §6): the island that drives src/pages/lab.astro.
// Ported from docs/reference/rotation-lab-prototype.html; the math lives in
// src/lib/lab.ts and src/lib/solar.ts.
import { MEDIA_BASE } from "../config";
import {
  MIN_DAYS,
  clampToDisk,
  computeResults,
  onDisk,
  scheinerCurve,
  scheinerPeriod,
  scheinerVisibleFraction,
  signed,
  sphereX,
  windowFrom,
  type Track,
  type TrackResult,
} from "../lib/lab";
import { b0Deg } from "../lib/solar";
import type { DailyIndex, LabData, LabFrame } from "../lib/types";

type Mode = "archive" | "week" | "range";

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const SVG = "http://www.w3.org/2000/svg";
const TRACK_NAMES = ["כתם א׳", "כתם ב׳"];
const PLATE_COLORS = ["#38d6ff", "#7dff6a"]; // --track-1 / --track-2, read again from CSS at start
const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)"];
const SPAN = 14;

const root = $("#lab");
const ARCHIVE_BASE = root.dataset.archive ?? "/lab-archive/";

// --- state ---------------------------------------------------------------------------

interface DataSet {
  id: string;
  frames: LabFrame[];
  imageBase: string;
  example: Track | null;
  store: "archive" | "live";
}

const state = {
  mode: "archive" as Mode,
  set: null as DataSet | null,
  day: 0,
  track: 0,
  // marks are keyed by date, so one store serves both live modes
  stores: { archive: [{}, {}] as Track[], live: [{}, {}] as Track[] },
  example: { archive: [false, false], live: [false, false] },
  scheinerD: 1.4,
};
let dailyCache: DailyIndex | null | undefined;
let archiveCache: LabData | null = null;

const tracks = () => state.stores[state.set?.store ?? "archive"];
const exampleFlags = () => state.example[state.set?.store ?? "archive"];
const frames = () => state.set?.frames ?? [];
const useB0 = () => $<HTMLInputElement>("#opt-b0").checked;

// --- data ----------------------------------------------------------------------------

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const validFrames = (fs: LabFrame[] | undefined) =>
  (fs ?? []).filter((f) => f && f.date && f.key && f.r > 0).sort((a, b) => a.date.localeCompare(b.date));

async function loadArchive(): Promise<DataSet | null> {
  archiveCache ??= await getJSON<LabData>(`${ARCHIVE_BASE}index.json`);
  if (!archiveCache) return null;
  return {
    id: "archive",
    frames: validFrames(archiveCache.frames),
    imageBase: ARCHIVE_BASE,
    example: archiveCache.example_track,
    store: "archive",
  };
}

async function loadWeek(): Promise<DataSet | null> {
  const lab = await getJSON<LabData>(`${MEDIA_BASE}/lab.json`);
  const fs = validFrames(lab?.frames);
  if (!lab || !fs.length) return null;
  return { id: "week", frames: fs, imageBase: `${MEDIA_BASE}/`, example: lab.example_track, store: "live" };
}

async function loadDaily(): Promise<LabFrame[] | null> {
  if (dailyCache === undefined) dailyCache = await getJSON<DailyIndex>(`${MEDIA_BASE}/daily/index.json`);
  const days = validFrames(dailyCache?.days);
  return days.length ? days : null;
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function loadRange(start?: string): Promise<DataSet | null> {
  const days = await loadDaily();
  if (!days) return null;
  const first = days[0].date, last = days[days.length - 1].date;
  const latestStart = addDays(last, -(SPAN - 1)) < first ? first : addDays(last, -(SPAN - 1));
  const input = $<HTMLInputElement>("#range-start");
  input.min = first;
  input.max = last;
  const s = start && start >= first && start <= last ? start : latestStart;
  input.value = s;
  return { id: `range:${s}`, frames: windowFrom(days, s, SPAN), imageBase: `${MEDIA_BASE}/`, example: null, store: "live" };
}

const fmtDate = (date: string) => `${+date.slice(8, 10)}.${+date.slice(5, 7)}.${date.slice(0, 4)}`;

async function setMode(mode: Mode, opts: { start?: string } = {}) {
  state.mode = mode;
  document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("#range-pick").hidden = mode !== "range";
  const err = $("#source-error");
  err.hidden = true;
  $("#source-note").textContent = "טוען…";

  let set: DataSet | null = null;
  if (mode === "archive") set = await loadArchive();
  else if (mode === "week") set = await loadWeek();
  else set = await loadRange(opts.start);

  if (state.mode !== mode) return; // a newer choice won
  if (!set || !set.frames.length) {
    err.textContent =
      mode === "archive"
        ? "לא הצלחנו לטעון את ארכיון הדוגמה. נסו לרענן את הדף."
        : mode === "range" && set
          ? "אין בארכיון תמונות בטווח התאריכים הזה. בחרו תאריך אחר."
          : "הנתונים החיים עדיין לא זמינים, כי ה-pipeline עוד לא התחיל לרוץ או שהשרת לא ענה. בינתיים מוצג ארכיון הדוגמה, ואפשר לעבוד עליו.";
    err.hidden = false;
    if (mode === "range" && set) {
      $("#source-note").textContent = "";
      return;
    }
    if (mode !== "archive") {
      // keep the lab usable
      const fallback = await loadArchive();
      if (fallback) {
        document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === "archive")));
        $("#range-pick").hidden = true;
        state.mode = "archive";
        useSet(fallback);
      }
    }
    return;
  }
  useSet(set);
}

function useSet(set: DataSet) {
  const sameStore = state.set?.store === set.store;
  state.set = set;
  imageCache.clear();
  // start where the first marks are expected: the earliest day without marks on the active track
  if (!sameStore || state.day >= set.frames.length) state.day = 0;
  const fs = set.frames;
  const first = fs[0], last = fs[fs.length - 1];
  const live = set.store === "live";
  $("#source-note").innerHTML =
    `${fs.length} ימים, <span class="ltr">${fmtDate(first.date)}–${fmtDate(last.date)}</span>. ` +
    (live ? "תמונה אחת לכל יום, מהארכיון היומי של האתר." : "חבילה קבועה, כדי שתמיד יהיו כתמים לעקוב אחריהם.");
  $("#eyebrow").textContent = `SDO / HMI Continuum · ${fmtDate(first.date)} – ${fmtDate(last.date)} · ${first.t.slice(11, 16)} UTC`;
  buildDays();
  $<HTMLButtonElement>("#btn-example").disabled = !set.example;
  $("#btn-example").title = set.example ? "" : "אין מסלול דוגמה לנתונים האלה";
  update();
}

// --- images ------------------------------------------------------------------------------

const imageCache = new Map<string, HTMLImageElement>();

function imageFor(i: number): HTMLImageElement | null {
  const set = state.set;
  const f = set?.frames[i];
  if (!set || !f) return null;
  let img = imageCache.get(f.date);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.addEventListener("load", () => {
      if (frames()[state.day]?.date === f.date) {
        $("#plate-empty").hidden = true;
        draw();
      }
    });
    img.addEventListener("error", () => {
      if (frames()[state.day]?.date === f.date) {
        $("#plate-empty").hidden = false;
        $("#plate-empty").textContent = "התמונה של היום הזה לא נטענה.";
      }
    });
    img.src = set.imageBase + f.key;
    imageCache.set(f.date, img);
  }
  return img;
}

const ready = (img: HTMLImageElement | null): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;

// --- the plate --------------------------------------------------------------------------

const cv = $<HTMLCanvasElement>("#sun-canvas");
const ctx = cv.getContext("2d")!;
let drag: { fresh: boolean } | null = null;
let pointer: { x: number; y: number } | null = null;

function resizeCanvas() {
  const css = cv.getBoundingClientRect().width || 760;
  const px = Math.round(Math.min(1400, Math.max(300, css * (window.devicePixelRatio || 1))));
  if (cv.width !== px) {
    cv.width = cv.height = px;
    draw();
  }
}

function draw() {
  const W = cv.width, u = W / 760;
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, W, W);
  const f = frames()[state.day];
  if (!f) return;
  const img = imageFor(state.day);
  if (ready(img)) ctx.drawImage(img, 0, 0, W, W);
  const cx = f.cx * W, cy = f.cy * W, r = f.r * W;
  if ($<HTMLInputElement>("#opt-grid").checked) drawGrid(f, cx, cy, r, u);

  const trail = $<HTMLInputElement>("#opt-trail").checked;
  const dates = frames().map((fr) => fr.date);
  tracks().forEach((tr, ti) => {
    const keys = dates.filter((d) => tr[d]);
    if (trail && keys.length > 1) {
      ctx.beginPath();
      keys.forEach((k, j) => (j ? ctx.lineTo(tr[k][0] * W, tr[k][1] * W) : ctx.moveTo(tr[k][0] * W, tr[k][1] * W)));
      ctx.strokeStyle = PLATE_COLORS[ti];
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5 * u;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    keys.forEach((k) => {
      const cur = k === f.date;
      if (!cur && !trail) return;
      marker(tr[k][0] * W, tr[k][1] * W, PLATE_COLORS[ti], cur, ti === state.track, u);
    });
  });
  if (pointer && drag && ready(img)) loupe(img, pointer.x, pointer.y, W);
}

function marker(x: number, y: number, col: string, current: boolean, active: boolean, u: number) {
  ctx.save();
  if (current) {
    const ring = () => {
      ctx.beginPath();
      ctx.arc(x, y, 11 * u, 0, 2 * Math.PI);
      ctx.stroke();
    };
    ctx.lineWidth = 4 * u;
    ctx.strokeStyle = "rgba(0,0,0,.75)";
    ring();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = col;
    ring();
    ctx.beginPath();
    for (const [a, b] of [[-20, -15], [15, 20]]) {
      ctx.moveTo(x + a * u, y);
      ctx.lineTo(x + b * u, y);
      ctx.moveTo(x, y + a * u);
      ctx.lineTo(x, y + b * u);
    }
    ctx.stroke();
  } else {
    ctx.globalAlpha = active ? 0.85 : 0.55;
    ctx.fillStyle = col;
    ctx.strokeStyle = "rgba(0,0,0,.8)";
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.arc(x, y, 4 * u, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Stonyhurst grid, every 15°, drawn on the visible hemisphere only. */
function drawGrid(f: LabFrame, cx: number, cy: number, r: number, u: number) {
  const b0 = ((useB0() ? b0Deg(new Date(f.t)) : 0) * Math.PI) / 180;
  const D = Math.PI / 180;
  const proj = (B: number, L: number): [number, number, number] => {
    const x = Math.cos(B) * Math.sin(L);
    const y = Math.sin(B) * Math.cos(b0) - Math.cos(B) * Math.cos(L) * Math.sin(b0);
    const z = Math.sin(B) * Math.sin(b0) + Math.cos(B) * Math.cos(L) * Math.cos(b0);
    return [cx + x * r, cy - y * r, z];
  };
  const line = (fn: (s: number) => [number, number, number]) => {
    ctx.beginPath();
    let on = false;
    for (let s = 0; s <= 180; s++) {
      const [x, y, z] = fn(s / 180);
      if (z > 0) {
        if (on) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        on = true;
      } else on = false;
    }
    ctx.stroke();
  };
  ctx.save();
  ctx.strokeStyle = "rgba(70,25,0,.4)";
  for (let B = -75; B <= 75; B += 15) {
    ctx.lineWidth = (B === 0 ? 1.8 : 1) * u;
    line((s) => proj(B * D, (-90 + 180 * s) * D));
  }
  ctx.lineWidth = u;
  for (let L = -90; L <= 90; L += 15) line((s) => proj((-90 + 180 * s) * D, L * D));
  ctx.restore();
}

/** Magnifier in the far top corner while dragging, so a finger does not hide the spot. */
function loupe(img: HTMLImageElement, x: number, y: number, W: number) {
  const s = 2.6, R = W * 0.13, oy = R + W * 0.013;
  const fx = x < W / 2 ? W - oy : oy;
  const k = img.naturalWidth / W;
  ctx.save();
  ctx.beginPath();
  ctx.arc(fx, oy, R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(fx - R, oy - R, 2 * R, 2 * R);
  ctx.drawImage(img, (x - R / s) * k, (y - R / s) * k, ((2 * R) / s) * k, ((2 * R) / s) * k, fx - R, oy - R, 2 * R, 2 * R);
  const u = W / 760;
  ctx.strokeStyle = PLATE_COLORS[state.track];
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.moveTo(fx - 12 * u, oy);
  ctx.lineTo(fx + 12 * u, oy);
  ctx.moveTo(fx, oy - 12 * u);
  ctx.lineTo(fx, oy + 12 * u);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "rgba(230,236,242,.85)";
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.arc(fx, oy, R, 0, 2 * Math.PI);
  ctx.stroke();
}

function toCanvas(e: PointerEvent) {
  const b = cv.getBoundingClientRect();
  return { x: ((e.clientX - b.left) * cv.width) / b.width, y: ((e.clientY - b.top) * cv.height) / b.height, scale: cv.width / b.width };
}

cv.addEventListener("pointerdown", (e) => {
  const f = frames()[state.day];
  if (!f || e.button > 0) return;
  const p = toCanvas(e), W = cv.width;
  const tr = tracks()[state.track], cur = tr[f.date];
  if (cur && Math.hypot(cur[0] * W - p.x, cur[1] * W - p.y) < 22 * p.scale) drag = { fresh: false };
  else {
    if (!onDisk(f, p.x / W, p.y / W)) return;
    tr[f.date] = [p.x / W, p.y / W];
    drag = { fresh: true };
  }
  exampleFlags()[state.track] = false;
  pointer = p;
  cv.setPointerCapture(e.pointerId);
  draw();
  e.preventDefault();
});

cv.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const f = frames()[state.day], p = toCanvas(e), W = cv.width;
  tracks()[state.track][f.date] = clampToDisk(f, p.x / W, p.y / W);
  pointer = p;
  draw();
});

function endDrag() {
  if (!drag) return;
  const fresh = drag.fresh;
  drag = null;
  pointer = null;
  const f = frames()[state.day];
  announce(`${TRACK_NAMES[state.track]} סומן ב-${fmtDate(f.date)}.`);
  if (fresh && $<HTMLInputElement>("#opt-advance").checked && state.day < frames().length - 1) {
    state.day++;
  }
  update();
}
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);

// --- days and keyboard --------------------------------------------------------------------

const daysEl = $("#days");

function buildDays() {
  daysEl.replaceChildren();
  frames().forEach((f, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day";
    b.innerHTML = `<span class="d">${Number(f.date.slice(8, 10))}</span><span class="m">${new Date(f.date + "T12:00:00Z").toLocaleDateString("he-IL", { month: "short", timeZone: "UTC" })}</span><span class="dots" aria-hidden="true"></span>`;
    b.addEventListener("click", () => setDay(i));
    daysEl.append(b);
  });
}

function setDay(i: number, focusDay = false) {
  const n = frames().length;
  if (!n) return;
  state.day = Math.max(0, Math.min(n - 1, i));
  update();
  if (focusDay) (daysEl.children[state.day] as HTMLElement | undefined)?.focus();
  announce(`יום ${fmtDate(frames()[state.day].date)}`);
}

function renderDays() {
  const f = frames()[state.day];
  $("#daylabel").textContent = f ? `${f.t.slice(0, 10)}  ${f.t.slice(11, 16)} UTC${f.source !== "jsoc" ? ` · ${f.source}` : ""}` : "";
  $("#b0val").textContent = f ? `${signed(useB0() ? b0Deg(new Date(f.t)) : 0, 2)}°` : "—";
  [...daysEl.children].forEach((el, i) => {
    const b = el as HTMLButtonElement;
    const fr = frames()[i];
    const marked = [0, 1].filter((ti) => tracks()[ti][fr.date]);
    b.setAttribute("aria-current", i === state.day ? "true" : "false");
    if (i === state.day) keepInStrip(b);
    b.setAttribute(
      "aria-label",
      `יום ${fmtDate(fr.date)}` + (marked.length ? `, מסומן: ${marked.map((ti) => TRACK_NAMES[ti]).join(" ו")}` : ""),
    );
    b.querySelector(".dots")!.innerHTML = marked.map((ti) => `<span class="dot" style="background:${PLATE_COLORS[ti]}"></span>`).join("");
  });
}

/** Scroll the day strip (never the page) so the current day is visible. */
function keepInStrip(b: HTMLElement) {
  const strip = daysEl.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  if (r.left < strip.left || r.right > strip.right) {
    daysEl.scrollLeft += r.left - strip.left - (strip.width - r.width) / 2;
  }
}

// In an RTL page the day strip runs right to left, so ArrowLeft is the next day.
function onArrow(e: KeyboardEvent, focusDay: boolean) {
  const step: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1 };
  if (e.key in step) {
    setDay(state.day + step[e.key], focusDay);
    e.preventDefault();
  } else if (e.key === "Home" || e.key === "End") {
    setDay(e.key === "Home" ? 0 : frames().length - 1, focusDay);
    e.preventDefault();
  }
}
cv.addEventListener("keydown", (e) => onArrow(e, false));
daysEl.addEventListener("keydown", (e) => onArrow(e, true));

const live = $("#lab-live");
function announce(msg: string) {
  live.textContent = msg;
}

// --- controls ---------------------------------------------------------------------------

function setTrack(ti: number) {
  state.track = ti;
  [0, 1].forEach((k) => $(`#chip-${k}`).setAttribute("aria-pressed", String(k === ti)));
  draw();
}
$("#chip-0").addEventListener("click", () => setTrack(0));
$("#chip-1").addEventListener("click", () => setTrack(1));
$("#btn-del").addEventListener("click", () => {
  const f = frames()[state.day];
  if (f) delete tracks()[state.track][f.date];
  update();
});
$("#btn-clear").addEventListener("click", () => {
  tracks()[state.track] = {};
  exampleFlags()[state.track] = false;
  update();
});
$("#btn-example").addEventListener("click", () => loadExample(state.track));
function loadExample(ti: number) {
  const ex = state.set?.example;
  if (!ex) return;
  tracks()[ti] = Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, [v[0], v[1]]]));
  exampleFlags()[ti] = true;
  update();
}
for (const id of ["#opt-grid", "#opt-trail"]) $(id).addEventListener("change", draw);
$("#opt-b0").addEventListener("change", update);

document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) =>
  b.addEventListener("click", () => {
    const mode = b.dataset.mode as Mode;
    if (mode !== state.mode) setMode(mode);
  }),
);
$<HTMLInputElement>("#range-start").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).value;
  if (v) setMode("range", { start: v });
});

const dInput = $<HTMLInputElement>("#scheiner-d");
dInput.addEventListener("input", () => {
  state.scheinerD = +dInput.value;
  renderScheiner();
  renderCharts();
});

// --- the notebook -------------------------------------------------------------------------

let results: TrackResult[] = [];

function update() {
  const correct = useB0();
  results = [0, 1].map((ti) => computeResults(frames(), tracks()[ti], correct));
  renderDays();
  draw();
  imageFor(state.day);
  imageFor(state.day + 1); // prefetch the next day, the usual next step
  if (!ready(imageFor(state.day))) {
    $("#plate-empty").hidden = false;
    $("#plate-empty").textContent = "טוען את התמונה…";
  } else $("#plate-empty").hidden = true;
  renderResults();
  renderCharts();
  renderTable();
  renderScheiner();
}

function renderResults() {
  const host = $("#results");
  host.replaceChildren();
  results.forEach((res, ti) => {
    const box = document.createElement("div");
    box.className = "res";
    const tag = exampleFlags()[ti] ? ` <span class="badge">דוגמה</span>` : "";
    const F = res.points.length >= MIN_DAYS ? res.fit : null;
    let body: string;
    if (!F) {
      body = `<p class="empty">${res.points.length ? `סומנו ${res.points.length} ימים. צריך לפחות ${MIN_DAYS}.` : "עדיין לא סומן."}</p>`;
    } else {
      body = `<div class="big ltr" style="text-align:right">${F.pSid.toFixed(1)} <small>ימים, תקופה סידרית</small></div>
        <dl>
          <dt>מהירות זוויתית ω</dt><dd>${F.omega.toFixed(2)}°/day</dd>
          <dt>תקופה סינודית</dt><dd>${F.pSyn.toFixed(1)} d</dd>
          <dt>קו רוחב ממוצע</dt><dd>${signed(F.meanLat)}°</dd>
          <dt>צפוי בקו רוחב זה</dt><dd>${res.expectedSid!.toFixed(1)} d</dd>
          <dt>סטיית ההתאמה</dt><dd>±${F.rms.toFixed(2)}°</dd>
        </dl>`;
    }
    box.innerHTML = `<div class="name"><span class="sw sw-c${ti + 1}" aria-hidden="true"></span>${TRACK_NAMES[ti]}${tag}</div>${body}`;
    host.append(box);
  });
}

function renderTable() {
  const tb = $("#measure-table tbody");
  tb.replaceChildren();
  results.forEach((res, ti) =>
    res.points.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${TRACK_NAMES[ti]}</td><td class="n">${p.frame.t.slice(0, 16).replace("T", " ")}</td><td class="n">${signed(p.L, 2)}°</td><td class="n">${signed(p.B, 2)}°</td><td class="n">${signed(p.X, 3)}</td>`;
      tb.append(tr);
    }),
  );
  if (!tb.children.length) tb.innerHTML = `<tr><td colspan="5">אין עדיין מדידות.</td></tr>`;
}

function renderScheiner() {
  const d = state.scheinerD;
  $("#scheiner-d-val").textContent = `d = ${d.toFixed(2)} R`;
  const frac = scheinerVisibleFraction(d);
  const fit = results.find((r) => r.points.length >= MIN_DAYS && r.fit)?.fit;
  let text = `ירח במסלול כזה נראה מול הדיסקה ב-${Math.round(frac * 100)}% מהסיבוב.`;
  if (fit) {
    const P = scheinerPeriod(fit, d);
    text += ` כדי לחצות את הדיסקה בזמן שלקח לכתם, הוא היה צריך להקיף את השמש ב-${P.toFixed(1)} ימים, ולהיעלם מאחוריה ל-${(P * (1 - frac)).toFixed(1)} ימים.`;
  }
  $("#scheiner-frac").textContent = text;
  dInput.setAttribute("aria-valuetext", `d שווה ${d.toFixed(2)}, ${Math.round(frac * 100)} אחוז מהסיבוב מול הדיסקה`);
}

// --- SVG charts (time runs left→right also in RTL, DECISIONS #18) ------------------------

interface Series {
  pts: [number, number][];
  color: string;
  dash?: string;
  width?: number;
  opacity?: number;
}
interface Point {
  x: number;
  y: number;
  color: string;
  tip: string;
}
interface ChartOpts {
  label: string;
  x: [number, number];
  y: [number, number];
  xfmt: (v: number) => string;
  yfmt: (v: number) => string;
  xtitle: string;
  ytitle: string;
  lines: Series[];
  points: Point[];
  guides?: number[];
  empty?: string;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

let clipSeq = 0;
function chart(host: HTMLElement, o: ChartOpts) {
  const W = 440, H = 250, m = { l: 46, r: 12, t: 22, b: 36 };
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "lab-chart", role: "img", "aria-label": o.label });
  const sx = (v: number) => m.l + ((v - o.x[0]) / (o.x[1] - o.x[0])) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - o.y[0]) / (o.y[1] - o.y[0])) * (H - m.t - m.b);
  for (const v of niceTicks(o.y[0], o.y[1], 5)) {
    svgEl("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), class: "grid" }, svg);
    svgEl("text", { x: m.l - 6, y: sy(v) + 4, "text-anchor": "end" }, svg).textContent = o.yfmt(v);
  }
  for (const v of o.guides ?? []) svgEl("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), class: "limb" }, svg);
  const xt = niceTicks(o.x[0], o.x[1], 6);
  for (const v of xt.filter((_, i) => xt.length <= 8 || i % 2 === 0)) {
    svgEl("line", { x1: sx(v), x2: sx(v), y1: H - m.b, y2: H - m.b + 4, class: "axis" }, svg);
    svgEl("text", { x: sx(v), y: H - m.b + 16, "text-anchor": "middle" }, svg).textContent = o.xfmt(v);
  }
  svgEl("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis" }, svg);
  svgEl("text", { x: W - m.r, y: H - 3, "text-anchor": "end", class: "ttl" }, svg).textContent = o.xtitle;
  svgEl("text", { x: 2, y: 12, class: "ttl" }, svg).textContent = o.ytitle;

  const cid = `lab-clip-${++clipSeq}`;
  const cp = svgEl("clipPath", { id: cid }, svgEl("defs", {}, svg));
  svgEl("rect", { x: m.l, y: m.t - 8, width: W - m.l - m.r, height: H - m.t - m.b + 16 }, cp);
  const g = svgEl("g", { "clip-path": `url(#${cid})` }, svg);
  for (const s of o.lines) {
    const d = s.pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
    svgEl(
      "path",
      { d, fill: "none", stroke: s.color, "stroke-width": s.width ?? 2, "stroke-dasharray": s.dash ?? "none", opacity: s.opacity ?? 1, "stroke-linecap": "round" },
      g,
    );
  }
  if (!o.points.length && o.empty)
    svgEl("text", { x: (m.l + W - m.r) / 2, y: (m.t + H - m.b) / 2, class: "empty-msg" }, svg).textContent = o.empty;

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  for (const P of o.points) {
    const c = svgEl("circle", { cx: sx(P.x), cy: sy(P.y), r: 5, fill: P.color, class: "pt" }, g);
    const hit = svgEl("circle", { cx: sx(P.x), cy: sy(P.y), r: 12, class: "hit" }, g);
    hit.addEventListener("pointerenter", () => {
      const b = svg.getBoundingClientRect(), k = b.width / W;
      tip.innerHTML = P.tip;
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(sx(P.x) * k, 70), b.width - 70)}px`;
      tip.style.top = `${Math.max(0, sy(P.y) * k - 44)}px`;
      c.setAttribute("r", "7");
    });
    hit.addEventListener("pointerleave", () => {
      tip.hidden = true;
      c.setAttribute("r", "5");
    });
  }
  host.replaceChildren(svg, tip);
}

function renderCharts() {
  const fs = frames();
  if (!fs.length) return;
  const T0 = Date.parse(fs[0].t);
  const tMax = (Date.parse(fs[fs.length - 1].t) - T0) / 864e5;
  const xfmt = (v: number) => {
    const d = new Date(T0 + v * 864e5);
    return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
  };
  const tipOf = (ti: number, date: string, what: string) =>
    `<strong>${TRACK_NAMES[ti]}</strong> · <span class="num ltr">${fmtDate(date)}</span><br><span class="num ltr">${what}</span>`;

  // 1. L(t) with straight-line fits
  const pts1: Point[] = [], lines1: Series[] = [];
  let Lmin = -30, Lmax = 90;
  results.forEach((res, ti) => {
    for (const p of res.points) {
      pts1.push({ x: p.days, y: p.L, color: CHART_COLORS[ti], tip: tipOf(ti, p.frame.date, `L = ${signed(p.L, 1)}°`) });
      Lmin = Math.min(Lmin, p.L);
      Lmax = Math.max(Lmax, p.L);
    }
    const F = res.fit;
    if (F) {
      const a = res.points[0].days, b = res.points[res.points.length - 1].days;
      lines1.push({ color: CHART_COLORS[ti], opacity: 0.6, pts: [[a, F.a + F.omega * a], [b, F.a + F.omega * b]] });
    }
  });
  chart($("#chart1"), {
    label: "קו האורך ההליוגרפי של הכתמים מול הזמן, עם התאמה לקו ישר",
    x: [-0.3, Math.max(1, Math.ceil(tMax)) + 0.3],
    y: [Math.floor(Lmin / 30) * 30, Math.ceil(Lmax / 30) * 30],
    xfmt,
    yfmt: (v) => `${v}°`,
    xtitle: "תאריך",
    ytitle: "L (קו אורך)",
    lines: lines1,
    points: pts1,
    empty: "סמנו כתם כדי לראות את הגרף",
  });

  // 2. what Galileo saw: screen x vs time, sphere vs constant speed vs Scheiner's moon
  const pts2: Point[] = [], lines2: Series[] = [];
  let tlo = 0, thi = Math.max(1, Math.ceil(tMax));
  results.forEach((res, ti) => {
    for (const p of res.points)
      pts2.push({ x: p.days, y: p.X, color: CHART_COLORS[ti], tip: tipOf(ti, p.frame.date, `x = ${signed(p.X, 2)} R`) });
    const F = res.points.length >= MIN_DAYS ? res.fit : null;
    if (!F) return;
    const tA = (-90 - F.a) / F.omega, tB = (90 - F.a) / F.omega;
    tlo = Math.min(tlo, Math.floor(tA));
    thi = Math.max(thi, Math.ceil(tB));
    const curve: [number, number][] = [];
    for (let k = 0; k <= 80; k++) {
      const t = tA + ((tB - tA) * k) / 80;
      curve.push([t, sphereX(F, t)]);
    }
    lines2.push({ color: CHART_COLORS[ti], pts: curve });
    const a = res.points[0], b = res.points[res.points.length - 1], v = (b.X - a.X) / (b.days - a.days);
    if (v > 0) lines2.push({ color: CHART_COLORS[ti], dash: "6 4", opacity: 0.75, pts: [[a.days - (a.X + 1) / v, -1], [b.days + (1 - b.X) / v, 1]] });
    if (state.scheinerD > 1.001)
      lines2.push({ color: CHART_COLORS[ti], dash: "1 5", width: 3, opacity: 0.9, pts: scheinerCurve(F, state.scheinerD) });
  });
  chart($("#chart2"), {
    label: "מיקום הכתמים על המסך מול הזמן, מול עקומה של כדור מסתובב, קו של מהירות קבועה וירח במסלול",
    x: [tlo, thi],
    y: [-1.05, 1.05],
    xfmt,
    yfmt: (v) => (v === 0 ? "0" : v.toFixed(1)),
    xtitle: "תאריך",
    ytitle: "x על המסך (ברדיוסי שמש)",
    lines: lines2,
    points: pts2,
    guides: [-1, 1],
    empty: "סמנו כתם כדי לראות את הגרף",
  });
}

// --- start ---------------------------------------------------------------------------------

function readTrackColors() {
  const cs = getComputedStyle(document.documentElement);
  ["--track-1", "--track-2"].forEach((v, i) => {
    const c = cs.getPropertyValue(v).trim();
    if (c) PLATE_COLORS[i] = c;
  });
}

async function main() {
  readTrackColors();
  dInput.value = String(state.scheinerD);
  new ResizeObserver(resizeCanvas).observe(cv);
  resizeCanvas();
  await setMode("archive");
  // start in a working state, as the prototype does: the example on track A
  if (state.set?.example) loadExample(0);
}

main();
