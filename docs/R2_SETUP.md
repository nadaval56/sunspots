# הקמת Cloudflare R2: מדריך צעד אחר צעד

R2 הוא "הכונן בענן" של האתר. כל שעה ה-pipeline ב-GitHub Actions כותב אליו את תמונות השמש, את הסרטון ואת קובצי ה-JSON, והאתר קורא אותם משם. מאמתים כל שלב לפני שעוברים לשלב הבא.

**זמן משוער:** כ-30 דקות, בלי הדומיין.
**עלות:** ‏0 ₪ בשימוש הצפוי. השכבה החינמית כוללת 10GB אחסון, מיליון כתיבות ו-10 מיליון קריאות בחודש, והוצאת נתונים חינמית. אנחנו צפויים להשתמש בכ-1GB ובכ-20 אלף כתיבות בחודש.

> **כלל ברזל:** את המפתח הסודי (Secret Access Key) מדביקים **רק** ב-GitHub Secrets. לא בצ'אט, לא בקובץ ולא במייל.

---

## שלב 0: החלטה על הדומיין (משפיעה על הכול)

כדי לחבר ל-R2 כתובת כמו `media.<הדומיין שלך>`, הדומיין חייב להיות מנוהל ב-**אותו חשבון Cloudflare**. לכן כדאי להחליט כבר עכשיו:

| אפשרות | מתאים כש… | הערה |
|---|---|---|
| **א. לקנות את הדומיין דרך Cloudflare** (Registrar) | רוצים `.com`, ‏`.org` וכדומה | הכי פשוט: הדומיין נמצא מיד באותו חשבון, ו-Cloudflare מוכרים במחיר עלות. |
| **ב. לקנות אצל רשם ישראלי ולהעביר את ה-nameservers ל-Cloudflare** | רוצים `.co.il` או `.org.il` | ככל הידוע לי, Cloudflare לא מוכרים סיומות `.il`. רוכשים אצל רשם מוסמך ומפנים את ה-DNS ל-Cloudflare. |
| **ג. בינתיים בלי דומיין** | רוצים להתחיל עכשיו | משתמשים בכתובת הזמנית `r2.dev` (שלב 4א). היא מוגבלת בקצב ומיועדת לפיתוח בלבד, אבל מספיקה לבדיקות. |

**המלצה:** להתחיל באפשרות ג' כדי לראות שהכול עובד, ובמקביל להחליט על הדומיין. המעבר אחר כך הוא שינוי של משתנה אחד.

---

## שלב 1: חשבון Cloudflare
1. נכנסים ל-https://dash.cloudflare.com/sign-up ונרשמים במייל וסיסמה.
2. מאמתים את המייל (מגיע מייל עם קישור).
3. מומלץ מאוד להפעיל אימות דו-שלבי: לוחצים על האייקון של המשתמש, אחר כך **My Profile**, אחר כך **Authentication**.

✔️ **בדיקה:** אתם רואים את לוח הבקרה של Cloudflare.

## שלב 2: הפעלת R2
1. בתפריט הצד: **Storage & databases**, אחר כך **R2**, ואז **Overview**.
2. עוברים את תהליך ההרשמה ל-R2 (checkout). Cloudflare מבקשים אמצעי תשלום גם לשכבה החינמית, אבל לא יחויב כסף כל עוד נשארים בגבולותיה.
3. (רשות, מומלץ) הגדרת התראה על חיוב: **Manage Account**, אחר כך **Notifications**, ואז התראה מסוג Billing או Usage.

✔️ **בדיקה:** עמוד R2 נפתח, ויש בו כפתור ליצירת bucket.

## שלב 3: יצירת ה-bucket
1. ב-R2 לוחצים **Create bucket**.
2. **שם:** `sunspots-media`. אפשר שם אחר, אבל אז צריך לעדכן אותו גם בשלב 7.
3. **Location:** ‏`Automatic`.
4. **Default storage class:** ‏**Standard**. זה חשוב: השכבה החינמית חלה רק על Standard, ולא על Infrequent Access.
5. לוחצים **Create bucket**.

✔️ **בדיקה:** ה-bucket מופיע ברשימה, ריק.

## שלב 4: גישה ציבורית לקריאה

האתר צריך לקרוא את הקבצים מהדפדפן של הגולשים, ולכן ה-bucket צריך כתובת ציבורית לקריאה בלבד. הכתיבה נשארת רק עם המפתח הסודי.

### 4א. כתובת זמנית (`r2.dev`)
1. נכנסים ל-bucket ‏`sunspots-media`, ואז ללשונית **Settings**.
2. תחת **Public Development URL** לוחצים **Enable**.
3. בחלון האישור מקלידים `allow` ומאשרים.
4. מעתיקים את הכתובת שמופיעה, למשל `https://pub-abc123….r2.dev`. **שמרו אותה, נצטרך אותה בשלב 7.**

### 4ב. כתובת קבועה (כשיש דומיין ב-Cloudflare)
1. באותו מסך **Settings**, תחת **Custom Domains**, לוחצים **Add**.
2. מקלידים `media.<הדומיין שלך>`, לוחצים **Continue**, ואחר כך **Connect Domain**.
3. מחכים שהסטטוס יעבור מ-Initializing ל-**Active** (כמה דקות).
4. אחר כך מכבים את כתובת ה-`r2.dev` (Disable).

✔️ **בדיקה:** בשלב הזה ה-bucket ריק, אז פתיחת הכתובת בדפדפן תחזיר שגיאה. זה תקין, והבדיקה האמיתית תיעשה בשלב 8.

