# מה נדרש מהאדם

לפי סדר עדיפות. סמנו `[x]` כשסיימתם.

## עכשיו (לא עולה כסף, לוקח כמה דקות)

### 0.5 [ ] להחליט על התאמת הדיסקה בארכיון הדוגמה
ב-M4 נמצא שהמרכז של הדיסקה ב-fixture של סעיף 6.5 (ובאב-הטיפוס) רחוק בכ-5 פיקסלים מהמרכז האמיתי. לכן קו הרוחב של כתם הדוגמה יוצא +3.1° במקום כ-+2.3°. כתבו אם להשאיר את הערכים של ה-BRIEF או לעבור להתאמה שלנו (פרטים ב-DECISIONS #22 וב-STATUS).

### 0. [x] להעלות את אב-הטיפוס של המעבדה
ה-BRIEF מפנה ל-`docs/reference/rotation-lab-prototype.html`. הקובץ הועלה, והמעבדה נבנתה ממנו (M4).

### 1. [ ] ליצור את `.claude/settings.json`
Claude לא יכול ליצור קובץ שמרחיב את ההרשאות שלו עצמו. העתיקו את בלוק ה-JSON מסעיף 2 ב-`docs/BRIEF.md` לקובץ `.claude/settings.json` ועשו commit. אם אתם עובדים ב-auto mode, אפשר לדלג.

### 2. [x] לפתוח גישת רשת בסביבת Claude Code בענן
בסביבת הענן של Claude, הכתובות הבאות נחסמו (403 מה-proxy). לכן אי אפשר היה לאמת את מקורות הנתונים, והפיתוח נעשה עם נתונים סינתטיים:
`jsoc1.stanford.edu`, `sdo.gsfc.nasa.gov`, `services.swpc.noaa.gov`, `www.sidc.be`.

איך: בכותרת של הסשן פותחים את תפריט הסביבה (cloud environment), בוחרים **Edit**, ותחת **Network access** מוסיפים את הדומיינים לרשימה המותרת או בוחרים רמת גישה רחבה יותר. הסבר על הרמות: https://code.claude.com/docs/en/claude-code-on-the-web

### 3. [x] (לא נחוץ עוד: הבדיקה רצה בהצלחה מהסשן) להריץ את בדיקת המקורות ב-GitHub
אחרי שה-PR ימוזג: לשונית **Actions**, בוחרים **verify-sources**, ואז **Run workflow**. הטבלה תופיע ב-Summary של הריצה. הדביקו אותה לסשן הבא של Claude כדי שיעדכן את STATUS ויתקן את ה-readers של NOAA אם צריך.

### 4. [ ] להחליט על שם ודומיין
- ~~שם האתר~~: נבחר "השמש היום" ✅
- דומיין: עד שיוחלט, הקוד משתמש ב-`sunspots.example`.

### 4.5 [x] גיבוי לתזמון: cron-job.org
GitHub מריץ workflows מתוזמנים באיחור ולפעמים מדלג. לכן cron-job.org מפעיל את `ingest` פעם בשעה דרך ה-API (משימה `sunspots ingest`, ‏POST ל-`.../actions/workflows/ingest.yml/dispatches` עם `{"ref":"main"}`). ריצת הבדיקה ב-1.10.2026 החזירה 204, והריצה ב-GitHub הצליחה.
- **לחדש את המפתח לפני שהוא פג:** fine-grained token בשם `cron-job sunspots`, עם הרשאת Actions: Read and write לריפו הזה בלבד. כשהוא יפוג, cron-job.org יקבל 401. ייצרו מפתח חדש באותן הגדרות והחליפו את הכותרת `Authorization` במשימה.
- **עד מרץ 2028:** GitHub סימן את גרסת ה-API `2022-11-28` כמיושנת (Sunset: 10.3.2028). לפני כן צריך לעדכן את הכותרת `X-GitHub-Api-Version` לגרסה הנוכחית.

## M7: חיבור לענן (כשהאתר מוכן)

### 5–9. [ ] הקמת Cloudflare R2
**המדריך המלא, צעד אחר צעד עם בדיקה בסוף: [`docs/R2_SETUP.md`](R2_SETUP.md).**
בקצרה: חשבון, הפעלת R2, יצירת bucket ‏(Standard), כתובת ציבורית (`r2.dev` לבדיקות, ודומיין קבוע בהמשך), CORS, token ‏(Object Read & Write, ל-bucket אחד), secrets ב-GitHub, ולבסוף הרצת ה-workflow ‏`r2-check`.

### 10. [ ] GitHub Pages
**Settings**, ואז **Pages**, ותחת Source בוחרים **GitHub Actions**. אחר כך, ב-**Settings › Secrets and variables › Actions › Variables**, מוסיפים: `PAGES_ENABLED` = `true`, ו-`PUBLIC_MEDIA_BASE` = `https://media.<DOMAIN>`. אם יש דומיין, גם `SITE_URL` = `https://<DOMAIN>` ו-`SITE_BASE` = `/`. אם יש דומיין: Custom domain = `<DOMAIN>`, ומוסיפים ב-Cloudflare DNS רשומות לפי https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site

### 11. [ ] לסמן כאן שסיימתם
אחרי סעיפים 5–10, כתבו ל-Claude: "M7 מוכן". הוא יריץ את `daily` ידנית עם `backfill_days=30`, יוודא ריצה מוצלחת ראשונה, ויבדוק את האתר.
