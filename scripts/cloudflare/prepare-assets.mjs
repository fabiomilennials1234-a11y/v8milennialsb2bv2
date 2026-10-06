#!/usr/bin/env node
/**
 * Prepara o diretório que o wrangler publica (`cloudflare/.assets/`) a partir
 * de uma build dual já pronta (`npm run build:dual` → dist/, ou o conteúdo de
 * /usr/share/nginx/html da imagem de produção).
 *
 *   node scripts/cloudflare/prepare-assets.mjs --from <dir>
 *
 * `--from` é obrigatório e não tem padrão: publicar a build errada é pior do
 * que não publicar nada.
 *
 * O que faz, nesta ordem:
 *   1. Exige a build dual (index.html, index.classic.html, sw.js, sw.classic.js).
 *   2. Varre a origem e FALHA em: arquivo de segredo pelo nome (.env*, *.pem,
 *      *.key, .git, .dev.vars*, .npmrc), dotfile fora de .well-known/ (o
 *      .DS_Store do Finder só é deixado para trás),
 *      configuração do servidor de assets (_headers, _redirects, _worker.js,
 *      .assetsignore), link simbólico, arquivo acima de 25 MiB, chave privada
 *      (PEM ou PGP), `sb_secret_`, JWT com `"role":"service_role"`, token com
 *      prefixo conhecido (Sentry, Stripe, GitHub, OpenAI, Anthropic), source map
 *      com outro nome ou embutido (sourceMappingURL=data:).
 *   3. Copia a árvore para cloudflare/.assets/ (limpa antes — só aceita destino
 *      oculto dentro de cloudflare/), sem os `*.map` —
 *      como o Dockerfile faz com a imagem do nginx.
 *   4. Gera `_headers` (uma regra só, /assets/*) a partir de cloudflare/headers.json
 *      e `.assetsignore`.
 *   5. Confere a saída: nenhum .map, build dual presente.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLOUDFLARE_DIR, assertSafeOutDir, loadHeadersConfig, parseArgs, sha256 } from "./lib.mjs";

export { loadHeadersConfig };
export const DEFAULT_OUT = path.join(CLOUDFLARE_DIR, ".assets");

export const REQUIRED_FILES = ["index.html", "index.classic.html", "sw.js", "sw.classic.js"];

/** Limite do Workers Static Assets por arquivo (o próprio wrangler recusa acima). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Limite de arquivos por versão no plano Free. */
export const MAX_FILES = 20_000;
/** Limite do `_headers` (developers.cloudflare.com/workers/static-assets/headers). */
export const MAX_HEADER_LINE = 2000;

const SECRET_NAMES = [
  { test: (name) => /^\.env/i.test(name), why: "arquivo .env" },
  { test: (name) => /\.pem$/i.test(name), why: "chave/certificado .pem" },
  { test: (name) => /\.key$/i.test(name), why: "chave .key" },
  { test: (name) => name === ".git", why: "repositório .git" },
  { test: (name) => /^\.dev\.vars/i.test(name), why: "segredos locais do wrangler (.dev.vars)" },
  { test: (name) => name === ".npmrc", why: ".npmrc (token de registry)" },
];

/** Arquivos que o servidor de assets interpreta como configuração. Só nós geramos. */
const ASSET_SERVER_CONFIG = new Set(["_headers", "_redirects", "_worker.js", "_routes.json", ".assetsignore"]);

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/;

/**
 * Tokens com prefixo próprio. O corpo exigido depois do prefixo é o formato
 * real de cada um — `ghp_` sozinho aparece em código minificado; `ghp_` + 36
 * caracteres, não. Conferido contra o bundle de produção: 0 falso positivo.
 */
