#!/usr/bin/env node
/* ================================================================
   ביקורת נגישות אוטומטית לאתר "השמש היום".
   ================================================================

   הועתק מ-geniza-explorer (scripts/a11y-audit.mjs) והותאם לאתר Astro
   שמתפרסם תחת base path (GitHub Pages: /sunspots/).

   הפעלה (מתוך site/):
     SITE_BASE=/sunspots/ npx astro build
     node scripts/a11y-audit.mjs                       # מגיש את dist/ בעצמו
     node scripts/a11y-audit.mjs --prefix /sunspots/   # ה-base שאיתו נבנה dist (ברירת מחדל: /sunspots/)
     node scripts/a11y-audit.mjs --pages "" lab/ privacy/
     node scripts/a11y-audit.mjs --url http://localhost:4324/   # מול astro dev / preview שכבר רץ

   Playwright: נטען מ-PLAYWRIGHT_MODULE, אחר כך מהחבילה 'playwright' אם
   מותקנת, ואחר כך מ-/opt/node22/lib/node_modules/playwright/index.mjs.

   במצב dist השרת הפנימי מגיש גם את /media מתוך LOCAL_MEDIA_DIR (ברירת
   מחדל: ../media-local), כמו astro dev. זה עובד רק כש-dist נבנה בלי
   PUBLIC_MEDIA_BASE. אם הנתונים החיים לא נטענים (אין media-local, או
   build שמצביע ל-R2 בסביבה בלי רשת), שגיאות הטעינה שלהם מדווחות בנפרד
   כ"רעש סביבה" ואינן נספרות כבעיה.

   מה נבדק:
   1. font-size ב-px בקוד המקור (CSS, ‏<style> בקבצי astro, וסגנונות
      שנוצרים ב-TS). חריג מכוון מסומן בהערה a11y-allow-px באותה שורה.
   2. הגדלה בפועל (getComputedStyle) לפני ואחרי "גדול".
   3. מטריצת עשרת פקדי התפריט מול כל דף.
   4. גלישה אופקית ב-320 וב-420 פיקסלים, רגיל / טקסט גדול / גדול + ריווח.
   5. מבנה: h1 יחיד, lang/dir, alt, שם נגיש, מזהים כפולים, קישורים שבורים,
      שגיאות JS.
   6. ניגודיות מול הרקע האפקטיבי, במצב רגיל ובמצב "ניגודיות הפוכה".
   7. מקלדת: Alt+Shift+A פותח, Tab נשאר בתוך התפריט, Esc סוגר ומחזיר מיקוד.

   קוד יציאה 1 אם נמצאה בעיה.
   ================================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');

/* ---------- ארגומנטים ---------- */
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };
const list = (n) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]);
  return out;
};
const DIST = path.resolve(arg('dist', path.join(SITE, 'dist')));
const PREFIX = ('/' + arg('prefix', '/sunspots/').replace(/^\/|\/$/g, '') + '/').replace('//', '/');
const URL_ARG = arg('url', null);
const MEDIA_DIR = path.resolve(process.env.LOCAL_MEDIA_DIR || path.join(SITE, '..', 'media-local'));
const CHROME = arg('chrome', process.env.CHROME_PATH || undefined);

const DEFAULT_PAGES = ['', 'lab/', 'history/', 'cycle/', 'safety/', 'about/', 'privacy/', 'accessibility/'];
const PAGES = list('pages') || DEFAULT_PAGES;

/* ---------- Playwright ---------- */
async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const t of tries) {
    try { return await import(t.startsWith('/') ? pathToFileURL(t).href : t); } catch { /* next */ }
  }
  console.error('Playwright לא נמצא. הגדירו PLAYWRIGHT_MODULE או התקינו playwright.');
  process.exit(2);
}
const { chromium } = await loadPlaywright();

