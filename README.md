# יומן שמש: אתר כתמי השמש

אתר סטטי בעברית שמתעדכן לבד: תמונה של השמש כל שעה מ-SDO/HMI, טיימלאפס של 30 יום, נתונים חיים מ-NOAA, ומעבדה למדידת סיבוב השמש.

- המפרט: [`docs/BRIEF.md`](docs/BRIEF.md)
- מצב העבודה: [`docs/STATUS.md`](docs/STATUS.md) · החלטות: [`docs/DECISIONS.md`](docs/DECISIONS.md) · משימות לאדם: [`docs/HUMAN_TODO.md`](docs/HUMAN_TODO.md)

## הרצה מקומית

```bash
pip install -r requirements.txt
python -m pipeline.backfill --days 3 --step-hours 2   # מוריד תמונות ונתונים אמיתיים ל-./media-local
# בלי רשת: SUNSPOTS_SYNTHETIC=1 python -m pipeline.backfill --days 3 --step-hours 2
pytest

cd site
npm install
npm run dev     # http://localhost:4321
npm test
```

Images: Courtesy of NASA/SDO and the HMI/AIA science teams. Data: NOAA SWPC; WDC-SILSO, Royal Observatory of Belgium, Brussels.
