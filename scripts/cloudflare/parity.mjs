#!/usr/bin/env node
/**
 * Paridade do front: compara dois hosts servindo o MESMO artefato, URL a URL.
 *
 *   node scripts/cloudflare/parity.mjs --a https://torquecrm.com.br \
 *     --b http://localhost:8787 --assets cloudflare/.assets [--all-assets] \
 *     [--concurrency 6] [--verbose]
 *
 * A = referência (nginx de produção). B = candidato (Worker). Cada caso sai como
 *   PASS           — igual em tudo o que é comparado;
 *   EXPECTED-DIFF  — difere só onde uma divergência declarada (Div1–Div12) permite;
 *   FAIL           — qualquer outra diferença, ou uma invariante de B quebrada.
 * Sai com código 1 se houver FAIL, 2 se a verificação inicial abortar.
 *
 * O que se compara (lista FECHADA; o resto — Date, ETag, Server, cf-ray… — fica de fora):
 *   - status, exato;
 *   - Content-Type, só o media type (text/javascript ≡ application/javascript),
 *     quando A responde 2xx ou na API: página de erro do nginx não é contrato;
 *   - Cache-Control e os headers de segurança do app (os de cloudflare/headers.json);
 *   - Location, por caminho + query;
 *   - Access-Control-* na API;
 *   - corpo: sha256 do corpo decodificado nos 2xx estáticos, JSON na API.
 * Invariantes de B, independentes de A: uma CSP só (vírgula = duas políticas
 * juntas = FAIL); Location relativo ou da própria origem; nenhuma URL *.map
 * devolve source map; _headers e .assetsignore nunca saem crus; em
 * *.workers.dev, X-Robots-Tag presente onde o Worker responde (`/assets/*` sai
 * direto do servidor de assets, sem Worker e sem o header — JS/CSS indexado é
 * inofensivo, e pôr o header no `_headers` o levaria para o domínio real).
 *
 * Casos "raw" vão por node:http(s), sem nada que o fetch acrescenta: sem
 * Accept-Encoding (o cliente que não pediu compressão tem de receber corpo
 * legível) e com headers Cookie repetidos (cookie em pedaços, como no HTTP/2).
 *
 * READ-ONLY contra A: só GET/HEAD/OPTIONS, mais POSTs que o nginx recusa sem
 * encostar no Supabase (405 em arquivo estático; 413 na API, com 1,1 MB e SEM
 * chave). Nunca manda X-API-Key, Authorization ou apikey — o `send` recusa.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodePath, listFiles, loadHeadersConfig, parseArgs, pool, sha256 } from "./lib.mjs";

export { sha256 };

const HEADERS_CONFIG = loadHeadersConfig();

/** Os headers de segurança do app, da fonte única (cloudflare/headers.json). */
export const SECURITY_HEADERS = Object.keys(HEADERS_CONFIG.profiles.app).map((name) => name.toLowerCase());

/** Variantes do cookie torque_ui medidas em prod (fonte única com routing.test.ts). */
export const COOKIE_CASES = JSON.parse(fs.readFileSync(new URL("./cookie-cases.json", import.meta.url), "utf8")).cases;

export const DIVS = {
  Div1: "/.well-known/security.txt passa a dar 200 (prod: 404 por efeito colateral do bloqueio de dotfile)",
  Div2: "pasta sem index em /lp/ dá 404 em vez de 403 (403 revela que a pasta existe)",
  Div3: "/landing/, /api/, /landing, /api caem no index do SPA (prod: 301 → 403)",
  Div4: "redirect de pasta com Location relativo (prod manda http://…:8080/…, link quebrado)",
  Div5: "erro gerado pelo Worker leva no-store (prod: immutable/600 s/nenhum)",
  Div6: "Content-Type do manifest.webmanifest: application/manifest+json (prod: octet-stream)",
  Div7: "compressão da Cloudflare; Content-Encoding/Length/Vary fora da comparação, corpo decodificado",
  Div8: "X-Robots-Tag: noindex, nofollow no *.workers.dev, onde o Worker responde",
  Div9: "API: headers de segurança só se faltarem (prod sai com eles duplicados: upstream + nginx)",
  Div10: "erro gerado pelo proxy da API (413/502/504) em JSON no envelope da API, em vez de HTML do nginx",
  Div11: "/assets/* sem arquivo é 404 do servidor de assets (com o _headers), para qualquer extensão; prod devolve o index do SPA quando a extensão não está na regex do nginx",
  Div12: "cookie: `,` também separa pares (o workerd junta headers Cookie repetidos com `, `; o nginx lê cada um); `a=1,torque_ui=v5` num header só dá V5 (prod: clássica)",
};

