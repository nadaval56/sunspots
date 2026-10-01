// Home page: reads today.json and manifest.json at runtime (BRIEF §3), so the
// static site never needs a rebuild for new data.
import { MEDIA_BASE } from "../config";
import { EARTH_RADII_PER_SUN, heliographicToPixel, synodicRate, type Disk } from "../lib/solar";
import type { ChannelEntry, Channels, FrameEntry, Manifest, Region, Today } from "../lib/types";
import { formatClock, formatLocalTime, formatUtc, relativeFromNow } from "../lib/format";

const SVG = "http://www.w3.org/2000/svg";
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;

async function getJSON<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(`${MEDIA_BASE}/${name}`, { cache: "no-cache" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

const fmtLoc = (lat: number, lon: number) =>
  `${lat >= 0 ? "N" : "S"}${String(Math.abs(Math.round(lat))).padStart(2, "0")}${lon >= 0 ? "W" : "E"}${String(Math.abs(Math.round(lon))).padStart(2, "0")}`;

// --- the plate --------------------------------------------------------------------

function diskInViewbox(f: FrameEntry): Disk {
  return { cx: f.cx * 1000, cy: f.cy * 1000, r: f.r * 1000 };
}

let shownT: Date | null = null;

function showFrame(src: string, t: Date, iso: string, alt: string) {
  const img = $<HTMLImageElement>("#sun");
  img.src = src;
  img.alt = alt;
  shownT = t;
  $("#frame-time").innerHTML = `${formatLocalTime(t)} (שעון ישראל) · <time datetime="${iso}" class="ltr">${formatUtc(t)}</time>`;
  tickAge();
}

function tickAge() {
  if (shownT) $("#frame-age").textContent = `(עודכן ${relativeFromNow(shownT)})`;
}

function renderImage(frame: FrameEntry) {
  const img = $<HTMLImageElement>("#sun");
  img.addEventListener("load", () => $("#plate-empty")?.remove(), { once: true });
  const t = new Date(frame.t);
  showFrame(`${MEDIA_BASE}/${frame.key}`, t, frame.t, `תמונת השמש באור נראה (SDO/HMI), ${formatLocalTime(t)}`);
  setInterval(tickAge, 60_000);
}

/**
 * Wavelength switcher. Every channel is cropped to the same framing as the hourly
 * frame (pipeline/channels.py), so the region rings and the Earth stay aligned.
 */
function setupChannels(channels: Channels | null, frame: FrameEntry) {
  const list = (channels?.channels ?? []).filter((c) => c.id !== "continuum");
  if (!list.length) return;
  const visible: ChannelEntry = {
    id: "continuum",
    label: "אור נראה",
    t: frame.t,
    key: frame.key,
    source: frame.source,
    note: channels?.channels.find((c) => c.id === "continuum")?.note ??
      "פני השמש (הפוטוספרה) באור נראה, בצבע מלאכותי. כתמי השמש כהים כי הם קרים יותר מהסביבה שלהם.",
  };
  const all = [visible, ...list];
  const name = $("#ch-name");
  const pos = $("#ch-pos");
  const note = $("#channel-note");
  const srcOf = (c: ChannelEntry) =>
    // same file name every hour, so bust the 5-minute cache with the capture time
    c.id === "continuum" ? `${MEDIA_BASE}/${c.key}` : `${MEDIA_BASE}/${c.key}?t=${encodeURIComponent(c.t)}`;
  let i = 0;
  const show = (k: number) => {
    i = (k + all.length) % all.length;
    const c = all[i];
    const t = new Date(c.t);
    showFrame(srcOf(c), t, c.t, `תמונת השמש: ${c.label}, ${formatLocalTime(t)}`);
    name.textContent = c.label;
    pos.textContent = `${i + 1} מתוך ${all.length}`;
    note.textContent = c.note;
    // warm the neighbours so the next click is instant
    for (const d of [1, -1]) new Image().src = srcOf(all[(i + d + all.length) % all.length]);
  };
  // RTL: the arrow on the right goes back, the arrow on the left goes forward (as in the lab)
  $("#ch-prev").addEventListener("click", () => show(i - 1));
  $("#ch-next").addEventListener("click", () => show(i + 1));
  $("#channels-box").addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(i + 1);
    else if (e.key === "ArrowRight") show(i - 1);
    else return;
    e.preventDefault();
  });
  name.textContent = visible.label;
  pos.textContent = `1 מתוך ${all.length}`;
  note.textContent = visible.note;
  $("#channels-box").hidden = false;
}

