// Site-wide settings. The name was chosen by the owner (docs/DECISIONS.md #17); the domain is still open.
export const SITE_NAME = "השמש היום";
export const SITE_TAGLINE = "כתמי השמש, יום אחר יום";

/** Where today.json, manifest.json, frames and the timelapse live.
 *  Dev: served from ../media-local by astro.config.mjs.
 *  Production: PUBLIC_MEDIA_BASE, e.g. https://media.sunspots.example */
export const MEDIA_BASE = (import.meta.env.PUBLIC_MEDIA_BASE ?? "/media").replace(/\/$/, "");

export const NAV = [
  { href: "", label: "התמונה של היום" },
  { href: "lab/", label: "מעבדת הסיבוב" },
  { href: "history/", label: "היסטוריה" },
  { href: "cycle/", label: "מחזור השמש" },
  { href: "safety/", label: "תצפית בטוחה" },
  { href: "about/", label: "אודות" },
] as const;

export const CREDIT_SDO = "Courtesy of NASA/SDO and the HMI/AIA science teams";
export const CREDIT_NOAA = "NOAA Space Weather Prediction Center";
