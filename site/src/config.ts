// Site-wide settings. The name was chosen by the owner (docs/DECISIONS.md #17); the domain is still open.
export const SITE_NAME = "השמש היום";
export const SITE_TAGLINE = "כתמי השמש, יום אחר יום";

/** Where today.json, manifest.json, frames and the timelapse live.
 *  Dev: served from ../media-local by astro.config.mjs.
 *  Production: PUBLIC_MEDIA_BASE, https://media.sunspots.co.il */
export const MEDIA_BASE = (import.meta.env.PUBLIC_MEDIA_BASE ?? "/media").replace(/\/$/, "");

export const NAV = [
  { href: "", label: "התמונה של היום" },
  { href: "lab/", label: "מעבדת הסיבוב" },
  { href: "history/", label: "היסטוריה" },
  { href: "cycle/", label: "מחזור השמש" },
  { href: "safety/", label: "תצפית בטוחה" },
  { href: "about/", label: "אודות" },
] as const;

/** The owner's WhatsApp group: one astronomy update a day, members can't post. */
export const WHATSAPP_GROUP = "https://chat.whatsapp.com/JPkp1hyk4J938apVTFu6J1";

export const CREDIT_SDO = "Courtesy of NASA/SDO and the HMI/AIA science teams";
export const CREDIT_NOAA = "NOAA Space Weather Prediction Center";

/** The owner's other sites, for the "עוד אתרים שלי" strip in the footer (src/components/SisterSites.astro).
 *  [emoji, url, link text, optional unlinked tail]. Same list as his other sites, without this site and
 *  without the WhatsApp invite (this site has its own invite card in the footer). */
export const SISTER_SITES: readonly (readonly [string, string, string, string?])[] = [
  ["🩻", "https://roentgen.co.il/", "רנטגן · לראות מבפנים"],
  ["📜", "https://geniza.co.il/", "הגניזה הקהירית"],
  ["🛠️", "https://making-il.co.il/", "מייקינג", " · יצירה טכנולוגית"],
  ["💶", "https://banknote.co.il/", "Banknote · שטרות ומטבעות"],
  ["🛩️", "https://dronexam.co.il/", 'לעוף לשמיים · מבחן רת"א לרחפנים'],
  ["🌱", "https://holisticcenter.co.il/", "מעט צרי · רפואה משלימה"],
  ["🛸", "https://pursue.co.il/", 'PURSUE · ארכיון עב"מים'],
  ["🌍", "https://quake.co.il/", "רעידת אדמה · רעידות היסטוריות"],
  ["📅", "https://heb-cal.co.il/", "לוח עברי"],
];
