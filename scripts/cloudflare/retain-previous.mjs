#!/usr/bin/env node
/**
 * Mantém no deploy novo os chunks das builds anteriores.
 *
 *   node scripts/cloudflare/retain-previous.mjs --dist dist --sha <commit> \
 *     [--origin https://torquecrm.com.br] [--keep-days 7] [--max-builds 30]
 *
 * Por quê: cada versão do Worker publica EXATAMENTE o conjunto de arquivos da
 * build. Uma aba aberta durante o deploy (ou um service worker velho) segue
 * pedindo os chunks hashados da build anterior, que o deploy apagou: 404, e o
 * `import()` da rota falha. A recuperação (stale-build-recovery) cura depois do
 * fato; isto tira a causa. Os arquivos têm o hash no nome, então chunk que não
 * mudou é o mesmo arquivo em todas as builds — reter custa só os que mudaram, e
 * o upload do wrangler só envia o que a Cloudflare ainda não tem.
 *
 * Como: roda DEPOIS do `build:dual` e ANTES do `cf:prepare` (que varre tudo o
 * que entra, inclusive o que veio daqui). Lê o `torque-builds.json` do que está
 * no ar, baixa de lá os `/assets/*` das builds que ainda valem e os grava em
 * dist/assets/, e escreve o `torque-builds.json` novo em dist/.
 *
 * `torque-builds.json` (raiz, servido sem cache pela rota SPA do Worker):
 *   { "v": 1,
 *     "builds": [{ "id": "<sha>", "at": "<ISO>" }, …],      // mais nova primeiro
 *     "files":  { "<nome>.js": "<id da build mais nova que o usou>", … } }
 * Um arquivo fica enquanto a build em que ele foi visto pela última vez fica.
 * Uma build fica por `--keep-days` dias (e sempre a que está no ar, para uma
 * semana parada não derrubar quem ainda a usa), até `--max-builds` builds e
 * `MAX_FILES` arquivos no total (limite de 20.000 do Workers Static Assets).
 *
 * Melhor esforço, de propósito: o que falhar aqui (prod fora do ar, arquivo que
 * não baixou) vira `::warning::` e o deploy segue — segurar um hotfix por causa
 * da retenção seria pior que perdê-la. Só uso errado (sem dist) sai com erro.
 *
 * Só leitura no prod: GET, até 6 ao mesmo tempo, sem credencial. O que sobe é
 * texto público do próprio site, mas o nome vem de rede: é validado (`SAFE_NAME`,
 * um segmento só) antes de virar caminho de arquivo.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assetReferences, DEFAULT_ORIGIN } from "./extract-prod.mjs";
import { parseArgs, pool } from "./lib.mjs";

export const MANIFEST_FILE = "torque-builds.json";
export const DEFAULTS = { keepDays: 7, maxBuilds: 30, maxFiles: 15_000 };
const CONCURRENCY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Nome de arquivo hashado do Vite, um segmento, sem separador nem `%`. */
const SAFE_NAME = /^[A-Za-z0-9_.~-]+-[A-Za-z0-9_-]{8}\.(?:js|css|png|jpe?g|svg|webp|woff2?|ttf|eot|gif|ico)$/;
const BUILD_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const ROOTS = ["index.html", "sw.js"];

export const isSafeName = (name) => typeof name === "string" && !name.includes("..") && SAFE_NAME.test(name);

/** Manifest lido da rede: só o que tem a forma esperada; o resto é descartado. */
export function parseManifest(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.builds) || typeof raw.files !== "object" || raw.files === null) return null;
  const builds = raw.builds.filter(
    (b) => b && typeof b.id === "string" && BUILD_ID.test(b.id) && typeof b.at === "string" && Number.isFinite(Date.parse(b.at)),
  );
  const ids = new Set(builds.map((b) => b.id));
  const files = {};
  for (const [name, id] of Object.entries(raw.files)) {
    if (isSafeName(name) && typeof id === "string" && ids.has(id)) files[name] = id;
  }
  return { v: 1, builds: builds.map(({ id, at }) => ({ id, at })), files };
}

