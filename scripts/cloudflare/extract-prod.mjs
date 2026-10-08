#!/usr/bin/env node
/**
 * Baixa o front que está no ar (as duas builds), para a Cloudflare servir
 * EXATAMENTE o mesmo artefato que o nginx — e a paridade poder provar isso.
 *
 *   node scripts/cloudflare/extract-prod.mjs [--origin https://torquecrm.com.br] [--out cloudflare/.prod-dist]
 *
 * Por que baixar em vez de buildar: a build de produção sai do EasyPanel com
 * variáveis VITE_* (inclusive versão e Sentry) que mudam o hash de cada chunk.
 * Uma build local do mesmo commit não sai idêntica, e a paridade abortaria.
 *
 * Só leitura: GET, no máximo 6 ao mesmo tempo, sem credencial.
 *
 * De onde vem cada arquivo:
 *   - index.html / sw.js (cookie torque_ui=v5) e index.classic.html / sw.classic.js;
 *   - assets/**: o grafo de referências a partir desses quatro (cada chunk
 *     cita os que importa). No artefato extraído da imagem em 2026-10-05 esse
 *     grafo alcançava 466 de 466 arquivos;
 *   - os arquivos de public/ deste checkout, cada um conferido no ar (se o
 *     prod devolve o index do SPA, o arquivo não está lá e fica de fora);
 *     dotfiles (.well-known/) saem do checkout, porque o nginx não os serve;
 *   - manifest.webmanifest (gerado pelo build) e 50x.html (da imagem do nginx).
 * No fim, os quatro de cima são baixados de novo: se mudaram, o prod
 * redeployou no meio e a extração é descartada.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLOUDFLARE_DIR, REPO_ROOT, assertSafeOutDir, encodePath, listFiles, parseArgs, pool, sha256 } from "./lib.mjs";

export const DEFAULT_ORIGIN = "https://torquecrm.com.br";
export const DEFAULT_OUT = path.join(CLOUDFLARE_DIR, ".prod-dist");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const CONCURRENCY = 6;

const ROOTS = [
  { rel: "index.classic.html", path: "/index.classic.html", cookie: null },
  { rel: "index.html", path: "/index.html", cookie: "torque_ui=v5" },
  { rel: "sw.classic.js", path: "/sw.classic.js", cookie: null },
  { rel: "sw.js", path: "/sw.js", cookie: "torque_ui=v5" },
];
const EXTRA_ROOT_FILES = ["manifest.webmanifest", "50x.html"];


/** Nomes de arquivo com hash do Vite (`nome-XXXXXXXX.ext`) citados num texto. */
export function assetReferences(text) {
  const names = new Set();
  for (const match of text.matchAll(/[A-Za-z0-9_.~-]+\.(?:js|css|png|jpe?g|svg|webp|woff2?|ttf|eot|gif|ico)\b/g)) {
    const name = match[0];
    if (/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(name)) names.add(name);
  }
  return names;
}

/** `allowedRoot` só existe para os testes: a CLI sempre exige destino oculto em cloudflare/. */
export async function extractProd({ origin = DEFAULT_ORIGIN, out = DEFAULT_OUT, log = console.log, allowedRoot } = {}) {
  // Antes de qualquer rede ou `rm -rf`.
  out = assertSafeOutDir(out, allowedRoot);

  const get = async (pathname, cookie = null) => {
    const headers = { "user-agent": "torque-cf-extract/1.0" };
    if (cookie) headers.cookie = cookie;
    const response = await fetch(new URL(pathname, origin), { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  };
  const save = (rel, body) => {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };

  fs.rmSync(out, { recursive: true, force: true });

  const rootHashes = {};
  for (const root of ROOTS) {
    const response = await get(root.path, root.cookie);
    if (response.status !== 200) throw new Error(`${root.path}: HTTP ${response.status}`);
    save(root.rel, response.body);
    rootHashes[root.rel] = sha256(response.body);
  }
  const spaShell = fs.readFileSync(path.join(out, "index.classic.html"));

  // public/ deste checkout + os dois que não vêm de public/.
  const warnings = [];
  const publicFiles = listFiles(PUBLIC_DIR);
  let fromPublic = 0;
  await pool([...publicFiles, ...EXTRA_ROOT_FILES], CONCURRENCY, async (rel) => {
    if (rel.split("/").some((segment) => segment.startsWith("."))) {
      save(rel, fs.readFileSync(path.join(PUBLIC_DIR, rel)));
      fromPublic += 1;
      return;
    }
    const response = await get(encodePath(rel));
    const isSpaFallback = !rel.endsWith(".html") && response.body.equals(spaShell);
    if (response.status !== 200 || isSpaFallback) {
      warnings.push(`${rel}: não está no ar (HTTP ${response.status}${isSpaFallback ? ", index do SPA" : ""}) — fica de fora`);
      return;
    }
    save(rel, response.body);
    fromPublic += 1;
  });

  // assets/**, em ondas: cada arquivo baixado pode citar outros.
  const seen = new Set();
  let wave = ROOTS.map((root) => fs.readFileSync(path.join(out, root.rel), "latin1"));
  let assets = 0;
  let notFound = 0;
  while (wave.length > 0) {
    const names = [];
    for (const text of wave) {
      for (const name of assetReferences(text)) {
        if (seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    }
    wave = [];
    await pool(names, CONCURRENCY, async (name) => {
      const response = await get(`/assets/${encodeURIComponent(name)}`);
      if (response.status !== 200) {
        notFound += 1; // texto com cara de nome de chunk que não é arquivo
        return;
      }
      save(`assets/${name}`, response.body);
      assets += 1;
      if (/\.(js|css)$/.test(name)) wave.push(response.body.toString("latin1"));
    });
  }

  for (const root of ROOTS) {
    const response = await get(root.path, root.cookie);
    if (sha256(response.body) !== rootHashes[root.rel]) {
      fs.rmSync(out, { recursive: true, force: true });
      throw new Error("o prod redeployou durante a extração — rode de novo");
    }
  }

  log(`ok: ${ROOTS.length + fromPublic + assets} arquivos em ${path.relative(process.cwd(), out) || out}`);
  log(`    assets/: ${assets} (nomes citados sem arquivo: ${notFound}); raiz e public/: ${ROOTS.length + fromPublic}`);
  for (const warning of warnings) log(`    aviso: ${warning}`);
  return { out, assets, publicFiles: fromPublic, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const args = parseArgs(process.argv.slice(2), { origin: "string", out: "string" });
    await extractProd({ origin: args.origin ?? DEFAULT_ORIGIN, out: args.out ?? DEFAULT_OUT });
  } catch (error) {
    console.error(`extração falhou: ${error.message}`);
    process.exit(1);
  }
}