/** NOAA positions are for `valid_at`; rotate them to the moment of the image. */
function regionsAt(regions: Region[], frame: FrameEntry | null): Region[] {
  if (!frame) return regions;
  const frameT = new Date(frame.t).getTime();
  return regions.map((reg) => {
    const dtDays = reg.valid_at ? (frameT - new Date(reg.valid_at).getTime()) / 864e5 : 0;
    return { ...reg, lon: reg.lon + synodicRate(reg.lat) * dtDays, valid_at: frame.t };
  });
}

function renderRegions(layer: SVGGElement, frame: FrameEntry, regions: Region[]) {
  const disk = diskInViewbox(frame);
  for (const reg of regions) {
    const L = reg.lon;
    const p = heliographicToPixel(reg.lat, L, disk, frame.b0);
    if (!p.visible) continue;
    const g = svgEl("g", { class: "region-marker" }, layer);
    svgEl("title", {}, g).textContent = `אזור ${reg.region}, ${fmtLoc(reg.lat, L)}`;
    svgEl("circle", { cx: p.x, cy: p.y, r: 26, class: "ring-halo" }, g);
    svgEl("circle", { cx: p.x, cy: p.y, r: 26, class: "ring" }, g);
    const above = p.y > disk.cy - disk.r + 70;
    const label = svgEl("text", { x: p.x, y: above ? p.y - 36 : p.y + 52, class: "region-label" }, g);
    label.textContent = String(reg.region);
  }
}

function setupEarth(svg: SVGSVGElement, layer: SVGGElement, frame: FrameEntry) {
  const disk = diskInViewbox(frame);
  const r = disk.r / EARTH_RADII_PER_SUN;
  const pos = { x: disk.cx, y: disk.cy + disk.r * 0.55 };
  // Drawn at the origin and moved with a transform: one attribute per frame, no layout work.
  const g = svgEl("g", { class: "earth", tabindex: 0, role: "img", "aria-label": "כדור הארץ בקנה מידה. אפשר להזיז בחיצים." }, layer);
  svgEl("circle", { r: 70, class: "earth-hit" }, g); // generous grab area (~4% of the image)
  svgEl("circle", { r: Math.max(r * 5, 14), class: "earth-ring" }, g); // shows where the tiny Earth is
  svgEl("circle", { r, class: "earth-body" }, g);
  const label = svgEl("text", { x: 0, y: Math.max(r * 5, 14) + 30, class: "earth-label" }, g);
  label.textContent = "כדור הארץ";

  const clamp = (v: number) => Math.min(1000, Math.max(0, v));
  const place = () => g.setAttribute("transform", `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
  place();

  let ctm: DOMMatrix | null = null;
  const toViewbox = (e: PointerEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm!);
  let grab: { dx: number; dy: number } | null = null;
  let raf = 0;
  let last: PointerEvent | null = null;

  const move = (e: PointerEvent) => {
    if (!grab) return;
    e.preventDefault();
    last = e;
    if (raf) return; // at most one update per frame
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!grab || !last) return;
      const p = toViewbox(last);
      pos.x = clamp(p.x - grab.dx);
      pos.y = clamp(p.y - grab.dy);
      place();
    });
  };
  const end = () => {
    grab = null;
    g.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
  g.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ctm = svg.getScreenCTM()!.inverse(); // fixed for the whole drag
    const p = toViewbox(e);
    grab = { dx: p.x - pos.x, dy: p.y - pos.y }; // keep the grab point under the finger, no jump
    g.classList.add("dragging");
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  g.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 25 : 5;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (!d[e.key]) return;
    e.preventDefault();
    pos.x = clamp(pos.x + d[e.key][0]);
    pos.y = clamp(pos.y + d[e.key][1]);
    place();
  });
}

function setupToggle(box: HTMLInputElement, layer: SVGGElement, onChange?: (on: boolean) => void) {
  const apply = () => {
    const on = box.checked;
    layer.style.display = on ? "" : "none";
    // the Earth must be reachable by mouse/keyboard while visible
    if (layer.classList.contains("earth-layer")) $("#overlay").classList.toggle("interactive", on);
    onChange?.(on);
  };
  box.addEventListener("change", apply);
  apply();
}

// --- the notebook -------------------------------------------------------------------

function renderStats(today: Today, regions: Region[]) {
  if (today.sunspot_number) {
    $("#ssn").textContent = String(today.sunspot_number.value ?? "—");
    $("#ssn-date").textContent = today.sunspot_number.date
      ? `(${new Date(today.sunspot_number.date + "T12:00:00Z").toLocaleDateString("he-IL", { day: "numeric", month: "long" })})`
      : "";
  }
  $("#region-count").textContent = String(regions.length);

  // R = 10g + s with today's NOAA regions, so the formula has real numbers in it.
  const g = regions.length;
  const s = regions.reduce((sum, r) => sum + (r.spots ?? 0), 0);
  if (g > 0 && regions.every((r) => typeof r.spots === "number")) {
    const R = 10 * g + s;
    const official = today.sunspot_number?.value;
    const box = $("#ssn-worked");
    box.innerHTML =
      `<b>היום:</b> ${g === 1 ? "קבוצה אחת" : `${g} קבוצות`} ו-${s} כתמים, ולכן ` +
      `<span class="num" dir="ltr">10 × ${g} + ${s} = ${R}</span>.` +
      (typeof official === "number"
        ? official === R
          ? " בדיוק המספר הרשמי של היום."
          : ` המספר הרשמי של היום הוא ${official}.`
        : "");
    box.hidden = false;
  }

  const tbody = $("#regions-table tbody");
  tbody.replaceChildren();
  if (!regions.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">אין היום אזורים עם כתמים.</td>`;
    tbody.append(tr);
  }
  for (const r of [...regions].sort((a, b) => (b.area ?? 0) - (a.area ?? 0))) {
    const tr = document.createElement("tr");
    const cells = [String(r.region), fmtLoc(r.lat, r.lon), String(r.area ?? "—"), String(r.spots ?? "—"), r.mag ?? "—"];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      if (i < 4) td.className = "num ltr-cell";
      tr.append(td);
    });
    tbody.append(tr);
  }
}