/* ---------- שרת סטטי ל-dist ---------- */
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.mjs': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const fileFor = (urlPath) => {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.startsWith('/media/')) {
    const f = path.join(MEDIA_DIR, p.slice('/media/'.length));
    return f.startsWith(MEDIA_DIR) ? f : null;
  }
  if (!p.startsWith(PREFIX)) return null;
  p = '/' + p.slice(PREFIX.length);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST)) return null;
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) return path.join(f, 'index.html');
  return f;
};
let srv = null, BASE = URL_ARG ? URL_ARG.replace(/\/?$/, '/') : null;
if (!BASE) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`אין build ב-${DIST}. הריצו קודם: SITE_BASE=${PREFIX} npx astro build`);
    process.exit(2);
  }
  srv = http.createServer((q, r) => {
    const f = fileFor(q.url);
    if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('404'); }
    r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    r.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${srv.address().port}${PREFIX}`;
}
const ORIGIN = new URL(BASE).origin;

/* ---------- 1. סריקת קוד המקור ---------- */
function scanSource(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'dist'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scanSource(full, acc); continue; }
    if (!/\.(css|astro|ts|mjs|js)$/.test(e.name) || /\.test\.ts$/.test(e.name)) continue;
    if (full === fileURLToPath(import.meta.url)) continue;
    const rel = path.relative(SITE, full);
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/font-size\s*:\s*([0-9.]+)px/) ||
                line.match(/fontSize\s*=\s*[`'"]([0-9.]+)px/) ||
                line.match(/\bfont\s*=\s*[`'"][^`'"]*?([0-9.]+)px/);
      if (!m) return;
      /* שלוש המדרגות של a11y.css הן ההגדרה עצמה, לא הפרה. */
      if (/^\s*html(\[data-fs)?/.test(line)) return;
      if (/a11y-allow-px/.test(line)) return;
      acc.push({ file: rel, line: i + 1, px: m[1], text: line.trim().slice(0, 80) });
    });
  }
  return acc;
}

const problems = [];
const noise = [];
const say = (s = '') => console.log(s);
const head = (s) => { say(); say('━'.repeat(64)); say(s); say('━'.repeat(64)); };

head('1. גדלי גופן ב-px בקוד המקור');
const pxHits = [...scanSource(path.join(SITE, 'src')), ...scanSource(path.join(SITE, 'public'))];
if (!pxHits.length) say('  ✓ אין. כל מידות הטקסט יחסיות (או מסומנות a11y-allow-px).');
else {
  problems.push(`${pxHits.length} גדלי גופן ב-px`);
  say(`  ✗ ${pxHits.length} הצהרות שלא יגיבו לפקד גודל הטקסט:`);
  pxHits.forEach(h => say(`     ${h.file}:${h.line}  ${h.px}px → ${h.px / 16}rem   ${h.text}`));
}

/* ---------- דפדפן ---------- */
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
/* שגיאה של טעינת נתונים חיים (מ-/media או מ-R2) היא הסביבה, לא האתר. */
const isDataNoise = (msg, url = '') =>
  /\/media\/|r2\.dev|r2\.cloudflarestorage|media\./.test(url) ||
  /Failed to load resource|net::ERR_|ERR_CERT|NetworkError|Failed to fetch/.test(msg) && !url.startsWith(ORIGIN + PREFIX);
const newPage = async (w = 420, h = 900, colorScheme = 'light') => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme });
  const p = await ctx.newPage();
  p._errs = []; p._noise = [];
  p.on('pageerror', e => p._errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    /* "Failed to load resource" מגיע גם כאירוע response למטה, עם הכתובת המלאה. */
    if (/Failed to load resource/.test(m.text())) return;
    const url = (m.location() || {}).url || '';
    (isDataNoise(m.text(), url) ? p._noise : p._errs).push('CONSOLE: ' + m.text() + (url ? ' @ ' + url : ''));
  });
  p.on('response', r => {
    if (r.status() < 400) return;
    const u = r.url();
    /* קובץ של האתר עצמו שחסר הוא בעיה; קובץ נתונים חי שחסר הוא הסביבה. */
    (isDataNoise('', u) ? p._noise : p._errs).push(`HTTP ${r.status()}: ${u}`);
  });
  p.on('requestfailed', r => { if (!r.url().startsWith(ORIGIN + PREFIX)) p._noise.push('REQFAIL: ' + r.url()); });
  p._ctx = ctx;
  return p;
};
const openPage = async (url, w, h, scheme) => {
  const p = await newPage(w, h, scheme);
  await p.goto(BASE + url, { waitUntil: 'networkidle' });
  if (await p.locator('.consent-ok').count()) await p.click('.consent-ok');
  return p;
};
const label = (u) => '/' + u;

