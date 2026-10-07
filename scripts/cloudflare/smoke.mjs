#!/usr/bin/env node
/**
 * Smoke do front publicado: confere, num host só, o contrato que o deploy promete.
 *
 *   node scripts/cloudflare/smoke.mjs --url https://torque-front.torquecrm.workers.dev \
 *     [--assets cloudflare/.assets] [--override <version-id>] [--expect-version <version-id>] \
 *     [--allow-missing-version] [--retry-for <segundos>]
 *
 * Dois modos:
 *   - com `--assets`: o host tem de servir EXATAMENTE aqueles arquivos (index,
 *     service workers e os chunks de entrada, por sha256). É o smoke do deploy.
 *   - autoconsistente (sem `--assets`): a referência é o próprio host — o `/`
 *     sem cookie tem de ser o `/index.classic.html` que ele serve, e assim por
 *     diante. É o smoke do rollback, quando não há artefato local da versão.
 *
 * `--override <id>` manda `Cloudflare-Workers-Version-Overrides` em TODA
 * requisição: a versão nova é exercitada a 0 % do tráfego, antes de promover.
 *
 * Prova de versão: toda resposta que o Worker gera leva `X-Torque-Version`
 * (binding version_metadata). Com `--expect-version <id>` (implícito com
 * `--override`), cada resposta do Worker tem de vir dessa versão;
 * `--allow-missing-version` aceita também o header ausente (rollback para uma
 * versão de antes do header). Sem a prova, um override que a Cloudflare
 * ignore em silêncio — ela ignora quando a versão não está na deployment —
 * testaria a versão ANTERIOR e daria PASS. A rodada para logo nos dois index
 * se a versão não for a esperada: com `--retry-for`, o smoke espera a
 * propagação antes de avaliar o resto.
 *
 * Prazos: cada requisição tem 10 s e uma tentativa só; cada rodada, 60 s no
 * total (um AbortSignal corta o que estiver pendurado). Com `--retry-for R`,
 * nenhuma rodada começa depois de R: o pior caso é R + 60 s.
 *
 * O que se confere (lista fechada):
 *   - `/` sem cookie = clássica; com cada variante de cookie medida
 *     (cookie-cases.json), a interface que o Worker escolhe;
 *   - `sw.js` e `sw.classic.js` = os arquivos (e `/sw.js` sem cookie = clássica);
 *   - os chunks de entrada (`/assets/*` citados pelos dois index): 200, corpo
 *     igual ao arquivo, Cache-Control imutável, headers do app;
 *   - `<chunk>.map` dá 404 e não devolve source map;
 *   - `/api/v1/leads` sem Accept-Encoding: 401, sem compressão, envelope JSON
 *     `{"error":{"code","message"}}`;
 *   - uma CSP só (vírgula = duas políticas = FAIL) e os headers de
 *     cloudflare/headers.json presentes;
 *   - rota do SPA (`/leads`) dá 200 com o index;
 *   - `X-Robots-Tag` presente onde o Worker responde em `*.workers.dev`, e
 *     ausente em qualquer resposta do domínio real.
 *
 * Resultado: PASS (sai 0), FAIL (sai 1) ou BLOQUEADO (sai 3) — o último quando
 * alguma resposta vem com `cf-mitigated: challenge` (desafio da zona: o smoke
 * não chegou ao Worker, então não pode dizer nada sobre ele). Erro de uso sai 2.
 *
 * READ-ONLY e sem credencial: toda requisição passa pelo `send` da paridade,
 * que recusa X-API-Key, Authorization e apikey.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadHeadersConfig, parseArgs, pool, sha256 } from "./lib.mjs";
import { COOKIE_CASES, SECURITY_HEADERS, mediaType, send as paritySend } from "./parity.mjs";

/** O `name` de cloudflare/wrangler.jsonc (o teste smoke.test.ts confere). */
export const WORKER_NAME = "torque-front";
export const OVERRIDE_HEADER = "cloudflare-workers-version-overrides";
export const ROBOTS_VALUE = "noindex, nofollow";
export const VERSION_HEADER = "x-torque-version";
export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, USAGE: 2, BLOQUEADO: 3 });
/** Prazos de uma rodada (ver o cabeçalho). */
export const LIMITS = Object.freeze({ requestMs: 10_000, attemptMs: 60_000 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const V5_COOKIE = { cookie: "torque_ui=v5" };
const CONCURRENCY = 6;

/**
 * @typedef {{ method: string, path: string, headers?: Record<string, string>, raw?: boolean, rawHeaders?: string[] }} SmokeRequest
 * @typedef {{ url: string, status: number, headers: Headers, body: Buffer }} SmokeResponse
 * @typedef {(base: string, testCase: SmokeRequest, options?: { timeoutMs?: number, attempts?: number, signal?: AbortSignal }) => Promise<SmokeResponse>} Send
 */

export class SmokeUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "SmokeUsageError";
  }
}