## שלב 5: מדיניות CORS

האתר יושב בכתובת אחת (GitHub Pages) וקורא JSON מכתובת אחרת (R2). דפדפנים חוסמים קריאה כזו בלי אישור מפורש, ו-CORS הוא האישור הזה.

1. ב-bucket, בלשונית **Settings**, תחת **CORS Policy**, לוחצים **Add CORS policy**.
2. עוברים ללשונית **JSON** ומדביקים:

```json
[
  {
    "AllowedOrigins": [
      "https://nadaval56.github.io",
      "http://localhost:4321"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

3. לוחצים **Save**.
4. **כשיהיה דומיין:** מוסיפים לרשימה גם `"https://<הדומיין שלך>"`, בלי לוכסן בסוף.

## שלב 6: מפתח גישה (API token) לכתיבה
1. בעמוד הראשי של R2, תחת **Account Details**, לוחצים **Manage** ליד **API Tokens**.
2. בוחרים **Create Account API token**. מפתח ברמת החשבון ממשיך לעבוד גם אם המשתמש האישי משתנה, ולכן הוא מתאים לאוטומציה.
3. **שם:** `sunspots-github-actions`.
4. **Permissions:** ‏**Object Read & Write**. לא Admin: ל-pipeline אין צורך ליצור או למחוק buckets.
5. **Specify bucket(s):** בוחרים רק את `sunspots-media`.
6. **TTL:** ‏Forever, או תאריך תפוגה ארוך שתזכרו לחדש.
7. לוחצים **Create**.
8. **מסך התוצאה מוצג פעם אחת בלבד.** פותחים במקביל לשונית של GitHub (שלב 7), ומעתיקים ישר לשם:
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID**: מופיע גם בעמוד הראשי של R2. זו מחרוזת של 32 תווים, והיא גם החלק הראשון בכתובת ה-endpoint, `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

## שלב 7: הכנסת הערכים ל-GitHub
ב-repo: **Settings**, אחר כך **Secrets and variables**, ואז **Actions**.

**לשונית Secrets** (לוחצים **New repository secret** לכל אחד):

| שם | ערך |
|---|---|
| `R2_ACCOUNT_ID` | ה-Account ID (32 תווים) |
| `R2_ACCESS_KEY_ID` | ה-Access Key ID |
| `R2_SECRET_ACCESS_KEY` | ה-Secret Access Key |

**לשונית Variables** (לוחצים **New repository variable**):

| שם | ערך |
|---|---|
| `R2_BUCKET` | `sunspots-media` |
| `PUBLIC_MEDIA_BASE` | כתובת ה-`r2.dev` משלב 4א, בלי לוכסן בסוף. כשיהיה דומיין: `https://media.<הדומיין>` |

**עוד לא** מוסיפים את `PIPELINE_ENABLED`. קודם בודקים.

## שלב 8: בדיקה
1. ב-repo: **Actions**, בוחרים **r2-check** בצד, לוחצים **Run workflow** ואז שוב **Run workflow**.
2. מחכים דקה ופותחים את הריצה. ב-Summary אמורים להופיע רק סימני ✅:
   - secrets present
   - write to bucket
   - read back the same bytes
   - list objects
   - public URL serves the object
   - CORS allows https://nadaval56.github.io

| אם נכשל… | הסיבה הסבירה |
|---|---|
| `secrets present` | שם של secret לא מדויק (רווח, אות קטנה במקום גדולה) |
| `write to bucket` עם `AccessDenied` | ה-token לא קיבל Object Read & Write, או לא שויך ל-bucket הנכון |
| `write to bucket` עם `NoSuchBucket` | שם ה-bucket ב-`R2_BUCKET` שונה מהשם ב-Cloudflare |
| `public URL` עם 401/403/404 | הכתובת הציבורית לא הופעלה (שלב 4), או ש-`PUBLIC_MEDIA_BASE` שגוי |
| `CORS allows` | מדיניות ה-CORS לא נשמרה, או שיש לוכסן מיותר בסוף ה-origin |

## שלב 9: הפעלה (אחרי שכל הבדיקות עברו)
כתבו ל-Claude **"R2 מוכן"**. מכאן Claude עושה:
1. מריץ backfill לענן: 30 ימים של תמונות, טיימלאפס ו-JSON.
2. מבקש ממך להוסיף את המשתנה `PIPELINE_ENABLED` = `true`, ומאותו רגע ה-cron רץ כל שעה וכל יום.
3. מוודא שהריצה השעתית הראשונה הצליחה.
4. מפעיל את GitHub Pages (HUMAN_TODO סעיף 10) ובודק את האתר החי.

---

### נספח: מה רץ ב-R2 ובאיזו תדירות

| פעולה | תדירות | סוג |
|---|---|---|
| כתיבת פריים (2 גדלים), manifest ולוג | כל שעה, כ-5 כתיבות | Class A |
| רשימת `frames/` לצורך מחיקה | כל שעה, פעם אחת | Class A |
| טיימלאפס, ארכיון יומי ו-JSON | פעם ביום, כ-10 כתיבות | Class A |
| גולשים קוראים JSON, תמונה וסרטון | לכל ביקור, כ-4 קריאות | Class B |
| מחיקת פריימים ישנים | כל שעה | חינם |

סך הכול כ-5,000 פעולות Class A בחודש, מתוך מיליון חינמיות.
