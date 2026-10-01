# נגישות ופרטיות: כללי עבודה

תפריט הנגישות והודעת הפרטיות הועתקו מ-geniza-explorer והותאמו לאתר הזה (DECISIONS #39–#44).

## הקבצים
- `site/public/assets/privacy.js`: הודעת הפרטיות, השער לאחסון המקומי (`PRIVACY.get/set`), ופקדי העיון והמחיקה.
- `site/public/assets/a11y.js`, `site/public/assets/a11y.css`: תפריט הנגישות ומצבי התצוגה. קיצור Alt+Shift+A, סגירה ב-Esc.
- `site/public/assets/legal.css`: העיצוב של שני המסמכים.
- `site/src/layouts/Base.astro`: הסקריפט שמשחזר את ההגדרות לפני הציור (בראש הדף), ה-config, ואז `privacy.js` ואז `a11y.js` (בסוף הדף).
- `site/src/pages/privacy.astro`, `site/src/pages/accessibility.astro`: מדיניות הפרטיות והצהרת הנגישות. נכתבו ביד.
- `site/scripts/a11y-audit.mjs`: ביקורת אוטומטית.

הקבצים ב-`public/assets/` מוגשים כמו שהם, בלי bundling, כדי שסדר הטעינה והסקריפט שלפני הציור יישארו בדיוק כך.

## כללים
1. **`privacy.js` נטען תמיד לפני `a11y.js`.** ‏`a11y.js` שואל את `PRIVACY` אם מותר לכתוב לאחסון. בסדר הפוך השאלה נענית "כן" בשקט, והבחירה של המשתמש נדרסת.
2. **כל מידת טקסט ב-`rem` (או `em`).** פקד גודל הטקסט משנה את `font-size` של `<html>`, ו-`px` מתעלם ממנו. זה חל על CSS, על `<style>` בקבצי astro ועל סגנונות שנוצרים ב-TS. חריג מכוון מסומן בהערה `a11y-allow-px` באותה שורה (כרגע: טקסט SVG בתוך viewBox קבוע, וסרגל בחירת הגודל בתפריט עצמו).
3. **אין קוד של צד שלישי.** אין CDN, אין analytics ואין תוסף נגישות מסחרי. הגופנים מוגשים מהאתר (fontsource). מדיניות הפרטיות מצהירה על זה.
4. **כל שירות חיצוני חדש או מפתח אחסון חדש** (‏localStorage, ‏sessionStorage, ‏IndexedDB, עוגייה) מחייב עדכון של **שני המסמכים באותו commit**: הטבלה בסעיף 3 ובסעיף 5 של מדיניות הפרטיות, וההצהרה אם זה משנה נגישות. מפתחות חדשים מקבלים את הקידומת `sunspots:` (כך `purge()` ו"מה שמור עליי" רואים אותם).
5. **מצבי הצבע הם דריסת טוקנים**, לא `filter` על `<html>` (זה שובר `position: fixed`). צבע חדש בדף צריך להיות טוקן מ-`global.css`, או לקבל דריסה ב-`a11y.css` לכל מצב. לכל `var()` ב-`a11y.css` יש ערך גיבוי.
6. **תמונות השמש וה-canvas של המעבדה לא עוברים filter באף מצב**, ולוח הצילום נשאר כהה. צבעי המסלולים (`--track-1`, `--track-2`) לא נדרסים.
7. **לפני push שנוגע ב-CSS, בתבניות או בעמודים**, מריצים את הביקורת:
   ```
   cd site
   SITE_BASE=/sunspots/ npx astro build
   LOCAL_MEDIA_DIR=../media-local node scripts/a11y-audit.mjs
   ```
   Playwright נטען מ-`PLAYWRIGHT_MODULE`, מהחבילה `playwright`, או מ-`/opt/node22/lib/node_modules/playwright/index.mjs`. אם אין `media-local` (או שה-build מצביע ל-R2 בסביבה בלי רשת), שגיאות הטעינה של הנתונים החיים מדווחות כ"רעש סביבה" ולא נספרות.
