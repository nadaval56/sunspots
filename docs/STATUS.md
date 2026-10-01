# סטטוס

## M0: שלד ואימות מקורות (חלקי)

**נעשה**
- מבנה ה-repo: ‏`pipeline/` (Python), ‏`scripts/`, ‏`tests/`, ‏`docs/`, ‏`.github/workflows/`. ‏`CLAUDE.md` מפנה ל-`docs/BRIEF.md`.
- `scripts/verify_sources.py` בודק את כל 13 הכתובות מסעיף 4 ומדפיס טבלה עם סטטוס, גודל, גיל לפי Last-Modified, ומבנה ה-JSON.
- `verify-sources.yml`: הרצה ידנית של אותה בדיקה על runner של GitHub.

**פתוח: אימות המקורות עצמם**
ב-2026-10-01 כל הכתובות נחסמו מסביבת הפיתוח בענן (`ProxyError`, ‏CONNECT 403). זו מדיניות רשת של הסביבה, לא תקלה במקורות:

| מקור | תוצאה מסביבת הפיתוח |
|---|---|
| jsoc1.stanford.edu | חסום (403 proxy) |
| sdo.gsfc.nasa.gov | חסום (403 proxy) |
| services.swpc.noaa.gov | חסום (403 proxy) |
| www.sidc.be | חסום (403 proxy) |

לכן:
- מבנה ה-JSON של NOAA **לא אומת**. ה-readers ב-`pipeline/noaa.py` סלחניים (DECISIONS #13).
- הרדיוס של SDO browse הוא הערכה (DECISIONS #4).
- `data/silso_daily.csv` עוד לא הורד.

ראו HUMAN_TODO סעיפים 2–3.

## M1: ingest ✅ (מקומית)
- `python -m pipeline.ingest` עם `STORAGE=local`, שכותב ל-`./media-local/`.
- סדר נפילה: JSOC `Ic_1k`, אחריו SDO `HMIIC`, ואז SDO `1700` עם באנר.
- אימות: HTTP ו-40KB, טריות <60 דק', רוויה (≥2 ערוצים ≥250 בתוך 0.8R, DECISIONS #2), רדיוס ±3% מותאם למרחק, ומרכז <3%.
- עיבוד: התאמת מעגל Kåsa, חיתוך 2·1.05·R, השחרה מחוץ ל-1.012R, ‏WebP ב-1024 וב-512.
- manifest של 30 יום, מחיקה של פריימים שעתיים אחרי 31 יום (הארכיון היומי לא נמחק), ולוג JSONL.
- בדיקות: ה-fixture הרווי של 4500 נפסל, נפילה בין מקורות, פריים תקוע של 3 ימים נפסל, רדיוס או מרכז שגוי נפסל, ופענוח אינדקס.
- `ingest.yml` קיים ומושבת עד `PIPELINE_ENABLED=true`.

## M2: daily, timelapse, backfill ✅ (מקומית, עם נתונים סינתטיים)
- `python -m pipeline.daily`: ארכיון יומי (‏Ic_4k, גודל 2048), טיימלאפס MP4 ו-WebM עם poster ושכבת תאריך, `today.json` ו-`lab.json`.
- `python -m pipeline.backfill --days 30 [--archive-days N]`: אידמפוטנטי, מדלג על שעות שכבר קיימות.
- parser ל-SRS (סעיף I בלבד, בלי plage), עם `solar_regions.json` כמקור מועדף.
- בדיקה: backfill סינתטי מייצר MP4 שעובר ffprobe (‏h264, ‏yuv420p, ‏moov לפני mdat, כלומר faststart).
- keepalive (`gautamkrishnar/keepalive-workflow@v2`, ‏`use_api: true`) ב-`daily.yml`.
- **פיתוח בלי רשת:** `SUNSPOTS_SYNTHETIC=1 python -m pipeline.backfill --days 30` (DECISIONS #6).

## בדיקה עיקרית: fixture מסעיף 6.5 ✅
`tests/test_solar.py`: ‏ω=13.64°/day, ‏B̄=+3.09°, ‏P_syn=26.39d, ‏P_sid=24.61d, ‏rms=0.13°, ו-B₀(23.9 06:00)=7.03°. בלי תיקון B₀, קו הרוחב נודד ב-4.7°.

## הבא
M3: שלד האתר ב-Astro.