const JS_TYPES = new Set(["application/javascript", "application/x-javascript", "text/javascript"]);
const FORBIDDEN_REQUEST_HEADERS = ["x-api-key", "authorization", "apikey"];
const API_BODY_LIMIT = 1024 * 1024;

// ── utilidades ──────────────────────────────────────────────────────────────

export function mediaType(value) {
  if (!value) return null;
  const type = value.split(";")[0].trim().toLowerCase();
  return JS_TYPES.has(type) ? "text/javascript" : type;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function locationParts(raw, requestUrl) {
  if (raw === null) return null;
  const resolved = new URL(raw, requestUrl);
  return {
    pathQuery: `${resolved.pathname}${resolved.search}`,
    relative: raw.startsWith("/") && !raw.startsWith("//"),
    origin: resolved.origin,
  };
}

const is2xx = (status) => status >= 200 && status < 300;

/** O `run_worker_first` manda `/assets/*` (caminho cru, com maiúscula) direto ao servidor de assets. */
export const servedByAssetServer = (testPath) => new URL(testPath, "http://parity.invalid").pathname.startsWith("/assets/");

// ── HTTP ────────────────────────────────────────────────────────────────────

/**
 * Única saída de rede do script. Recusa credencial e qualquer POST que não
 * seja um dos dois tipos que o nginx rejeita antes de chegar ao Supabase.
 */
export async function send(base, testCase) {
  const headers = { "user-agent": "torque-parity/1.0", ...testCase.headers };
  const rawNames = (testCase.rawHeaders ?? []).filter((_, index) => index % 2 === 0);
  for (const name of [...Object.keys(headers), ...rawNames]) {
    if (FORBIDDEN_REQUEST_HEADERS.includes(name.toLowerCase())) {
      throw new Error(`parity nunca manda ${name}`);
    }
  }
  const method = testCase.method;
  if (testCase.raw) {
    if (method !== "GET") throw new Error("caso raw só com GET");
    return rawGet(base, testCase.path, ["user-agent", "torque-parity/1.0", ...(testCase.rawHeaders ?? [])]);
  }
  if (!["GET", "HEAD", "OPTIONS", "POST"].includes(method)) throw new Error(`método recusado: ${method}`);
  if (method === "POST") {
    const isApi = testCase.path.startsWith("/api/v1/");
    if (isApi && !(testCase.body && testCase.body.byteLength > API_BODY_LIMIT)) {
      throw new Error("POST na API só com corpo acima de 1 MiB (o proxy recusa com 413 antes do Supabase)");
    }
    if (!isApi && testCase.body) throw new Error("POST estático vai sem corpo");
  }

  const url = new URL(testCase.path, base).toString();
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: testCase.body,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const body = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
      return { url, status: response.status, headers: response.headers, body };
    } catch (error) {
      lastError = error;
      if (method === "POST") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

/**
 * GET por node:http(s): só os headers dados (mais Host), nada de
 * Accept-Encoding automático, headers repetidos preservados, corpo como veio.
 */
function rawGet(base, testPath, rawHeaders) {
  const url = new URL(testPath, base);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, { method: "GET", headers: ["host", url.host, ...rawHeaders], timeout: 30_000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        resolve({ url: url.toString(), status: response.statusCode, headers, body: Buffer.concat(chunks) });
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

// ── comparação ──────────────────────────────────────────────────────────────

/**
 * Compara A e B. Devolve { outcome, divs, problems }.
 * `testCase.allow` mapeia campo → Div que autoriza a diferença naquele campo
 * ("status", "content-type", "cache-control", "location", "body", "security").
 */
export function compare(testCase, a, b, context) {
  const allow = testCase.allow ?? {};
  const divs = new Set();
  const problems = [];

  const diff = (field, va, vb, allowKey = field) => {
    const div = allow[allowKey];
    if (div) divs.add(div);
    else problems.push(`${field}: A=${JSON.stringify(va)} B=${JSON.stringify(vb)}`);
  };

  if (a.status !== b.status) diff("status", a.status, b.status);

  if (testCase.api || is2xx(a.status)) {
    const ta = mediaType(a.headers.get("content-type"));
    const tb = mediaType(b.headers.get("content-type"));
    if (ta !== tb) diff("content-type", ta, tb);
  }

  const ca = a.headers.get("cache-control");
  const cb = b.headers.get("cache-control");
  if (ca !== cb) diff("cache-control", ca, cb);

  for (const name of SECURITY_HEADERS) {
    const va = a.headers.get(name);
    const vb = b.headers.get(name);
    if (va === vb) continue;
    // Div9: na API, o prod repete o header (upstream, depois nginx); B fica só com o do upstream.
    if (testCase.api && va !== null && vb !== null && va.startsWith(`${vb}, `)) divs.add("Div9");
    else diff(name, va, vb, "security");
  }

  const la = locationParts(a.headers.get("location"), a.url);
  const lb = locationParts(b.headers.get("location"), b.url);
  if ((la === null) !== (lb === null) || (la && lb && la.pathQuery !== lb.pathQuery)) {
    diff("location", la?.pathQuery ?? null, lb?.pathQuery ?? null);
  } else if (la && lb && la.origin !== new URL(a.url).origin && lb.relative) {
    divs.add("Div4");
  }

  if (testCase.api) {
    const names = new Set();
    for (const [name] of a.headers) if (name.startsWith("access-control-")) names.add(name);
    for (const [name] of b.headers) if (name.startsWith("access-control-")) names.add(name);
    for (const name of names) {
      if (a.headers.get(name) !== b.headers.get(name)) diff(name, a.headers.get(name), b.headers.get(name));
    }
  }

  if (testCase.method !== "HEAD" && is2xx(a.status) && is2xx(b.status) && !testCase.api) {
    if (sha256(a.body) !== sha256(b.body)) diff("body", `sha256:${sha256(a.body).slice(0, 12)}`, `sha256:${sha256(b.body).slice(0, 12)}`);
  }
  if (testCase.api && testCase.method !== "HEAD") {
    const jsonA = mediaType(a.headers.get("content-type")) === "application/json";
    const jsonB = mediaType(b.headers.get("content-type")) === "application/json";
    if (jsonA && jsonB) {
      let left;
      let right;
      try {
        left = canonicalJson(JSON.parse(a.body.toString("utf8")));
        right = canonicalJson(JSON.parse(b.body.toString("utf8")));
      } catch {
        left = sha256(a.body);
        right = sha256(b.body);
      }
      if (left !== right) diff("body", left.slice(0, 120), right.slice(0, 120));
    }
  }

  // Div7: informativo — os dois lados comprimem diferente, o corpo decodificado já foi comparado.
  if ((a.headers.get("content-encoding") ?? "") !== (b.headers.get("content-encoding") ?? "")) divs.add("Div7");

  // ── invariantes de B ──
  const csp = b.headers.get("content-security-policy");
  if (csp !== null && csp.includes(",")) problems.push("B: CSP juntada (mais de uma política)");

  if (lb && !lb.relative && lb.origin !== new URL(b.url).origin) problems.push(`B: Location para outra origem (${lb.origin})`);

  if (context.robots && !servedByAssetServer(testCase.path)) {
    if (b.headers.get("x-robots-tag") !== "noindex, nofollow") problems.push("B: X-Robots-Tag ausente no workers.dev");
    else if (a.headers.get("x-robots-tag") === null) divs.add("Div8");
  }

  for (const check of testCase.checks ?? []) {
    const problem = check(b, context);
    if (problem) problems.push(`B: ${problem}`);
  }

  const outcome = problems.length > 0 ? "FAIL" : divs.size > 0 && [...divs].some((d) => d !== "Div7") ? "EXPECTED-DIFF" : "PASS";
  return { outcome, divs: [...divs].sort(), problems };
}

// ── matriz ──────────────────────────────────────────────────────────────────

const noSourceMap = (b) => (b.body.subarray(0, 16).toString("utf8").replace(/\s/g, "").startsWith('{"version":3') ? "devolveu source map" : null);

export function buildMatrix({ assetsDir, allAssets, headersConfig = HEADERS_CONFIG }) {
  const cases = [];
  const add = (testCase) => cases.push({ method: "GET", headers: {}, ...testCase });
  const withCookie = (cookie) => (cookie ? { cookie } : {});

  // 1. `/` com as variantes de cookie medidas (D-6 + fronteiras do parser), de cookie-cases.json.
  const localIndex = { v5: fs.readFileSync(path.join(assetsDir, "index.html")), classic: fs.readFileSync(path.join(assetsDir, "index.classic.html")) };
  const servesUi = (ui) => (b) => (b.body.equals(localIndex[ui]) ? null : `não serviu a interface ${ui}`);
  for (const { cookie, worker, div } of COOKIE_CASES) {
    add({
      path: "/",
      headers: withCookie(cookie),
      label: `cookie: ${cookie ?? "(nenhum)"}`,
      allow: div ? { body: div } : undefined,
      checks: [servesUi(worker)],
    });
  }
  // Cookie em pedaços: dois headers Cookie, nas duas ordens (HTTP/2 manda assim).
  for (const parts of [["a=1", "torque_ui=v5"], ["torque_ui=v5", "a=1"]]) {
    add({
      path: "/",
      raw: true,
      rawHeaders: parts.flatMap((part) => ["cookie", part]),
      label: `raw: Cookie: ${parts[0]} + Cookie: ${parts[1]}`,
      checks: [servesUi("v5")],
    });
  }

  // 2–3. index/sw diretos e deep links, sem cookie e com V5.
  for (const p of ["/index.html", "/sw.js", "/index.classic.html", "/sw.classic.js", "/leads", "/leads/", "/configuracoes/usuarios?x=1"]) {
    for (const cookie of [null, "torque_ui=v5"]) add({ path: p, headers: withCookie(cookie), label: cookie ? "cookie: v5" : "" });
  }

  // 4. Páginas institucionais.
  for (const p of ["/sobre", "/sobre.html", "/sobre/", "/privacidade"]) add({ path: p });

  // 5. Arquivos da raiz.
  for (const p of [
    "/robots.txt",
    "/favicon.png",
    "/favicon.svg",
    "/lamejs.min.js",
    "/api/openapi.json",
    "/api/llms.txt",
    "/products_import_template.xlsx",
    "/landing/Paleta%20de%20Cor_Milennials.png",
  ]) {
    add({ path: p });
  }
  add({ path: "/manifest.webmanifest", allow: { "content-type": "Div6" } });

  // 6. Métodos.
  const chunks = listFiles(path.join(assetsDir, "assets")).filter((f) => f.endsWith(".js"));
  const chunk = `/assets/${chunks.find((f) => f.startsWith("index-")) ?? chunks[0]}`;
  add({ method: "HEAD", path: "/" });
  add({ method: "HEAD", path: chunk });
  add({ method: "POST", path: "/" });
  add({ method: "POST", path: chunk });
  add({ method: "OPTIONS", path: "/leads" });

  // 7. Landing pages: cada arquivo de cada uma, mais as pastas.
  const lpRoot = path.join(assetsDir, "lp");
  for (const name of fs.readdirSync(lpRoot).sort()) {
    add({ path: `/lp/${name}/` });
    for (const rel of listFiles(path.join(lpRoot, name))) add({ path: encodePath(`lp/${name}/${rel}`) });
  }
  add({ path: "/lp/v1" });
  add({ path: "/lp/v1?ref=parity" });
  add({ path: "/lp/", allow: { status: "Div2", "cache-control": "Div5" } });
  add({ path: "/lp/nao-existe", allow: { "cache-control": "Div5" } });

  // 9. /assets/* sem arquivo.
  add({ path: "/assets/nao-existe.js" });
  add({ path: "/assets/x.json", allow: { status: "Div11", "content-type": "Div11", "cache-control": "Div11" } });
  add({ path: "/assets/", allow: { status: "Div11", "cache-control": "Div11" } });

  // 10. Source maps.
  for (const p of [`${chunk}.map`, "/sw.js.map", "/sw.classic.js.map"]) add({ path: p, checks: [noSourceMap] });

  // 11. Dotfiles e configuração do servidor de assets.
  const generatedHeaders = fs.readFileSync(path.join(assetsDir, "_headers"));
  const generatedIgnore = fs.readFileSync(path.join(assetsDir, ".assetsignore"));
  const notRaw = (raw, name) => (b) => (b.body.length > 0 && b.body.equals(raw) ? `${name} servido cru` : null);
  add({ path: "/.env", allow: { "cache-control": "Div5" } });
  add({ path: "/.git/config", allow: { "cache-control": "Div5" } });
  add({ path: "/.well-known/security.txt", allow: { status: "Div1", "cache-control": "Div1", "content-type": "Div1" } });
  add({ path: "/_headers", checks: [notRaw(generatedHeaders, "_headers")] });
  add({ path: "/.assetsignore", allow: { "cache-control": "Div5" }, checks: [notRaw(generatedIgnore, ".assetsignore")] });

  // 12. Página de erro do nginx, que está na build.
  add({ path: "/50x.html" });

  // 13. Pastas fora de /lp/.
  for (const p of ["/api/", "/landing/", "/landing", "/api"]) {
    add({ path: p, allow: { status: "Div3", "content-type": "Div3", location: "Div3" } });
  }

  // 14. API pública (sem chave, sempre).
  add({ path: "/api/v1/", api: true });
  add({ path: "/api/v1/leads", api: true });
  // Cliente sem Accept-Encoding (curl sem --compressed): corpo legível, como o nginx entrega.
  add({
    path: "/api/v1/leads",
    api: true,
    raw: true,
    label: "raw: sem Accept-Encoding",
    checks: [
      (b) => (b.headers.get("content-encoding") ? `Content-Encoding ${b.headers.get("content-encoding")} sem o cliente pedir` : null),
      (b) => {
        try {
          JSON.parse(b.body.toString("utf8"));
          return null;
        } catch {
          return `corpo não é JSON legível (${b.body.subarray(0, 4).toString("hex")}…)`;
        }
      },
    ],
  });
  add({ path: "/api/v1", allow: { "cache-control": "Div5" } });
  add({
    method: "OPTIONS",
    path: "/api/v1/leads",
    api: true,
    headers: {
      origin: "https://torquecrm.com.br",
      "access-control-request-method": "GET",
      "access-control-request-headers": "x-api-key, content-type",
    },
  });
  add({
    method: "POST",
    path: "/api/v1/leads",
    api: true,
    label: "1,1 MB sem chave",
    headers: { "content-type": "application/json" },
    body: Buffer.alloc(Math.round(1.1 * 1024 * 1024), 0x20),
    allow: { "content-type": "Div10", "cache-control": "Div10" },
  });

  // 8. Todos os arquivos de .assets/assets/**.
  if (allAssets) {
    const immutable = headersConfig.cache.immutable;
    const app = headersConfig.profiles.app;
    for (const rel of listFiles(path.join(assetsDir, "assets"))) {
      const local = sha256(fs.readFileSync(path.join(assetsDir, "assets", rel)));
      add({
        path: encodePath(`assets/${rel}`),
        group: "all-assets",
        checks: [
          (b) => (b.status === 200 ? null : `status ${b.status}`),
          (b) => (sha256(b.body) === local ? null : "corpo difere do arquivo local"),
          (b) => (b.headers.get("cache-control") === immutable ? null : `cache-control ${b.headers.get("cache-control")}`),
          (b) => {
            const wrong = Object.entries(app).filter(([name, value]) => b.headers.get(name) !== value);
            return wrong.length === 0 ? null : `headers do app divergentes: ${wrong.map(([n]) => n).join(", ")}`;
          },
        ],
      });
    }
  }

  return cases;
}

// ── execução ────────────────────────────────────────────────────────────────

/** R1: se o prod redeployou, o artefato local não é mais o dele — tudo daria FAIL. */
async function preflight(base, assetsDir, who) {
  const checks = [
    { path: "/index.html", headers: { cookie: "torque_ui=v5" }, local: "index.html" },
    { path: "/index.classic.html", headers: {}, local: "index.classic.html" },
  ];
  const problems = [];
  for (const check of checks) {
    const response = await send(base, { method: "GET", path: check.path, headers: check.headers });
    const expected = sha256(fs.readFileSync(path.join(assetsDir, check.local)));
    if (response.status !== 200 || sha256(response.body) !== expected) problems.push(`${who} ${check.path}`);
  }
  return problems;
}

function parseCliArgs(argv) {
  const args = {
    concurrency: 6,
    ...parseArgs(argv, { a: "string", b: "string", assets: "string", concurrency: "number", "all-assets": "boolean", verbose: "boolean" }),
  };
  args.allAssets = args["all-assets"] === true;
  if (!args.a || !args.b || !args.assets) throw new Error("uso: --a <url> --b <url> --assets <dir> [--all-assets]");
  // Gentileza com o prod: no máximo 8 casos ao mesmo tempo (cada caso = 1 requisição em A).
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) args.concurrency = 6;
  args.concurrency = Math.min(args.concurrency, 8);
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const assetsDir = path.resolve(args.assets);
  const context = { robots: new URL(args.b).hostname.endsWith(".workers.dev") };

  console.log(`paridade  A=${args.a}  B=${args.b}  assets=${path.relative(process.cwd(), assetsDir) || assetsDir}`);

  const stale = await preflight(args.a, assetsDir, "A");
  if (stale.length > 0) {
    console.error(`ABORTADO: prod redeployou, re-extraia o artefato (${stale.join(", ")} difere de ${args.assets}).`);
    process.exit(2);
  }
  const notServing = await preflight(args.b, assetsDir, "B");
  if (notServing.length > 0) {
    console.error(`ABORTADO: B não serve ${args.assets} (${notServing.join(", ")}). Rode cf:prepare e reinicie o cf:dev, ou refaça o cf:deploy.`);
    process.exit(2);
  }
  console.log("verificação inicial: A e B servem o artefato local (index.html e index.classic.html)\n");

  const cases = buildMatrix({ assetsDir, allAssets: args.allAssets });
  const results = await pool(cases, args.concurrency, async (testCase) => {
    try {
      const [a, b] = await Promise.all([send(args.a, testCase), send(args.b, testCase)]);
      return { testCase, ...compare(testCase, a, b, context), a, b };
    } catch (error) {
      return { testCase, outcome: "FAIL", divs: [], problems: [`erro de rede: ${error.message}`] };
    }
  });

  const counts = { PASS: 0, "EXPECTED-DIFF": 0, FAIL: 0 };
  const divCounts = {};
  let assetsChecked = 0;
  let assetsPassed = 0;
  for (const result of results) {
    counts[result.outcome] += 1;
    for (const div of result.divs) divCounts[div] = (divCounts[div] ?? 0) + 1;
    const { testCase } = result;
    if (testCase.group === "all-assets") {
      assetsChecked += 1;
      if (result.outcome === "PASS") assetsPassed += 1;
    }
    const quiet = testCase.group === "all-assets" && result.outcome === "PASS" && !args.verbose;
    if (quiet) continue;
    const name = `${testCase.method.padEnd(7)} ${testCase.path}${testCase.label ? `  [${testCase.label}]` : ""}`;
    const status = result.a && result.b ? `  ${result.a.status}→${result.b.status}` : "";
    const divs = result.divs.length > 0 ? `  ${result.divs.join(",")}` : "";
    console.log(`${result.outcome.padEnd(14)} ${name}${status}${divs}`);
    for (const problem of result.problems) console.log(`               ↳ ${problem}`);
  }

  if (args.allAssets) {
    const total = listFiles(path.join(assetsDir, "assets")).length;
    console.log(`\nall-assets: ${assetsChecked}/${total} arquivos de assets/** conferidos; ${assetsPassed} PASS`);
  }
  console.log("\nDivergências declaradas que apareceram:");
  for (const [div, n] of Object.entries(divCounts).sort(([x], [y]) => Number(x.slice(3)) - Number(y.slice(3)))) {
    console.log(`  ${div.padEnd(5)} ×${String(n).padEnd(4)} ${DIVS[div]}`);
  }
  console.log(`\nTOTAL ${results.length} casos — PASS ${counts.PASS} · EXPECTED-DIFF ${counts["EXPECTED-DIFF"]} · FAIL ${counts.FAIL}`);
  process.exit(counts.FAIL > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