/* ---------- 2. הגדלה בפועל ---------- */
head('2. האם הטקסט באמת גדל (getComputedStyle)');
for (const url of PAGES) {
  const p = await openPage(url);
  const has = await p.evaluate(() => typeof A11Y !== 'undefined' && typeof A11Y.setFontSize === 'function');
  if (!has) { say(`  ${label(url)}  —  אין רכיב נגישות בדף`); problems.push(`אין רכיב נגישות ב-${label(url)}`); await p._ctx.close(); continue; }
  const measure = () => p.evaluate(() => {
    const out = [], seen = new Set();
    document.querySelectorAll('h1,h2,h3,h4,p,li,td,th,dt,dd,a,button,span,label,figcaption').forEach(e => {
      if (!e.textContent.trim() || e.closest('.a11y-panel,.consent')) return;
      /* :not(:root): a11y.js קובע data-fs על <html> עצמו. */
      if (e.closest('[data-fs]:not(:root),[data-a11y-allow-px]')) return;
      /* טקסט בתוך SVG עם viewBox קבוע נמדד ביחידות משתמש, לא ב-CSS px. */
      if (e.closest('svg')) return;
      const key = e.tagName + '|' + (e.className && e.className.baseVal === undefined ? e.className : '');
      if (seen.has(key) || seen.size > 60) return;
      seen.add(key);
      out.push({ key, size: parseFloat(getComputedStyle(e).fontSize) });
    });
    return out;
  });
  const before = await measure();
  await p.evaluate(() => A11Y.setFontSize('l'));
  await p.waitForTimeout(120);
  const after = await measure();
  const map = Object.fromEntries(after.map(x => [x.key, x.size]));
  const frozen = before.filter(x => map[x.key] && map[x.key] / x.size < 1.2);
  if (!frozen.length) say(`  ✓ ${label(url)}  —  ${before.length} אלמנטים, כולם גדלים`);
  else {
    problems.push(`${frozen.length} אלמנטים קפואים ב-${label(url)}`);
    say(`  ✗ ${label(url)}  —  ${frozen.length} מתוך ${before.length} קפואים:`);
    frozen.slice(0, 8).forEach(f => say(`     ${f.key}  ${f.size}px → ${map[f.key]}px`));
  }
  await p._ctx.close();
}

