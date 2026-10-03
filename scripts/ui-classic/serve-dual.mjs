#!/usr/bin/env node
/**
 * Serve `dist/` (depois de `npm run build:dual`) com as MESMAS regras do nginx
 * do Dockerfile: o cookie `torque_ui` escolhe index.html e sw.js; sem cookie,
 * clássica. Só para provar a troca localmente — produção é o nginx.
 *
 *   node scripts/ui-classic/serve-dual.mjs [--port 4196]
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(RAIZ, "dist");
const i = process.argv.indexOf("--port");
const PORTA = Number(i >= 0 ? process.argv[i + 1] : 4196);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

function cookieUi(req) {
  const m = /(?:^|;\s*)torque_ui=([^;]+)/.exec(req.headers.cookie ?? "");
  return m?.[1] === "v5" ? "v5" : "classic";
}

function servir(res, arquivo, semCache) {
  res.writeHead(200, {
    "Content-Type": TIPOS[extname(arquivo)] ?? "application/octet-stream",
    "Cache-Control": semCache ? "no-store, must-revalidate" : "public, max-age=31536000, immutable",
  });
  createReadStream(arquivo).pipe(res);
}

http
  .createServer((req, res) => {
    const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const ui = cookieUi(req);
    const indice = join(DIST, ui === "v5" ? "index.html" : "index.classic.html");
    // location = / | = /index.html → $ui_index
    if (caminho === "/" || caminho === "/index.html") return servir(res, indice, true);
    // location = /sw.js → $ui_sw
    if (caminho === "/sw.js") return servir(res, join(DIST, ui === "v5" ? "sw.js" : "sw.classic.js"), true);
    const arquivo = normalize(join(DIST, caminho));
    if (arquivo.startsWith(DIST) && existsSync(arquivo) && statSync(arquivo).isFile()) {
      return servir(res, arquivo, !caminho.startsWith("/assets/"));
    }
    if (caminho.startsWith("/assets/")) {
      res.writeHead(404);
      return res.end();
    }
    // location / → try_files $uri $uri/ $ui_index
    return servir(res, indice, true);
  })
  .listen(PORTA, "localhost", () => console.log(`dual: http://localhost:${PORTA} (cookie torque_ui escolhe a build)`));
