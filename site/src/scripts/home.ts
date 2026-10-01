// Home page: reads today.json and manifest.json at runtime (BRIEF §3), so the
// static site never needs a rebuild for new data.
import { MEDIA_BASE } from "../config";
import { EARTH_RADII_PER_SUN, heliographicToPixel, synodicRate, type Disk } from "../lib/solar";
import type { FrameEntry, Manifest, Region, Today } from "../lib/types";
import { formatLocalTime, formatUtc, relativeFromNow } from "../lib/format";

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

function renderImage(frame: FrameEntry) {
  const img = $<HTMLImageElement>("#sun");
  const t = new Date(frame.t);
  img.src = `${MEDIA_BASE}/${frame.key}`;
  img.alt = `תמונת השמש באור נראה (SDO/HMI), ${formatLocalTime(t)}`;
  img.addEventListener("load", () => $("#plate-empty").remove(), { once: true });

  $("#frame-time").innerHTML = `${formatLocalTime(t)} · <time datetime="${frame.t}" class="ltr">${formatUtc(t)}</time>`;
  const age = $("#frame-age");
  const tick = () => (age.textContent = `(עודכן ${relativeFromNow(t)})`);
  tick();
  setInterval(tick, 60_000);
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
  const g = svgEl("g", { class: "earth", tabindex: 0, role: "img", "aria-label": "כדור הארץ בקנה מידה" }, layer);
  const hit = svgEl("circle", { r: Math.max(r * 4, 24), class: "earth-hit" }, g);
  const body = svgEl("circle", { r, class: "earth-body" }, g);
  const label = svgEl("text", { class: "earth-label" }, g);
  label.textContent = "כדור הארץ";
  const place = () => {
    for (const c of [hit, body]) {
      c.setAttribute("cx", String(pos.x));
      c.setAttribute("cy", String(pos.y));
    }
    label.setAttribute("x", String(pos.x));
    label.setAttribute("y", String(pos.y + r + 30));
  };
  place();

  const toViewbox = (e: PointerEvent) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM()!.inverse());
  };
  let dragging = false;
  g.addEventListener("pointerdown", (e) => {
    dragging = true;
    g.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  g.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = toViewbox(e);
    pos.x = Math.min(1000, Math.max(0, p.x));
    pos.y = Math.min(1000, Math.max(0, p.y));
    place();
  });
  g.addEventListener("pointerup", () => (dragging = false));
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
    pos.x = Math.min(1000, Math.max(0, pos.x + d[e.key][0]));
    pos.y = Math.min(1000, Math.max(0, pos.y + d[e.key][1]));
    place();
  });
}

function setupToggle(button: HTMLButtonElement, layer: SVGGElement, onChange?: (on: boolean) => void) {
  const apply = () => {
    const on = button.getAttribute("aria-pressed") === "true";
    layer.style.display = on ? "" : "none";
    // the Earth must be reachable by mouse/keyboard while visible
    if (layer.classList.contains("earth-layer")) $("#overlay").classList.toggle("interactive", on);
    onChange?.(on);
  };
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
    apply();
  });
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

  // Time runs left→right as on the instruments, also in an RTL page (docs/DECISIONS.md).
  const W = 560, H = 190, padL = 30, padR = 8, padT = 8, padB = 22;
  const t0 = new Date(x.series[0][0]).getTime();
  const t1 = new Date(x.series[x.series.length - 1][0]).getTime();
  const ly0 = -8.5, ly1 = -3.5;
  const sx = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const sy = (f: number) => padT + (1 - (Math.log10(Math.max(f, 1e-9)) - ly0) / (ly1 - ly0)) * (H - padT - padB);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "xray-svg", role: "img", "aria-label": `שטף קרני X ב-24 השעות האחרונות. עכשיו: ${x.latest.class}` });
  for (const [name, f] of CLASS_LEVELS) {
    const y = sy(f);
    svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid" }, svg);
    svgEl("text", { x: padL - 8, y: y - 4, class: "axis-label" }, svg).textContent = name;
  }
  const pts = x.series.map(([t, f]) => [sx(new Date(t).getTime()), sy(f)] as const);
  svgEl("path", { d: "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L"), class: "xray-line" }, svg);
  for (const [frac, anchor] of [[0, "start"], [1, "end"]] as const) {
    const t = new Date(t0 + frac * (t1 - t0));
    svgEl("text", { x: sx(t.getTime()), y: H - 4, class: "time-label", "text-anchor": anchor }, svg).textContent =
      `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")} UTC`;
  }

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
    tip.innerHTML = `<span class="num ltr">${formatUtc(new Date(t))}</span><br><strong class="num">${classOf(f)}</strong>`;
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
  const [today, manifest] = await Promise.all([getJSON<Today>("today.json"), getJSON<Manifest>("manifest.json")]);
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
    const regionsLayer = svgEl("g", { class: "regions-layer" }, svg);
    const earthLayer = svgEl("g", { class: "earth-layer" }, svg);
    renderRegions(regionsLayer, frame, regions);
    setupEarth(svg, earthLayer, frame);
    setupToggle($("#toggle-regions"), regionsLayer);
    setupToggle($("#toggle-earth"), earthLayer, (on) => ($("#earth-hint").hidden = !on));
  }
  if (today) {
    renderStats(today, regions);
    renderFlareBars(today);
    renderXray(today);
    renderTimelapse(today);
  }
}

main();
