// @ts-check
import { defineConfig } from "astro/config";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

// Local media (pipeline STORAGE=local) is served at /media in `astro dev`, so the
// site can be developed without R2. Production reads PUBLIC_MEDIA_BASE instead.
const MEDIA_DIR = resolve(process.env.LOCAL_MEDIA_DIR ?? "../media-local");
/** @type {Record<string, string>} */
const TYPES = {
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** @returns {import("vite").Plugin} */
function serveLocalMedia() {
  return {
    name: "sunspots-local-media",
    configureServer(server) {
      server.middlewares.use("/media", (req, res, next) => {
        const path = join(MEDIA_DIR, decodeURIComponent((req.url ?? "/").split("?")[0]));
        if (!path.startsWith(MEDIA_DIR) || !existsSync(path) || !statSync(path).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(path).pipe(res);
      });
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL ?? "https://sunspots.example",
  base: process.env.SITE_BASE ?? "/",
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  vite: { plugins: [serveLocalMedia()] },
});
