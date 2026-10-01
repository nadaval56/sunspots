const rtf = new Intl.RelativeTimeFormat("he", { numeric: "auto" });

/** "לפני 12 דקות", "לפני שעתיים", … */
export function relativeFromNow(t: Date, now: Date = new Date()): string {
  const s = (t.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** Local wall-clock time in the viewer's zone, Hebrew month names. */
export function formatLocalTime(t: Date): string {
  return t.toLocaleString("he-IL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** "2026-10-01 08:30 UTC" */
export function formatUtc(t: Date): string {
  return t.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