/**
 * Só a origem: https (http apenas em localhost, para o `cf:dev`), sem caminho,
 * query, fragmento ou credencial — o smoke monta cada caminho.
 */
export function parseSmokeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SmokeUsageError(`--url inválida: ${raw}`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new SmokeUsageError(`--url precisa ser https:// (http só em localhost): ${url.origin}`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SmokeUsageError(`--url é só a origem, sem caminho, query ou credencial: ${raw}`);
  }
  return url.origin;
}

export const isWorkersDev = (origin) => new URL(origin).hostname.endsWith(".workers.dev");

/** Valor do header de override: `torque-front="<uuid>"`. */
export function overrideValue(versionId, workerName = WORKER_NAME) {
  if (!UUID.test(versionId ?? "")) throw new SmokeUsageError(`--override precisa ser um version id (UUID): ${versionId}`);
  return `${workerName}="${versionId}"`;
}

/**
 * A versão que respondeu, conferida contra a esperada. `allowMissing`: a
 * versão esperada é anterior ao header (rollback para versão antiga), então
 * header ausente também serve — nenhuma versão com o header deixaria de mandá-lo.
 */
function versionProblems(response, { expectVersion, allowMissingVersion }) {
  if (!expectVersion) return [];
  const got = response.headers.get(VERSION_HEADER);
  if (got === null) return allowMissingVersion ? [] : [`sem X-Torque-Version (esperada ${expectVersion}): respondeu uma versão sem a prova de versão`];
  return got === expectVersion ? [] : [`versão ${got} respondeu (esperada ${expectVersion})`];
}