/* ---------- 3. מטריצת הפקדים ---------- */
head('3. מטריצת פקדי הנגישות');
const CHECKS = {
  'ניגודיות גבוהה': async p => { await p.click('.a11y-panel [data-mode="contrast"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => getComputedStyle(document.body).color); await p.click('.a11y-panel [data-mode="contrast"]');
    return r === 'rgb(0, 0, 0)'; },
  'ניגודיות הפוכה': async p => { await p.click('.a11y-panel [data-mode="invert"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => getComputedStyle(document.body).backgroundColor); await p.click('.a11y-panel [data-mode="invert"]');
    return r === 'rgb(0, 0, 0)'; },
  /* גווני אפור באתר הזה = דריסת טוקנים. לוח הצילום (.plate) מוחרג: תמונות
     השמש וצבעי המסלולים נשארים בצבעם בכוונה (docs/A11Y_PRIVACY.md). */
  'גווני אפור': async p => {
    const sat = () => p.evaluate(() => {
      const rgb = c => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      let max = 0;
      document.querySelectorAll('body *').forEach(e => {
        if (e.closest('.a11y-panel, .a11y-fab, .plate, svg, video')) return;
        const cs = getComputedStyle(e);
        for (const v of [cs.color, cs.backgroundColor, cs.borderTopColor]) {
          const c = rgb(v); if (c.length < 3) continue;
          if (/rgba/.test(v) && +(v.match(/[\d.]+/g) || [])[3] === 0) continue;
          max = Math.max(max, Math.max(...c) - Math.min(...c));
        }
      });
      return max;
    });
    const before = await sat();
    await p.click('.a11y-panel [data-mode="mono"]'); await p.waitForTimeout(120);
    const after = await sat();
    await p.click('.a11y-panel [data-mode="mono"]');
    return before < 40 || after < before * 0.5;
  },
  'פונט קריא': async p => { await p.click('[data-flag="readable"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Arial')); await p.click('[data-flag="readable"]');
    return r; },
  'ריווח מוגדל': async p => { await p.click('[data-flag="spacing"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => getComputedStyle(document.body).letterSpacing !== 'normal'); await p.click('[data-flag="spacing"]');
    return r; },
  'הדגשת קישורים': async p => { await p.click('[data-flag="links"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => { const a = document.querySelector('main a[href]') || document.querySelector('a[href]'); return a ? getComputedStyle(a).textDecorationThickness === '2px' : true; });
    await p.click('[data-flag="links"]'); return r; },
  'הדגשת מיקוד': async p => { await p.click('[data-flag="focus"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => { const f = document.querySelector('.a11y-fab'); f.focus(); return parseFloat(getComputedStyle(f).outlineWidth) >= 4; });
    await p.click('[data-flag="focus"]'); return r; },
  'סמן גדול': async p => { await p.click('[data-flag="cursor"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => getComputedStyle(document.body).cursor.includes('data:image')); await p.click('[data-flag="cursor"]');
    return r; },
  'עצירת אנימציות': async p => { await p.click('[data-flag="still"]'); await p.waitForTimeout(80);
    const r = await p.evaluate(() => getComputedStyle(document.querySelector('.a11y-fab')).transitionDuration === '0s'); await p.click('[data-flag="still"]');
    return r; },
};
const names = Object.keys(CHECKS);
const grid = {};
for (const url of PAGES) {
  const p = await openPage(url, 1280, 900);
  if (!(await p.locator('.a11y-fab').count())) { await p._ctx.close(); continue; }
  await p.click('.a11y-fab');
  grid[label(url)] = {};
  for (const n of names) { try { grid[label(url)][n] = await CHECKS[n](p); } catch (e) { grid[label(url)][n] = false; } }
  await p._ctx.close();
}
const cols = Object.keys(grid);
if (!cols.length) say('  אין דף עם רכיב נגישות.');
else {
  const w = Math.max(...names.map(n => n.length)) + 2;
  say(' '.repeat(w) + cols.map(c => c.slice(0, 13).padStart(15)).join(''));
  for (const n of names) {
    let line = n.padEnd(w);
    for (const c of cols) { const v = grid[c][n]; if (!v) problems.push(`${n} לא פועל ב-${c}`); line += (v ? '✓' : '✗').padStart(15); }
    say(line);
  }
}

/* ---------- 4. גלישה אופקית ---------- */
head('4. גלישה אופקית (1.4.10): 320px ו-420px, שלושה מצבים');
let overflows = 0;
for (const w of [320, 420]) {
  for (const url of PAGES) {
    const p = await openPage(url, w, 800);
    for (const mode of ['רגיל', 'טקסט גדול', 'טקסט גדול + ריווח']) {
      await p.evaluate(m => {
        A11Y.setFontSize(m !== 'רגיל' ? 'l' : 's');
        document.documentElement.classList.toggle('a11y-spacing', m.includes('ריווח'));
      }, mode);
      await p.waitForTimeout(150);
      const r = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      if (r.scroll > r.vw + 1) { overflows++; problems.push(`גלישה ב-${label(url)} ${w}px [${mode}]`);
        say(`  ✗ ${w}px ${label(url)} [${mode}]  scrollWidth=${r.scroll} > ${r.vw}`); }
    }
    await p._ctx.close();
  }
}
if (!overflows) say('  ✓ אין גלישה אופקית באף דף, באף רוחב, באף מצב.');

/* ---------- 5. מבנה ---------- */
head('5. מבנה סמנטי, תוויות וקישורים');
for (const url of PAGES) {
  const p = await openPage(url);
  const info = await p.evaluate(() => ({
    h1: document.querySelectorAll('h1').length,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    noAlt: [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length,
    noName: [...document.querySelectorAll('button,a[href]')].filter(b =>
      !(b.innerText || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length,
    dup: (() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))]; })(),
    rel: [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin)),
  }));
  const bad = [];
  if (info.h1 !== 1) bad.push(`h1 count=${info.h1}`);
  if (info.lang !== 'he' || info.dir !== 'rtl') bad.push(`lang/dir: ${info.lang}/${info.dir}`);
  if (info.noAlt) bad.push(`${info.noAlt} תמונות בלי alt`);
  if (info.noName) bad.push(`${info.noName} פקדים בלי שם נגיש`);
  if (info.dup.length) bad.push(`מזהים כפולים: ${info.dup.join(',')}`);
  if (srv) for (const h of new Set(info.rel)) {
    const u = new URL(h);
    const f = fileFor(u.pathname);
    if (!f || !fs.existsSync(f)) bad.push(`קישור שבור: ${u.pathname}`);
  }
  if (p._errs.length) bad.push(`שגיאות JS: ${p._errs.join(' | ').slice(0, 200)}`);
  if (p._noise.length) noise.push(`${label(url)}: ${p._noise.length} (${p._noise[0].slice(0, 110)})`);
  if (bad.length) { problems.push(`מבנה ב-${label(url)}`); say(`  ✗ ${label(url)}\n     ${bad.join('\n     ')}`); }
  else say(`  ✓ ${label(url)}`);
  await p._ctx.close();
}

/* ---------- 6. ניגודיות בפועל ---------- */
head('6. ניגודיות טקסט מול הרקע האפקטיבי (1.4.3)');
/* נבדק בבהיר, בכהה ובמצב "ניגודיות הפוכה". טקסט בתוך SVG נצבע ב-fill
   ולא ב-color, ולכן אינו נבדק כאן (צבעי הגרפים נבדקו ידנית). */
let lowCount = 0;
for (const url of PAGES) {
  for (const [mode, scheme] of [['בהיר', 'light'], ['כהה', 'dark'], ['ניגודיות הפוכה', 'light']]) {
    const p = await openPage(url, 1280, 900, scheme);
    if (mode === 'ניגודיות הפוכה') {
      await p.click('.a11y-fab'); await p.click('.a11y-panel [data-mode="invert"]');
      await p.keyboard.press('Escape'); await p.waitForTimeout(120);
    }
    const low = await p.evaluate(() => {
      const toRgb = c => { const m = c.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
      const lum = ([r, g, b]) => { const f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
      const bgOf = el => { let e = el;
        while (e) { const bg = getComputedStyle(e).backgroundColor; const c = toRgb(bg);
          const a = bg.match(/[\d.]+/g);
          if (c && !(a && a.length === 4 && +a[3] === 0)) return c;
          e = e.parentElement; }
        return [255, 255, 255]; };
      const out = [], seen = new Set();
      document.querySelectorAll('body *').forEach(el => {
        if (el.closest('.a11y-panel, .consent, .a11y-fab, svg, [hidden]')) return;
        const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!txt) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
        const r0 = el.getBoundingClientRect(); if (!r0.width || !r0.height) return;
        if (el.closest('.visually-hidden, .a11y-sr')) return;
        const size = parseFloat(cs.fontSize);
        const bold = +cs.fontWeight >= 700;
        const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
        const fg = toRgb(cs.color); if (!fg) return;
        const r = ratio(fg, bgOf(el));
        if (r >= need) return;
        const key = el.tagName + '.' + (el.className || '');
        if (seen.has(key)) return; seen.add(key);
        out.push({ key, r: +r.toFixed(2), need, size, color: cs.color, sample: (el.textContent || '').trim().slice(0, 28) });
      });
      return out;
    });
    if (!low.length) say(`  ✓ ${label(url)} [${mode}]`);
    else { lowCount += low.length; problems.push(`${low.length} כשלי ניגודיות ב-${label(url)} [${mode}]`);
      say(`  ✗ ${label(url)} [${mode}] — ${low.length} אלמנטים מתחת לסף:`);
      low.slice(0, 8).forEach(l => say(`     ${l.r}:1 (נדרש ${l.need}) ${l.key} ${l.size}px ${l.color}  "${l.sample}"`));
    }
    await p._ctx.close();
  }
}

/* ---------- 7. מקלדת ---------- */
head('7. מקלדת: Alt+Shift+A, לכידת Tab, Esc');
{
  const p = await openPage('', 1280, 900);
  await p.focus('nav a');
  await p.keyboard.press('Alt+Shift+KeyA');
  const opened = await p.evaluate(() => !document.getElementById('a11y-panel').hidden &&
    document.getElementById('a11y-panel').contains(document.activeElement));
  let trapped = true;
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press('Tab');
    if (!(await p.evaluate(() => document.getElementById('a11y-panel').contains(document.activeElement)))) { trapped = false; break; }
  }
  await p.keyboard.press('Shift+Tab');
  trapped = trapped && await p.evaluate(() => document.getElementById('a11y-panel').contains(document.activeElement));
  await p.keyboard.press('Escape');
  const closed = await p.evaluate(() => document.getElementById('a11y-panel').hidden &&
    document.activeElement && document.activeElement.matches('nav a'));
  for (const [n, v] of [['Alt+Shift+A פותח וממקד בתוך התפריט', opened], ['Tab ו-Shift+Tab נשארים בתוך התפריט', trapped], ['Esc סוגר ומחזיר את המיקוד לקישור', closed]]) {
    say(`  ${v ? '✓' : '✗'} ${n}`); if (!v) problems.push(n);
  }
  await p._ctx.close();
}

/* ---------- סיכום ---------- */
if (noise.length) {
  head('רעש סביבה (לא נספר): טעינת נתונים חיים נכשלה');
  noise.forEach(n => say('  · ' + n));
}
head(problems.length ? `נמצאו ${problems.length} בעיות` : 'הכול תקין');
problems.forEach(p => say('  · ' + p));
await browser.close();
if (srv) srv.close();
process.exit(problems.length ? 1 : 0);