/**
 * Decide o que fica — puro, para ser testado sem rede.
 * @returns {{ manifest: object, toFetch: string[], dropped: string[] }}
 */
export function planRetention({ previous, currentId, currentFiles, now, keepDays = DEFAULTS.keepDays, maxBuilds = DEFAULTS.maxBuilds, maxFiles = DEFAULTS.maxFiles }) {
  const current = [...new Set(currentFiles)].filter(isSafeName).sort();
  const currentSet = new Set(current);
  const prior = (previous?.builds ?? []).filter((b) => b.id !== currentId);

  // Mais nova primeiro; a que está no ar (a primeira) fica mesmo se já passou do prazo.
  const sorted = [...prior].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  let kept = sorted.filter((b, i) => i === 0 || now - Date.parse(b.at) <= keepDays * DAY_MS).slice(0, Math.max(0, maxBuilds - 1));

  const build = (builds) => {
    const ids = new Set(builds.map((b) => b.id));
    const files = {};
    for (const [name, id] of Object.entries(previous?.files ?? {})) if (ids.has(id) && !currentSet.has(name)) files[name] = id;
    return files;
  };

  let carried = build(kept);
  // Teto de arquivos: descarta a build mais velha até caber.
  while (kept.length > 0 && current.length + Object.keys(carried).length > maxFiles) {
    kept = kept.slice(0, -1);
    carried = build(kept);
  }

  const files = { ...carried };
  for (const name of current) files[name] = currentId;
  const sortedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const keptIds = new Set(kept.map((b) => b.id));
  const dropped = (previous?.builds ?? []).filter((b) => b.id !== currentId && !keptIds.has(b.id)).map((b) => b.id);

  return {
    manifest: { v: 1, builds: [{ id: currentId, at: new Date(now).toISOString() }, ...kept], files: sortedFiles },
    toFetch: Object.keys(carried).sort(),
    dropped,
  };
}