/** Os `/assets/*.js|css` que um index carrega de cara (script de entrada, modulepreload, CSS). */
export function assetEntries(html) {
  const found = new Set();
  for (const match of html.matchAll(/\b(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)) found.add(match[1]);
  return [...found].sort();
}

const looksLikeSourceMap = (body) => body.subarray(0, 64).toString("utf8").replace(/\s/g, "").startsWith('{"version":3');

// ── verificações sobre uma resposta ─────────────────────────────────────────

function expectStatus(response, status) {
  return response.status === status ? [] : [`status ${response.status} (esperado ${status})`];
}

function expectBody(response, expected, what) {
  return response.body.equals(expected) ? [] : [`corpo difere de ${what} (sha256 ${sha256(response.body).slice(0, 12)} ≠ ${sha256(expected).slice(0, 12)})`];
}

function expectHeader(response, name, value) {
  const got = response.headers.get(name);
  return got === value ? [] : [`${name}: ${JSON.stringify(got)} (esperado ${JSON.stringify(value)})`];
}

/** Uma política só: `Headers.get` junta valores repetidos com vírgula. */
function singleCsp(response) {
  const csp = response.headers.get("content-security-policy");
  if (csp === null) return ["sem Content-Security-Policy"];
  return csp.includes(",") ? ["CSP juntada (mais de uma política)"] : [];
}

/** Os headers do perfil app, com o valor exato de cloudflare/headers.json. */
function appProfile(response, profile) {
  return Object.entries(profile).flatMap(([name, value]) => expectHeader(response, name, value));
}

/**
 * Onde o Worker responde em `*.workers.dev`, o X-Robots-Tag é obrigatório.
 * `/assets/*` sai do servidor de assets, sem Worker — lá não se exige. No
 * domínio real, nenhuma resposta pode levá-lo (tiraria o site do Google).
 */
function robots(response, context, { servedByWorker }) {
  const got = response.headers.get("x-robots-tag");
  if (context.workersDev) {
    if (!servedByWorker) return [];
    return got === ROBOTS_VALUE ? [] : [`X-Robots-Tag ${JSON.stringify(got)} no workers.dev (esperado ${JSON.stringify(ROBOTS_VALUE)})`];
  }
  return got === null ? [] : [`X-Robots-Tag ${JSON.stringify(got)} no domínio real`];
}

// ── execução ────────────────────────────────────────────────────────────────

/**
 * Roda o smoke uma vez. Devolve `{ outcome, checks, blockedBy }`, com
 * `checks = [{ name, problems }]`. Nunca lança por resposta ruim: erro de rede
 * vira problema da verificação.
 *
 * `send` é a única saída de rede (o da paridade, por padrão); os testes o dublam.
 *
 * @param {{ url: string, assetsDir?: string, override?: string, expectVersion?: string, allowMissingVersion?: boolean,
 *   workerName?: string, send?: Send, headersConfig?: object, limits?: { requestMs: number, attemptMs: number } }} options
 */
export async function runSmoke({
  url,
  assetsDir,
  override,
  expectVersion = override,
  allowMissingVersion = false,
  workerName = WORKER_NAME,
  send = paritySend,
  headersConfig = loadHeadersConfig(),
  limits = LIMITS,
}) {
  const origin = parseSmokeUrl(url);
  const overrideHeaders = override ? { [OVERRIDE_HEADER]: overrideValue(override, workerName) } : {};
  if (expectVersion && !UUID.test(expectVersion)) throw new SmokeUsageError(`--expect-version precisa ser um version id (UUID): ${expectVersion}`);
  const version = { expectVersion, allowMissingVersion };
  const context = { workersDev: isWorkersDev(origin) };
  // Teto da rodada: o que estiver pendurado quando ele vence é cortado.
  const attemptSignal = AbortSignal.timeout(limits.attemptMs);
  const sendOptions = { timeoutMs: limits.requestMs, attempts: 1, signal: attemptSignal };
  const profile = headersConfig.profiles.app;
  const cache = headersConfig.cache;
  const checks = [];
  const blockedBy = new Set();

  const request = (testCase) => {
    const withOverride = testCase.raw
      ? { ...testCase, rawHeaders: [...(testCase.rawHeaders ?? []), ...Object.entries(overrideHeaders).flat()] }
      : { ...testCase, headers: { ...testCase.headers, ...overrideHeaders } };
    return send(origin, { method: "GET", headers: {}, ...withOverride }, sendOptions);
  };

  /** Uma verificação: faz a requisição, marca desafio da zona, junta os problemas. */
  const probe = async ({ name, testCase, verify }) => {
    try {
      const response = await request(testCase);
      if ((response.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge") {
        blockedBy.add(testCase.path);
        return { name, problems: ["desafio da zona (cf-mitigated: challenge)"], blocked: true, response };
      }
      return { name, problems: verify(response), response };
    } catch (error) {
      if (attemptSignal.aborted) return { name, problems: [`teto da rodada (${limits.attemptMs / 1000} s) estourado`] };
      return { name, problems: [`erro de rede: ${error instanceof Error ? error.message : String(error)}`] };
    }
  };

  // 1. Referências: os dois index (do disco ou do próprio host) e os service workers.
  const local = assetsDir
    ? Object.fromEntries(
        ["index.html", "index.classic.html", "sw.js", "sw.classic.js"].map((name) => [name, fs.readFileSync(path.join(assetsDir, name))]),
      )
    : null;
  const htmlRoute = (response) => [
    ...expectStatus(response, 200),
    ...(mediaType(response.headers.get("content-type")) === "text/html" ? [] : [`Content-Type ${response.headers.get("content-type")}`]),
    ...expectHeader(response, "cache-control", cache.noStore),
    ...singleCsp(response),
    ...appProfile(response, profile),
    ...robots(response, context, { servedByWorker: true }),
    ...versionProblems(response, version),
  ];
  const classicRef = await probe({
    name: "GET /index.classic.html",
    testCase: { path: "/index.classic.html" },
    verify: (r) => [...htmlRoute(r), ...(local ? expectBody(r, local["index.classic.html"], "index.classic.html") : [])],
  });
  const v5Ref = await probe({
    name: "GET /index.html [cookie: torque_ui=v5]",
    testCase: { path: "/index.html", headers: V5_COOKIE },
    verify: (r) => [...htmlRoute(r), ...(local ? expectBody(r, local["index.html"], "index.html") : [])],
  });
  checks.push(classicRef, v5Ref);

  const reference = {
    classic: local?.["index.classic.html"] ?? classicRef.response?.body,
    v5: local?.["index.html"] ?? v5Ref.response?.body,
  };
  if (!reference.classic || !reference.v5 || classicRef.problems.length > 0 || v5Ref.problems.length > 0) {
    // Sem os dois index (ou com eles vindos de outra versão) não há contra o
    // que comparar o resto; a próxima rodada tenta de novo.
    return finish(checks, blockedBy);
  }
  if (reference.classic.equals(reference.v5)) {
    checks.push({ name: "V5 ≠ clássica", problems: ["index.html e index.classic.html são iguais: o cookie não troca de interface"] });
  }

  // 2. O resto, em paralelo.
  const probes = [];
  const uiBody = { v5: reference.v5, classic: reference.classic };

  for (const { cookie, worker } of COOKIE_CASES) {
    probes.push({
      name: `GET / [cookie: ${cookie ?? "(nenhum)"}] → ${worker}`,
      testCase: { path: "/", headers: cookie ? { cookie } : {} },
      verify: (r) => [...htmlRoute(r), ...expectBody(r, uiBody[worker], `index da ${worker}`)],
    });
  }

  probes.push({
    name: "GET /leads (rota do SPA) → clássica",
    testCase: { path: "/leads" },
    verify: (r) => [...htmlRoute(r), ...expectBody(r, reference.classic, "index da clássica")],
  });

  const jsRoute = (r) => [
    ...expectStatus(r, 200),
    ...(mediaType(r.headers.get("content-type")) === "text/javascript" ? [] : [`Content-Type ${r.headers.get("content-type")}`]),
    ...expectHeader(r, "cache-control", cache.noStore),
    ...singleCsp(r),
    ...appProfile(r, profile),
    ...robots(r, context, { servedByWorker: true }),
    ...versionProblems(r, version),
  ];
  const swClassic = await probe({
    name: "GET /sw.classic.js",
    testCase: { path: "/sw.classic.js" },
    verify: (r) => [...jsRoute(r), ...(local ? expectBody(r, local["sw.classic.js"], "sw.classic.js") : [])],
  });
  checks.push(swClassic);
  const swClassicBody = local?.["sw.classic.js"] ?? (swClassic.problems.length === 0 ? swClassic.response.body : null);
  probes.push({
    name: "GET /sw.js (sem cookie) → sw da clássica",
    testCase: { path: "/sw.js" },
    verify: (r) => [...jsRoute(r), ...(swClassicBody ? expectBody(r, swClassicBody, "sw.classic.js") : ["sem referência do sw.classic.js"])],
  });
  probes.push({
    name: "GET /sw.js [cookie: torque_ui=v5] → sw da V5",
    testCase: { path: "/sw.js", headers: V5_COOKIE },
    verify: (r) => [
      ...jsRoute(r),
      ...(local
        ? expectBody(r, local["sw.js"], "sw.js")
        : swClassicBody && r.body.equals(swClassicBody)
          ? ["serviu o sw da clássica com o cookie da V5"]
          : []),
    ],
  });

  const entries = [...new Set([...assetEntries(reference.v5.toString("utf8")), ...assetEntries(reference.classic.toString("utf8"))])].sort();
  if (entries.length === 0) checks.push({ name: "chunks de entrada", problems: ["nenhum /assets/* citado pelos index"] });
  for (const entry of entries) {
    const file = assetsDir ? path.join(assetsDir, ...entry.slice(1).split("/")) : null;
    const expected = file && fs.existsSync(file) ? fs.readFileSync(file) : null;
    probes.push({
      name: `GET ${entry}`,
      testCase: { path: entry },
      verify: (r) => [
        ...expectStatus(r, 200),
        ...(r.body.length === 0 ? ["corpo vazio"] : []),
        ...(file && !expected ? [`${entry} não existe em ${assetsDir}`] : []),
        ...(expected ? expectBody(r, expected, entry.slice(1)) : []),
        ...expectHeader(r, "cache-control", cache.immutable),
        ...singleCsp(r),
        ...appProfile(r, profile),
        ...robots(r, context, { servedByWorker: false }),
      ],
    });
  }
  // O map do script de entrada de cada interface (o maior e o mais óbvio de pedir).
  const scripts = entries.filter((e) => e.endsWith(".js"));
  const entryScripts = scripts.filter((e) => e.startsWith("/assets/index-"));
  for (const entry of entryScripts.length > 0 ? entryScripts : scripts.slice(0, 2)) {
    probes.push({
      name: `GET ${entry}.map → 404`,
      testCase: { path: `${entry}.map` },
      verify: (r) => [...expectStatus(r, 404), ...(looksLikeSourceMap(r.body) ? ["devolveu source map"] : [])],
    });
  }

  probes.push({
    name: "GET /api/v1/leads sem Accept-Encoding → 401 JSON",
    // raw: node:http, sem o Accept-Encoding que o fetch acrescenta.
    testCase: { path: "/api/v1/leads", raw: true },
    verify: (r) => {
      const problems = [...expectStatus(r, 401), ...singleCsp(r), ...robots(r, context, { servedByWorker: true }), ...versionProblems(r, version)];
      if (r.headers.get("content-encoding")) problems.push(`Content-Encoding ${r.headers.get("content-encoding")} sem o cliente pedir`);
      if (mediaType(r.headers.get("content-type")) !== "application/json") problems.push(`Content-Type ${r.headers.get("content-type")}`);
      for (const name of SECURITY_HEADERS) if (!r.headers.has(name)) problems.push(`sem ${name}`);
      try {
        const error = JSON.parse(r.body.toString("utf8"))?.error;
        if (typeof error?.code !== "string" || typeof error?.message !== "string") problems.push("corpo fora do envelope {\"error\":{\"code\",\"message\"}}");
      } catch {
        problems.push(`corpo não é JSON legível (${r.body.subarray(0, 4).toString("hex")}…)`);
      }
      return problems;
    },
  });

  checks.push(...(await pool(probes, CONCURRENCY, probe)));
  return finish(checks, blockedBy);
}

function finish(checks, blockedBy) {
  const clean = checks.map(({ name, problems, blocked }) => ({ name, problems, ...(blocked ? { blocked } : {}) }));
  const outcome = blockedBy.size > 0 ? "BLOQUEADO" : clean.some((c) => c.problems.length > 0) ? "FAIL" : "PASS";
  return { outcome, checks: clean, blockedBy: [...blockedBy].sort() };
}

/**
 * Repete o smoke enquanto der FAIL, até `retryForMs` (a propagação de uma
 * versão nova leva segundos). BLOQUEADO não é propagação: volta na hora.
 * Nenhuma rodada começa depois do prazo; cada uma tem o teto de LIMITS.attemptMs.
 */
export async function smokeUntilPass(options, { retryForMs = 0, intervalMs = 10_000, run = runSmoke, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {} } = {}) {
  const deadline = now() + retryForMs;
  for (let attempt = 1; ; attempt++) {
    const result = await run(options);
    if (result.outcome !== "FAIL" || now() + intervalMs > deadline) return { ...result, attempts: attempt };
    const failed = result.checks.filter((c) => c.problems.length > 0).length;
    log(`smoke: FAIL na tentativa ${attempt} (${failed} verificações); nova tentativa em ${Math.round(intervalMs / 1000)} s`);
    await sleep(intervalMs);
  }
}

/** Linhas legíveis do resultado; só as falhas, a não ser com `verbose`. */
export function formatSmoke(result, { verbose = false } = {}) {
  const lines = [];
  for (const check of result.checks) {
    const status = check.blocked ? "BLOQUEADO" : check.problems.length > 0 ? "FAIL" : "PASS";
    if (status === "PASS" && !verbose) continue;
    lines.push(`${status.padEnd(10)} ${check.name}`);
    for (const problem of check.problems) lines.push(`           ↳ ${problem}`);
  }
  const failed = result.checks.filter((c) => c.problems.length > 0).length;
  const attempts = result.attempts && result.attempts > 1 ? ` em ${result.attempts} tentativas` : "";
  lines.push(`SMOKE ${result.outcome} — ${result.checks.length} verificações, ${failed} com problema${attempts}`);
  return lines;
}

function parseCliArgs(argv) {
  try {
    return parseArgs(argv, {
      url: "string",
      assets: "string",
      override: "string",
      "expect-version": "string",
      "allow-missing-version": "boolean",
      "retry-for": "number",
      verbose: "boolean",
    });
  } catch (error) {
    throw new SmokeUsageError(error.message);
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.url) throw new SmokeUsageError("uso: --url <origem> [--assets <dir>] [--override <version-id>] [--expect-version <version-id>] [--retry-for <s>] [--verbose]");
  const retryFor = args["retry-for"] ?? 0;
  if (!Number.isFinite(retryFor) || retryFor < 0 || retryFor > 900) throw new SmokeUsageError("--retry-for entre 0 e 900 segundos");
  const options = {
    url: args.url,
    assetsDir: args.assets ? path.resolve(args.assets) : undefined,
    override: args.override,
    expectVersion: args["expect-version"] ?? args.override,
    allowMissingVersion: args["allow-missing-version"] === true,
  };
  parseSmokeUrl(options.url);
  if (options.override) overrideValue(options.override);
  if (options.expectVersion && !UUID.test(options.expectVersion)) throw new SmokeUsageError(`--expect-version precisa ser um version id (UUID): ${options.expectVersion}`);

  const mode = options.assetsDir ? `assets=${path.relative(process.cwd(), options.assetsDir) || options.assetsDir}` : "autoconsistente";
  const extra = `${options.override ? `  override=${options.override}` : ""}${options.expectVersion ? `  versão=${options.expectVersion}` : ""}`;
  console.log(`smoke  ${parseSmokeUrl(options.url)}  ${mode}${extra}`);
  const result = await smokeUntilPass(options, { retryForMs: retryFor * 1000, log: (line) => console.log(line) });
  for (const line of formatSmoke(result, { verbose: args.verbose === true })) console.log(line);
  process.exit(EXIT[result.outcome]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(error instanceof SmokeUsageError ? EXIT.USAGE : EXIT.FAIL);
  });
}