export const TOKEN_PATTERNS = [
  { pattern: /sb_secret_[A-Za-z0-9_-]{8,}/, why: "chave secreta do Supabase (sb_secret_)" },
  { pattern: /sntrys_[A-Za-z0-9+/=_-]{20,}/, why: "token de organização do Sentry (sntrys_)" },
  { pattern: /sntryu_[A-Fa-f0-9]{32,}/, why: "token de usuário do Sentry (sntryu_)" },
  { pattern: /sk_live_[A-Za-z0-9]{16,}/, why: "chave secreta do Stripe (sk_live_)" },
  { pattern: /rk_live_[A-Za-z0-9]{16,}/, why: "chave restrita do Stripe (rk_live_)" },
  { pattern: /ghp_[A-Za-z0-9]{36}/, why: "token do GitHub (ghp_)" },
  { pattern: /github_pat_[A-Za-z0-9_]{22,}/, why: "token do GitHub (github_pat_)" },
  { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/, why: "chave da OpenAI (sk-proj-)" },
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/, why: "chave da Anthropic (sk-ant-)" },
];
const JWT = /eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*/g;
const INLINE_SOURCE_MAP = /sourceMappingURL=data:/;

export class PrepareError extends Error {
  constructor(problems) {
    super(`prepare-assets recusou a build:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "PrepareError";
    this.problems = problems;
  }
}

function isServiceRoleJwt(payloadSegment) {
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    return JSON.parse(json)?.role === "service_role";
  } catch {
    return false;
  }
}

function looksLikeSourceMap(text) {
  const head = text.trimStart().slice(0, 64);
  return head.startsWith('{"version":3') || (head.startsWith("{") && /"mappings"\s*:/.test(text.slice(0, 4096)) && /"version"\s*:\s*3/.test(text.slice(0, 4096)));
}

/** Problemas do CONTEÚDO de um arquivo (string vazia = limpo). */
export function scanContent(relPath, buffer) {
  const problems = [];
  const text = buffer.toString("latin1");
  if (PRIVATE_KEY.test(text)) problems.push(`${relPath}: chave privada (PEM/PGP)`);
  for (const { pattern, why } of TOKEN_PATTERNS) if (pattern.test(text)) problems.push(`${relPath}: ${why}`);
  for (const match of text.matchAll(JWT)) {
    if (isServiceRoleJwt(match[1])) {
      problems.push(`${relPath}: JWT com role service_role`);
      break;
    }
  }
  if (!relPath.endsWith(".map")) {
    if (looksLikeSourceMap(text)) problems.push(`${relPath}: source map com outro nome`);
    if (/\.(m?js|css)$/i.test(relPath) && INLINE_SOURCE_MAP.test(text)) {
      problems.push(`${relPath}: source map embutido (sourceMappingURL=data:)`);
    }
  }
  return problems;
}

/** Varre a origem inteira. Devolve os arquivos (relativos, com /) e os problemas. */
export function scanSource(root) {
  const files = [];
  const problems = [];

  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      const stat = fs.lstatSync(abs);

      const secret = SECRET_NAMES.find((rule) => rule.test(entry.name));
      if (secret) {
        problems.push(`${relPath}: ${secret.why}`);
        continue;
      }
      if (stat.isSymbolicLink()) {
        problems.push(`${relPath}: link simbólico`);
        continue;
      }
      if (!rel && ASSET_SERVER_CONFIG.has(entry.name)) {
        problems.push(`${relPath}: configuração do servidor de assets vinda da build (é gerada aqui)`);
        continue;
      }
      // Lixo do Finder: nunca é segredo e o nginx devolve 404. Fica fora, sem barrar.
      if (entry.name === ".DS_Store") continue;
      const insideWellKnown = relPath === ".well-known" || relPath.startsWith(".well-known/");
      if (entry.name.startsWith(".") && !insideWellKnown) {
        problems.push(`${relPath}: dotfile (o nginx devolve 404; não vai para a Cloudflare)`);
        continue;
      }

      if (stat.isDirectory()) {
        walk(abs, relPath);
        continue;
      }
      if (!stat.isFile()) {
        problems.push(`${relPath}: tipo de arquivo inesperado`);
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        problems.push(`${relPath}: ${stat.size} bytes, acima do limite de 25 MiB`);
        continue;
      }
      problems.push(...scanContent(relPath, fs.readFileSync(abs)));
      files.push(relPath);
    }
  };

  walk(root, "");
  return { files, problems };
}

/**
 * `_headers` com UMA regra só: /assets/* recebe os headers do app e o cache
 * imutável. Regra única = nenhum header aparece em duas regras = nenhuma CSP
 * juntada por vírgula.
 */
export function renderHeadersFile(config) {
  const lines = [
    "# Gerado por scripts/cloudflare/prepare-assets.mjs a partir de cloudflare/headers.json. Não editar.",
    config.assetsRule,
    ...Object.entries(config.profiles.app).map(([name, value]) => `  ${name}: ${value}`),
    `  Cache-Control: ${config.cache.immutable}`,
  ];
  for (const line of lines) {
    if (line.length >= MAX_HEADER_LINE) {
      throw new PrepareError([`_headers: linha com ${line.length} caracteres (limite ${MAX_HEADER_LINE})`]);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Segunda camada além da varredura: o wrangler não sobe source map nem dotfile
 * (a não ser .well-known/), mesmo que algum apareça em .assets/ depois do preparo.
 */
export function renderAssetsIgnore() {
  return [
    "# Gerado por scripts/cloudflare/prepare-assets.mjs. Não editar.",
    "*.map",
    ".*",
    "!/.well-known",
    "",
  ].join("\n");
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const fileSha = (file) => sha256(fs.readFileSync(file));

/** `allowedRoot` só existe para os testes: a CLI sempre exige destino oculto em cloudflare/. */
export function prepareAssets({ from, out = DEFAULT_OUT, headersConfig = loadHeadersConfig(), allowedRoot }) {
  if (!from) throw new PrepareError(["--from é obrigatório (diretório da build dual)"]);
  const source = path.resolve(from);
  let target;
  try {
    target = assertSafeOutDir(out, allowedRoot);
  } catch (error) {
    throw new PrepareError([error.message]);
  }

  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new PrepareError([`${source}: não é um diretório`]);
  }
  if (isInside(target, source) || isInside(source, target)) {
    throw new PrepareError(["origem e destino não podem estar um dentro do outro"]);
  }

  const missing = REQUIRED_FILES.filter((name) => !fs.existsSync(path.join(source, name)));
  if (missing.length > 0) {
    throw new PrepareError(missing.map((name) => `${name} ausente: não é a build dual (npm run build:dual)`));
  }

  const { files, problems } = scanSource(source);
  if (files.length > MAX_FILES) problems.push(`${files.length} arquivos, acima do limite de ${MAX_FILES}`);
  if (problems.length > 0) throw new PrepareError(problems);

  const headersFile = renderHeadersFile(headersConfig);

  fs.rmSync(target, { recursive: true, force: true });
  let mapsRemoved = 0;
  fs.cpSync(source, target, {
    recursive: true,
    filter: (src) => {
      if (path.basename(src) === ".DS_Store") return false;
      if (src.endsWith(".map") && fs.statSync(src).isFile()) {
        mapsRemoved += 1;
        return false;
      }
      return true;
    },
  });
  fs.writeFileSync(path.join(target, "_headers"), headersFile);
  fs.writeFileSync(path.join(target, ".assetsignore"), renderAssetsIgnore());

  // Conferência da saída: nenhum source map, build dual intacta.
  const leftovers = [];
  let bytes = 0;
  let count = 0;
  const walkOut = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkOut(abs);
        continue;
      }
      if (entry.name.endsWith(".map")) leftovers.push(path.relative(target, abs));
      bytes += fs.statSync(abs).size;
      count += 1;
    }
  };
  walkOut(target);
  if (leftovers.length > 0) throw new PrepareError(leftovers.map((f) => `${f}: source map sobrou na saída`));
  for (const name of REQUIRED_FILES) {
    if (fileSha(path.join(source, name)) !== fileSha(path.join(target, name))) {
      throw new PrepareError([`${name}: cópia diverge da origem`]);
    }
  }

  // `count` inclui o _headers e o .assetsignore gerados (o wrangler não sobe os dois).
  return { out: target, files: count, mapsRemoved, bytes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const args = parseArgs(process.argv.slice(2), { from: "string", out: "string" });
    const result = prepareAssets({ from: args.from, out: args.out ?? DEFAULT_OUT });
    const mib = (result.bytes / 1024 / 1024).toFixed(1);
    console.log(`ok: ${result.files} arquivos (${mib} MiB) em ${path.relative(process.cwd(), result.out) || result.out}`);
    console.log(`    source maps removidos: ${result.mapsRemoved}; _headers e .assetsignore gerados`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
