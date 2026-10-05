// Builds the link-preview images (WhatsApp, Facebook, X, Google) in public/og/.
// 1200×630 JPEG, one per page, under 300 KB so WhatsApp shows the large preview.
// Run from site/:  node scripts/og/build.mjs
// Needs Playwright (Chromium). The images are committed; rerun only when the design changes.
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "../..");
const repo = path.resolve(site, "..");
const pw = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(pw);

const url = (p) => pathToFileURL(path.join(site, p)).href;
const font = url("node_modules/@fontsource-variable/heebo/files/heebo-hebrew-wght-normal.woff2");
const fontLatin = url("node_modules/@fontsource-variable/heebo/files/heebo-latin-wght-normal.woff2");

// The logo, taken from the header so the two never drift apart.
const baseAstro = readFileSync(path.join(site, "src/layouts/Base.astro"), "utf8");
const loops = [...baseAstro.matchAll(/class="loop loop-\d" pathLength="1" d="([^"]+)"/g)].map((m) => m[1]);
const mark = `<svg class="mark" viewBox="2 4 28 22.5"><g fill="none" stroke="#e08a6b" stroke-width="2" stroke-linecap="round">${loops
  .map((d) => `<path d="${d}"/>`)
  .join("")}</g><path d="M3 25H29" stroke="#f39b1e" stroke-width="2" stroke-linecap="round"/></svg>`;

// --- visuals -------------------------------------------------------------------------

const disk = (file) => `<div class="sun whole"><img src="${url("public/lab-archive/" + file)}" /></div>`;
const sun = (file, extra = "") => `<div class="sun"><img src="${url("public/lab-archive/" + file)}" />${extra}</div>`;

// The §6.5 fixture: the leading spot on 23–27.9.2026, drawn on the 25th like the lab does.
function trackOverlay() {
  const fix = [
    [668.2, 547.8, 508.6, 518.0, 475.6],
    [771.7, 541.0, 508.6, 518.0, 475.7],
    [857.2, 530.6, 508.6, 518.0, 475.8],
    [922.8, 520.1, 508.6, 518.0, 476.0],
    [966.4, 508.0, 508.8, 517.4, 475.9],
  ];
  const idx = JSON.parse(readFileSync(path.join(site, "public/lab-archive/index.json"), "utf8"));
  const f = idx.frames.find((x) => x.date === "2026-09-25");
  const pts = fix.map(([x, y, cx, cy, r]) => [(f.cx + ((x - cx) / r) * f.r) * 1000, (f.cy + ((y - cy) / r) * f.r) * 1000]);
  const line = pts.map((p) => p.join(" ")).join(" L");
  return `<svg viewBox="0 0 1000 1000"><path d="M${line}" fill="none" stroke="#38d6ff" stroke-width="5"/>${pts
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 2 ? 17 : 10}" fill="${i === 2 ? "none" : "#38d6ff"}" stroke="#38d6ff" stroke-width="5"/>`)
    .join("")}</svg>`;
}

function cycleChart() {
  const p = path.join(repo, "media-local/cycle.json");
  if (!existsSync(p)) throw new Error("cycle.json not found in media-local/ (run the daily pipeline locally first)");
  const c = JSON.parse(readFileSync(p, "utf8"));
  const obs = c.observed.filter((r) => r[2] != null).map((r) => [r[0], r[2]]);
  const pred = c.predicted.map((r) => [r[0], r[1]]);
  const t = (m) => {
    const [y, mo] = m.split("-").map(Number);
    return y + (mo - 0.5) / 12;
  };
  const all = [...obs, ...pred];
  const t0 = t(all[0][0]), t1 = t(all.at(-1)[0]);
  const vmax = Math.max(...all.map((r) => r[1])) * 1.1;
  const W = 600, H = 470;
  const xy = ([m, v]) => `${(((t(m) - t0) / (t1 - t0)) * W).toFixed(1)} ${(H - (v / vmax) * H).toFixed(1)}`;
  const area = `M0 ${H} L${obs.map(xy).join(" L")} L${xy(obs.at(-1)).split(" ")[0]} ${H} Z`;
  const years = [];
  for (let y = Math.ceil(t0); y <= t1; y += 4) years.push(y);
  return `<svg class="chart" viewBox="-40 -20 ${W + 70} ${H + 70}">
    ${years.map((y) => `<line x1="${((y - t0) / (t1 - t0)) * W}" x2="${((y - t0) / (t1 - t0)) * W}" y1="0" y2="${H}" stroke="#ffffff" stroke-opacity=".08"/><text x="${((y - t0) / (t1 - t0)) * W}" y="${H + 42}" fill="#a8a196" font-size="24" text-anchor="middle">${y}</text>`).join("")}
    <path d="${area}" fill="#f39b1e" fill-opacity=".18"/>
    <path d="M${obs.map(xy).join(" L")}" fill="none" stroke="#f39b1e" stroke-width="5" stroke-linejoin="round"/>
    <path d="M${pred.map(xy).join(" L")}" fill="none" stroke="#e08a6b" stroke-width="5" stroke-dasharray="12 9"/>
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="#ffffff" stroke-opacity=".25"/>
  </svg>`;
}

const galileo = () => `<div class="pair">
  <figure><img class="paper" src="${url("public/history/galileo-1612-06-28.jpg")}" /><figcaption>גלילאו, 1612</figcaption></figure>
  <figure><div class="sun small"><img src="${url("public/lab-archive/20260925.jpg")}" /></div><figcaption>SDO, 2026</figcaption></figure>