/** Arquivos do build que a V5 alcança a partir de index.html e sw.js (o grafo de referências). */
export async function reachableAssets(readText) {
  const seen = new Set();
  let wave = [];
  for (const root of ROOTS) {
    const text = await readText(root, true);
    if (text !== null) wave.push(text);
  }
  while (wave.length > 0) {
    const names = [];
    for (const text of wave) {
      for (const name of assetReferences(text)) {
        if (!isSafeName(name) || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    }
    wave = [];
    const texts = await pool(names, CONCURRENCY, (name) => readText(name, false));
    names.forEach((name, i) => {
      if (texts[i] !== null && /\.(js|css)$/.test(name)) wave.push(texts[i]);
    });
  }
  return [...seen].sort();
}

const looksLikeHtml = (buffer) => /^\s*<(?:!doctype|html)/i.test(buffer.subarray(0, 64).toString("latin1"));

/**
 * @param {{ dist: string, sha: string, origin?: string, now?: number, keepDays?: number, maxBuilds?: number,
 *   fetchImpl?: typeof fetch, log?: (line: string) => void, warn?: (line: string) => void }} options
 */
export async function retainPrevious({ dist, sha, origin = DEFAULT_ORIGIN, now = Date.now(), keepDays, maxBuilds, fetchImpl = fetch, log = console.log, warn = (m) => console.log(`::warning::${m}`) }) {
  const assetsDir = path.join(dist, "assets");
  if (!BUILD_ID.test(sha ?? "")) throw new Error("--sha inválido (commit da build)");
  if (!fs.existsSync(assetsDir) || ROOTS.some((r) => !fs.existsSync(path.join(dist, r)))) {
    throw new Error(`${dist}: não é a build do front (npm run build:dual)`);
  }

  const get = async (pathname) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(new URL(pathname, origin), {
          headers: { "user-agent": "torque-cf-retain/1.0" },
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });
        return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
      } catch (error) {
        if (attempt === 1) return { status: 0, body: Buffer.alloc(0), error };
      }
    }
    return { status: 0, body: Buffer.alloc(0) };
  };

  // O que ESTA build tem: o que a V5 alcança, não o que o build:dual deixou ao lado (a clássica inerte).
  const currentFiles = await reachableAssets(async (rel, isRoot) => {
    const file = path.join(dist, isRoot ? rel : path.join("assets", rel));
    return fs.existsSync(file) ? fs.readFileSync(file, "latin1") : null;
  });

  // O que está no ar.
  let previous = null;
  let reachable = true;
  const live = await get(`/${MANIFEST_FILE}`);
  if (live.status === 200) previous = parseManifest(live.body.toString("utf8"));
  if (live.status === 0 || live.status >= 500) {
    reachable = false;
    warn(`retenção de chunks: ${origin} não respondeu (${live.status || "rede"}); esta build sai sem as anteriores`);
  } else if (!previous) {
    // Primeiro deploy com retenção: a build que está no ar vira a "anterior".
    log("retenção: sem torque-builds.json no ar; semeando com a build atual do prod");
    const liveFiles = await reachableAssets(async (rel, isRoot) => {
      const r = await get(isRoot ? `/${rel}` : `/assets/${encodeURIComponent(rel)}`);
      if (r.status !== 200) return null;
      // index.html é HTML por natureza; um asset que volta HTML é o fallback do SPA, não o arquivo.
      if (!isRoot && looksLikeHtml(r.body)) return null;
      return r.body.toString("latin1");
    });
    if (liveFiles.length > 0) {
      previous = { v: 1, builds: [{ id: "seed", at: new Date(now).toISOString() }], files: Object.fromEntries(liveFiles.map((n) => [n, "seed"])) };
    }
  }

  const plan = planRetention({ previous: reachable ? previous : null, currentId: sha, currentFiles, now, keepDays, maxBuilds });

  // Baixa o que falta. Nome já presente = mesmo hash = mesmo arquivo: não rebaixa.
  const failed = new Set();
  let fetched = 0;
  const missing = plan.toFetch.filter((name) => !fs.existsSync(path.join(assetsDir, name)));
  await pool(missing, CONCURRENCY, async (name) => {
    const response = await get(`/assets/${encodeURIComponent(name)}`);
    if (response.status !== 200 || response.body.length === 0 || (/\.(js|css)$/.test(name) && looksLikeHtml(response.body))) {
      failed.add(name);
      return;
    }
    fs.writeFileSync(path.join(assetsDir, name), response.body, { flag: "wx" });
    fetched += 1;
  });
  if (failed.size > 0) warn(`retenção de chunks: ${failed.size} arquivo(s) das builds anteriores não baixaram e ficam de fora`);

  const manifest = { ...plan.manifest, files: Object.fromEntries(Object.entries(plan.manifest.files).filter(([name]) => !failed.has(name))) };
  fs.writeFileSync(path.join(dist, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  const carried = plan.toFetch.length - failed.size;
  log(`ok: ${currentFilesCount(manifest, sha)} arquivos desta build + ${carried} retidos de ${manifest.builds.length - 1} build(s) anterior(es) (${fetched} baixados)`);
  if (plan.dropped.length > 0) log(`    builds fora da janela: ${plan.dropped.length}`);
  return { manifest, carried, fetched, failed: [...failed], dropped: plan.dropped };
}

const currentFilesCount = (manifest, sha) => Object.values(manifest.files).filter((id) => id === sha).length;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const args = parseArgs(process.argv.slice(2), { dist: "string", sha: "string", origin: "string", "keep-days": "number", "max-builds": "number" });
    await retainPrevious({
      dist: path.resolve(args.dist ?? "dist"),
      sha: args.sha ?? process.env.GITHUB_SHA,
      origin: args.origin ?? DEFAULT_ORIGIN,
      keepDays: args["keep-days"],
      maxBuilds: args["max-builds"],
    });
  } catch (error) {
    console.error(`retenção falhou: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