function renderFlareBars(today: Today) {
  const box = $("#flare-bars");
  const p = today.flare_probability;
  if (!p) {
    box.textContent = "אין נתונים.";
    return;
  }
  box.replaceChildren();
  for (const [cls, v] of [["C", p.c], ["M", p.m], ["X", p.x]] as const) {
    const val = typeof v === "number" ? v : 0;
    const row = document.createElement("div");
    row.className = "bar-row";
    row.setAttribute("role", "listitem");
    row.innerHTML = `
      <span class="bar-key num">${cls}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="inline-size:${Math.max(val, 0.5)}%"></span></span>
      <span class="bar-val num">${val}%</span>
      <span class="visually-hidden">התפרצות מסוג ${cls}: ${val} אחוז</span>`;
    box.append(row);
  }
}

const CLASS_LEVELS: [string, number][] = [["A", 1e-8], ["B", 1e-7], ["C", 1e-6], ["M", 1e-5], ["X", 1e-4]];

function renderXray(today: Today) {
  const host = $("#xray-chart");
  const x = today.xray;
  if (!x || !x.series.length) {
    host.textContent = "אין נתונים.";
    return;
  }
  $("#xray-class").textContent = x.latest.class;
  $("#xray-when").textContent = `(${formatClock(new Date(x.latest.t))} שעון ישראל)`;
  drawXray(host, x);
  // The viewBox follows the real width so labels stay at their CSS size on phones.
  let w = host.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(host.clientWidth - w) < 8) return;
    w = host.clientWidth;
    drawXray(host, x);
  }).observe(host);
}