</div>`;

const projection = () => `<div class="proj"><div class="card"><div class="disk"><img src="${url("public/lab-archive/20260926.jpg")}" /></div></div></div>`;

// --- cards ---------------------------------------------------------------------------

const CARDS = [
  { file: "home", title: "כתמי השמש עכשיו", sub: "תמונה של השמש שמתעדכנת כל שעה, סרטון של 30 ימים ונתונים חיים מ-NOAA", visual: disk("20260925.jpg") },
  { file: "lab", title: "מעבדת סיבוב השמש", sub: "עוקבים אחרי כתם כמה ימים ומחשבים בכמה זמן השמש מסתובבת, כמו גלילאו ב-1612", visual: sun("20260925.jpg", trackOverlay()) },
  { file: "history", title: "איך גילו את כתמי השמש", sub: "הריוט, גלילאו ושיינר, מינימום מאונדר ואירוע קרינגטון", visual: galileo() },
  { file: "cycle", title: "מחזור השמש", sub: "מספר הכתמים עולה ויורד במחזור של כ-11 שנים. המחזור הנוכחי מול התחזית", visual: cycleChart() },
  { file: "safety", title: "איך צופים בשמש בבטחה", sub: "הקרנה על דף לבן, פילטרים תקניים, ומה אסור לעשות", visual: projection() },
  { file: "default", title: "השמש היום", sub: "כתמי השמש, יום אחר יום. תמונה חיה, מעבדה, היסטוריה ומחזור השמש", visual: disk("20260924.jpg") },
];

const page = (c) => `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>
@font-face{font-family:Heebo;src:url(${font}) format("woff2");font-weight:100 900;unicode-range:U+0590-05FF}
@font-face{font-family:Heebo;src:url(${fontLatin}) format("woff2");font-weight:100 900}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:#12100e;color:#f3eee6;font-family:Heebo,sans-serif;position:relative}
.text{position:absolute;inset:0 0 0 auto;width:560px;padding:64px 64px 56px 0;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:30px;color:#f3eee6}
.mark{width:62px;height:50px}
h1{margin-top:auto;font-size:66px;line-height:1.08;font-weight:800;letter-spacing:-.5px;text-wrap:balance}
p{margin-top:22px;font-size:30px;line-height:1.35;color:#c9c1b4;text-wrap:pretty}
.url{margin-top:auto;padding-top:28px;font-size:22px;color:#8f877b;direction:ltr;text-align:right;letter-spacing:.3px}
.bar{position:absolute;right:0;top:0;bottom:0;width:10px;background:#c96442}
.visual{position:absolute;left:0;top:0;bottom:0;width:640px;display:grid;place-items:center;overflow:hidden}
.sun{position:absolute;width:700px;height:700px;left:-110px;top:-35px}
.sun img,.sun svg{position:absolute;inset:0;width:100%;height:100%}
/* the archive frames are black squares; keep only the disk (r = 0.4756 of the side) */
.sun img{clip-path:circle(47.9% at 49.96% 50%)}
.sun.whole{position:relative;left:0;top:0;width:590px;height:590px}
.sun.small{position:relative;width:250px;height:250px;left:0;top:0}
.pair{display:flex;gap:34px;align-items:flex-end;direction:ltr}
.pair figure{display:flex;flex-direction:column;align-items:center;gap:14px}
.pair figcaption{font-size:24px;color:#a8a196}
.paper{width:250px;height:250px;object-fit:cover;border-radius:50%;filter:sepia(.25)}
.chart{width:560px}
.proj .card{width:400px;height:400px;background:#f6f3ee;border-radius:10px;transform:rotate(-5deg);box-shadow:0 30px 60px rgba(0,0,0,.5);display:grid;place-items:center}
.proj .disk{width:300px;height:300px;border-radius:50%;overflow:hidden;filter:grayscale(1) brightness(1.3) contrast(1.25);mix-blend-mode:multiply}
.proj .disk img{width:105%;height:105%;margin:-2.5%;clip-path:circle(47.9% at 49.96% 50%)}
</style><body>
<div class="visual">${c.visual}</div>
<div class="text">
  <div class="brand">${mark}<span>השמש היום</span></div>
  <h1>${c.title}</h1>
  <p>${c.sub}</p>
  <div class="url">sunspots.co.il</div>
</div>
<div class="bar"></div>
</body></html>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const tmp = mkdtempSync(path.join(os.tmpdir(), "og-"));
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const c of CARDS) {
  // A file:// page, so it may load the local images and fonts.
  const html = path.join(tmp, `${c.file}.html`);
  writeFileSync(html, page(c));
  await tab.goto(pathToFileURL(html).href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: path.join(site, `public/og/${c.file}.jpg`), type: "jpeg", quality: 84 });
  console.log(`public/og/${c.file}.jpg`);
}
await browser.close();
