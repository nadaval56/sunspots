# סטטוס

## M0: שלד ואימות מקורות ✅

- מבנה ה-repo: ‏`pipeline/` (Python), ‏`scripts/`, ‏`tests/`, ‏`docs/`, ‏`.github/workflows/`.
- `scripts/verify_sources.py` (וגם `verify-sources.yml` להרצה ידנית ב-GitHub).

**תוצאות, 2026-10-01 09:06 UTC** (אחרי פתיחת הרשת בסביבה):

| מקור | סטטוס | גודל | גיל | מבנה / הערה |
|---|---|---|---|---|
| JSOC index היום/אתמול | 200 | 75KB / 196KB | — | 1120 / 2944 קישורי jpg |
| SDO latest HMIIC 1024 | 200 | 197KB | **233 שעות** | תקוע, כמו שה-BRIEF הזהיר |
| SDO latest 1700 1024 | 200 | 175KB | 233 שעות | |
| SDO browse index | 200 | 408KB | — | HMIIC האחרון: 24.9 07:30. ‏1700 מתעדכן |
| NOAA observed cycle | 200 | 512KB | 0 | `time-tag`, `ssn`, `smoothed_ssn`… |
| NOAA predicted cycle | 200 | 18KB | 0 | `time-tag`, `predicted_ssn`… |
| NOAA daily SSN | 200 | 476KB | 0 | `Obsdate`, `swpc_ssn` |
| NOAA srs.txt | 200 | 0.7KB | 0 | ה-parser עובד על הקובץ האמיתי |
| NOAA solar_regions.json | 200 | 136KB | 0 | `location`, `latitude`, **`longitude` חיובי למזרח** (ראו DECISIONS #14) |
| NOAA solar_probabilities | 200 | 9KB | 0 | `date`, `c_class_1_day`… |
| GOES xrays-1-day | 200 | 647KB | 0 | `time_tag`, `energy`, `flux`. יש דגימות עם `flux=0` (חוסר נתונים) |
| SILSO daily CSV | 200 | 2.9MB | — | `;`-separated: שנה;חודש;יום;שנה עשרונית;SN;סטיית תקן;תצפיות;זמני. נשמר ב-`data/silso_daily.csv` |

**הרצה אמיתית מקומית:** ingest הוריד את JSOC `Ic_1k` של 08:30 ועבר את כל הבדיקות. daily שמר ארכיון `Ic_4k` ב-2048, ו-`today.json` מלא בנתוני NOAA אמיתיים (מספר כתמים 27, אזורים 4535 ו-4544, ‏C 45%, ‏M 15%, ‏X 1%).

**מדידת רדיוס (DECISIONS #4):** ב-1AU, ‏HMI הוא 475.2 פיקסלים (JSOC ו-SDO זהים) ו-AIA 1700 הוא 400.0. מרכז הדיסקה ב-JSOC היום הוא (511.5, 511.5), ולא (508.7, 517.6) כמו ב-BRIEF. כנראה שהמיקום השתנה, וזה עוד סיבה להתאים את הדיסקה מחדש בכל פריים.

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

## M3: שלד האתר ✅
- `site/`: ‏Astro 7 ו-TypeScript, ‏`lang="he" dir="rtl"`, גופנים מ-fontsource (Frank Ruhl Libre, ‏Assistant, ‏IBM Plex Mono, רק subsets של עברית ולטינית), טוקנים לבהיר ולכהה, ולוח צילום כהה בשני המצבים.
- ניווט לשבעה עמודים. דף הבית מלא, והשאר דפי "בבנייה".
- **דף הבית** קורא את `today.json` ו-`manifest.json` בזמן ריצה: תמונה עם חותמת זמן ו"עודכן לפני", אזורים פעילים מסומנים על התמונה (מסובבים לרגע הצילום, DECISIONS #16), טבלת אזורים, מספר כתמים, הסתברויות C/M/X, גרף קרני X לוגריתמי עם crosshair ו-tooltip, טיימלאפס, באנר נפילה, וכדור הארץ בקנה מידה (גרירה או חיצים).
- `site/src/lib/solar.ts` עובר את ה-fixture של סעיף 6.5 גם ב-TypeScript (vitest).
- נבדק עם נתונים אמיתיים (backfill של 4 ימים, 49 פריימים מ-JSOC): ‏`astro check` נקי, אין שגיאות בקונסול, אין גלילה אופקית ב-360px, ומצב כהה נבדק בצילום מסך.
- `deploy.yml` מוכן (מחכה ל-`PAGES_ENABLED`), ו-`ci.yml` בונה ובודק גם את האתר.

**פיתוח מקומי:**
```
python -m pipeline.backfill --days 3 --step-hours 2
cd site && npm install && npm run dev      # http://localhost:4321
```

## הבא
M4: המעבדה. חסר: `docs/reference/rotation-lab-prototype.html` (HUMAN_TODO #0).
