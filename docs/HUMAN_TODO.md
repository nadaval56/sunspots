# מה נדרש מהאדם

לפי סדר עדיפות. סמנו `[x]` כשסיימתם.

## עכשיו (לא עולה כסף, לוקח כמה דקות)

### 0. [ ] להעלות את אב-הטיפוס של המעבדה
ה-BRIEF מפנה ל-`docs/reference/rotation-lab-prototype.html`, אבל הקובץ לא נמצא ב-repo. העלו אותו לנתיב הזה לפני M4. אם הוא לא יגיע, Claude יבנה את המעבדה מהמפרט שבסעיף 6.

### 1. [ ] ליצור את `.claude/settings.json`
Claude לא יכול ליצור קובץ שמרחיב את ההרשאות שלו עצמו. העתיקו את בלוק ה-JSON מסעיף 2 ב-`docs/BRIEF.md` לקובץ `.claude/settings.json` ועשו commit. אם אתם עובדים ב-auto mode, אפשר לדלג.

### 2. [x] לפתוח גישת רשת בסביבת Claude Code בענן
בסביבת הענן של Claude, הכתובות הבאות נחסמו (403 מה-proxy). לכן אי אפשר היה לאמת את מקורות הנתונים, והפיתוח נעשה עם נתונים סינתטיים:
`jsoc1.stanford.edu`, `sdo.gsfc.nasa.gov`, `services.swpc.noaa.gov`, `www.sidc.be`.

איך: בכותרת של הסשן פותחים את תפריט הסביבה (cloud environment), בוחרים **Edit**, ותחת **Network access** מוסיפים את הדומיינים לרשימה המותרת או בוחרים רמת גישה רחבה יותר. הסבר על הרמות: https://code.claude.com/docs/en/claude-code-on-the-web

### 3. [x] (לא נחוץ עוד: הבדיקה רצה בהצלחה מהסשן) להריץ את בדיקת המקורות ב-GitHub
אחרי שה-PR ימוזג: לשונית **Actions**, בוחרים **verify-sources**, ואז **Run workflow**. הטבלה תופיע ב-Summary של הריצה. הדביקו אותה לסשן הבא של Claude כדי שיעדכן את STATUS ויתקן את ה-readers של NOAA אם צריך.

### 4. [ ] להחליט על שם ודומיין
- שם האתר: "כתמים", "השמש היום" או "יומן שמש" (או משהו אחר).
- דומיין: עד שיוחלט, הקוד משתמש ב-`sunspots.example`.

## M7: חיבור לענן (כשהאתר מוכן)

### 5. [ ] חשבון Cloudflare ו-bucket ב-R2
1. נרשמים ב-https://dash.cloudflare.com (חינם).
2. בתפריט: **R2 Object Storage**. צריך להפעיל את R2, וזה דורש אמצעי תשלום, אבל השכבה החינמית (10GB) מספיקה לפי ההערכה ב-BRIEF סעיף 3.
3. **Create bucket**, שם: `sunspots-media`, ‏Location: Automatic.
4. רושמים את ה-**Account ID** (מופיע בעמוד הראשי של R2).

### 6. [ ] API token ל-R2
1. ב-R2: **Manage R2 API Tokens**, ואז **Create API token**.
2. Permissions: **Object Read & Write**, מוגבל ל-bucket `sunspots-media` בלבד.
3. שומרים את **Access Key ID** ואת **Secret Access Key**. הם מוצגים פעם אחת בלבד.

### 7. [ ] Secrets ו-Variables ב-GitHub
ב-repo: **Settings**, אחר כך **Secrets and variables**, ואז **Actions**.
- לשונית **Secrets**: מוסיפים `R2_ACCOUNT_ID`, ‏`R2_ACCESS_KEY_ID`, ‏`R2_SECRET_ACCESS_KEY`.
- לשונית **Variables**: מוסיפים `R2_BUCKET` = `sunspots-media`, ‏`SUNSPOTS_DOMAIN` = הדומיין שנבחר.
- **רק אחרי שכל השאר מוכן:** ‏`PIPELINE_ENABLED` = `true`. זה מפעיל את ה-cron של ingest ו-daily.

### 8. [ ] דומיין ותת-דומיין למדיה
1. קונים דומיין (עולה כסף) ומעבירים את ה-nameservers ל-Cloudflare לפי ההנחיות שלהם.
2. ב-bucket: **Settings**, ואז **Custom Domains** ו-**Connect Domain**: ‏`media.<DOMAIN>`.

### 9. [ ] CORS ב-R2
ב-bucket: **Settings**, ואז **CORS Policy** ו-**Edit**. מדביקים (מחליפים את הדומיין):
```json
[
  {
    "AllowedOrigins": ["https://<DOMAIN>", "http://localhost:4321"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

### 10. [ ] GitHub Pages
**Settings**, ואז **Pages**, ותחת Source בוחרים **GitHub Actions**. אם יש דומיין: Custom domain = `<DOMAIN>`, ומוסיפים ב-Cloudflare DNS רשומות לפי https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site

### 11. [ ] לסמן כאן שסיימתם
אחרי סעיפים 5–10, כתבו ל-Claude: "M7 מוכן". הוא יריץ את `daily` ידנית עם `backfill_days=30`, יוודא ריצה מוצלחת ראשונה, ויבדוק את האתר.
