// sitemap.xml for search engines. Plain endpoint, no integration needed: the site
// has a fixed, short list of pages. Submit it in Google Search Console.
import type { APIRoute } from "astro";
import { NAV } from "../config";

const EXTRA = ["privacy/", "accessibility/"];

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  const urls = [...NAV.map((n) => n.href), ...EXTRA].map((p) => new URL(base + p, site).href);
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