function drawXray(host: HTMLElement, x: NonNullable<Today["xray"]>) {
  // Time runs left→right as on the instruments, also in an RTL page (DECISIONS #18).
  const W = Math.max(300, Math.round(host.clientWidth || 560));
  const H = 200, padL = 34, padR = 12, padT = 10, padB = 26;
  const t0 = new Date(x.series[0][0]).getTime();
  const t1 = new Date(x.series[x.series.length - 1][0]).getTime();
  const ly0 = -8.5, ly1 = -3.5;
  const sx = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const sy = (f: number) => padT + (1 - (Math.log10(Math.max(f, 1e-9)) - ly0) / (ly1 - ly0)) * (H - padT - padB);

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    class: "xray-svg",
    role: "img",
    "aria-label": `שטף קרני X מהשמש ב-24 השעות האחרונות, מ-${formatClock(new Date(t0))} עד ${formatClock(new Date(t1))} שעון ישראל. המדידה האחרונה: ${x.latest.class}.`,
  });
  for (const [name, f] of CLASS_LEVELS) {
    const y = sy(f);
    svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid" }, svg);
    svgEl("text", { x: padL - 8, y: y + 4, class: "axis-label" }, svg).textContent = name;
  }
  // a tick every 6 hours on the Israel clock (00, 06, 12, 18), plus "now" at the right edge
  const HOUR = 3600e3;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / HOUR) * HOUR; t <= t1; t += HOUR) {
    const h = Number(new Date(t).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }));
    if (h % 6 === 0 && sx(t) < W - padR - 40) ticks.push(t);
  }
  for (const t of ticks) {
    svgEl("line", { x1: sx(t), x2: sx(t), y1: padT, y2: H - padB, class: "grid" }, svg);
    svgEl("text", { x: sx(t), y: H - 8, class: "time-label", "text-anchor": "middle" }, svg).textContent = formatClock(new Date(t));
  }
  svgEl("text", { x: W - padR, y: H - 8, class: "time-label now", "text-anchor": "end" }, svg).textContent = "עכשיו";

  const pts = x.series.map(([t, f]) => [sx(new Date(t).getTime()), sy(f)] as const);
  svgEl("path", { d: "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L"), class: "xray-line" }, svg);

  // hover: crosshair + tooltip
  const cross = svgEl("line", { y1: padT, y2: H - padB, class: "crosshair", visibility: "hidden" }, svg);
  const dot = svgEl("circle", { r: 4, class: "xray-dot", visibility: "hidden" }, svg);
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    let i = 0;
    for (let k = 1; k < pts.length; k++) if (Math.abs(pts[k][0] - vx) < Math.abs(pts[i][0] - vx)) i = k;
    const [px, py] = pts[i];
    const [t, f] = x.series[i];
    cross.setAttribute("x1", String(px));
    cross.setAttribute("x2", String(px));
    dot.setAttribute("cx", String(px));
    dot.setAttribute("cy", String(py));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<span class="num">${formatClock(new Date(t))}</span> · <strong class="num">${classOf(f)}</strong>`;
    const left = (px / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 60), box.width - 60)}px`;
  });
  svg.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
  host.replaceChildren(svg, tip);
}

function classOf(flux: number): string {
  for (let i = CLASS_LEVELS.length - 1; i >= 0; i--) {
    const [name, base] = CLASS_LEVELS[i];
    if (flux >= base) return `${name}${(flux / base).toFixed(1)}`;
  }
  return "A0.0";
}

function renderTimelapse(today: Today) {
  if (!today.timelapse || today.timelapse.frames < 2) return;
  const video = $<HTMLVideoElement>("#timelapse-video");
  video.poster = `${MEDIA_BASE}/timelapse_poster.webp`;
  for (const [file, type] of [["timelapse_30d.webm", "video/webm"], ["timelapse_30d.mp4", "video/mp4"]]) {
    const s = document.createElement("source");
    s.src = `${MEDIA_BASE}/${file}`;
    s.type = type;
    video.append(s);
  }
  const from = new Date(today.timelapse.from), to = new Date(today.timelapse.to);
  $("#timelapse-range").textContent = `${today.timelapse.frames} פריימים, מ-${from.toLocaleDateString("he-IL")} עד ${to.toLocaleDateString("he-IL")}.`;
  $("#timelapse").hidden = false;
}

// --- main ------------------------------------------------------------------------------

async function main() {
  const [today, manifest, channels] = await Promise.all([
    getJSON<Today>("today.json"),
    getJSON<Manifest>("manifest.json"),
    getJSON<Channels>("latest/channels.json"),
  ]);
  const frame = manifest?.latest ?? today?.image ?? null;
  if (!today && !frame) {
    $("#load-error").hidden = false;
    $("#plate-empty").textContent = "אין עדיין תמונה.";
    return;
  }

  if (today?.fallback_banner || frame?.source === "sdo-1700") {
    const b = $("#fallback-banner");
    b.textContent =
      today?.fallback_banner ??
      "ערוץ האור הנראה אינו זמין זמנית. מוצגת תמונה באולטרה-סגול קרוב, שבה כתמי השמש כהים והאזורים הבהירים הם פקולות.";
    b.hidden = false;
  }
  if (today?.synthetic) $("#synthetic-note").hidden = false;

  const svg = $<SVGSVGElement>("#overlay");
  const regions = regionsAt(today?.regions ?? [], frame);
  if (frame) {
    renderImage(frame);
    if (frame.source !== "sdo-1700") setupChannels(channels, frame);
    const regionsLayer = svgEl("g", { class: "regions-layer" }, svg);
    const earthLayer = svgEl("g", { class: "earth-layer" }, svg);
    renderRegions(regionsLayer, frame, regions);
    setupEarth(svg, earthLayer, frame);
    setupToggle($<HTMLInputElement>("#toggle-regions"), regionsLayer);
    setupToggle($<HTMLInputElement>("#toggle-earth"), earthLayer, (on) => ($("#earth-hint").hidden = !on));
  }
  if (today) {
    renderStats(today, regions);
    renderFlareBars(today);
    renderXray(today);
    renderTimelapse(today);
  }
}

main();
