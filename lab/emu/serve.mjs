// One local HTTP server for the emulator:
//   /app/...                        built Nuvio app (dist/)
//   /addon/manifest.json            fake Stremio addon with ROWS catalogs
//   /addon/catalog/<type>/<id>.json ITEMS synthetic titles per catalog
//   /img/poster/<n>.jpg             500x750 JPEG (same size TMDB "w500" posters have)
//   /img/backdrop/<n>.jpg           1280x720 JPEG
//   TRAILER_YT=<YouTube id>         optional: every title gets this trailer (default none)
// No real titles, accounts or keys. Every response can be delayed by LATENCY_MS to mimic the TV's network.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(process.env.APP_DIR || path.join(HERE, "../../dist"));
const PORT = +(process.env.PORT || 8090);
const ROWS = +(process.env.ROWS || 20);
const ITEMS = +(process.env.ITEMS || 40);
const LATENCY_MS = +(process.env.LATENCY_MS || 150);
const TRAILER_YT = process.env.TRAILER_YT || "";
const ASSETS = path.join(HERE, "assets");
const posters = fs
  .readdirSync(path.join(ASSETS, "posters"))
  .filter((f) => f.endsWith(".jpg"))
  .sort();
const backdrops = fs
  .readdirSync(path.join(ASSETS, "backdrops"))
  .filter((f) => f.endsWith(".jpg"))
  .sort();
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

const base = `http://127.0.0.1:${PORT}`;
const catalogs = Array.from({ length: ROWS }, (_, i) => ({
  type: i % 2 ? "series" : "movie",
  id: `lab${i}`,
  name: `Lab Row ${i + 1}`
}));
const manifest = {
  id: "org.nuvio.perflab",
  version: "1.0.0",
  name: "Perf Lab",
  description: "Synthetic catalogs for performance tests",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["lab"],
  catalogs
};
function metas(catId) {
  const row = +catId.replace("lab", "");
  return Array.from({ length: ITEMS }, (_, j) => {
    const n = row * ITEMS + j;
    return {
      id: `lab:${row}:${j}`,
      type: row % 2 ? "series" : "movie",
      name: `Title ${row + 1}.${j + 1}`,
      poster: `${base}/img/poster/${n}.jpg`,
      background: `${base}/img/backdrop/${n}.jpg`,
      description: "Synthetic item for performance testing. ".repeat(3),
      releaseInfo: String(1990 + (n % 35)),
      imdbRating: (5 + (n % 50) / 10).toFixed(1),
      genres: ["Drama", "Action", "Comedy"].slice(0, 1 + (n % 3)),
      ...(TRAILER_YT ? { trailers: [{ source: TRAILER_YT, type: "Trailer" }] } : {})
    };
  });
}
function send(res, code, type, body) {
  setTimeout(() => {
    res.writeHead(code, {
      "content-type": type,
      "access-control-allow-origin": "*",
      "cache-control": "max-age=3600"
    });
    res.end(body);
  }, LATENCY_MS);
}
http
  .createServer((req, res) => {
    const u = new URL(req.url, base);
    const p = decodeURIComponent(u.pathname);
    if (p === "/addon/manifest.json")
      return send(res, 200, "application/json", JSON.stringify(manifest));
    let m = p.match(/^\/addon\/catalog\/(movie|series)\/([^/]+?)(?:\/[^/]*)?\.json$/);
    if (m) return send(res, 200, "application/json", JSON.stringify({ metas: metas(m[2]) }));
    m = p.match(/^\/addon\/meta\/(movie|series)\/(.+)\.json$/);
    if (m) {
      const [, row, j] = m[2].split(":").map(Number);
      return send(
        res,
        200,
        "application/json",
        JSON.stringify({ meta: metas(`lab${row}`)[j] || null })
      );
    }
    // Each URL is distinct, so the browser decodes every poster separately, like real posters.
    m = p.match(/^\/img\/(poster|backdrop)\/(\d+)\.jpg$/);
    if (m) {
      const list = m[1] === "poster" ? posters : backdrops;
      const file = path.join(ASSETS, m[1] + "s", list[+m[2] % list.length]);
      return send(res, 200, "image/jpeg", fs.readFileSync(file));
    }
    if (p.startsWith("/app/")) {
      const file = path.join(APP_DIR, p.slice(5) || "index.html");
      if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
        return send(res, 404, "text/plain", "not found");
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream"
      });
      return fs.createReadStream(file).pipe(res);
    }
    send(res, 404, "text/plain", "not found");
  })
  .listen(PORT, "127.0.0.1", () =>
    console.log(`serve: ${base} app=${APP_DIR} rows=${ROWS} items=${ITEMS} latency=${LATENCY_MS}ms`)
  );
