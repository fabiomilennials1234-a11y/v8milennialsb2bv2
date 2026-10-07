/**
 * Utilidades comuns aos scripts de scripts/cloudflare/ (extract, prepare, parity).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CLOUDFLARE_DIR = path.join(REPO_ROOT, "cloudflare");
export const HEADERS_CONFIG_PATH = path.join(CLOUDFLARE_DIR, "headers.json");

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Caminho relativo (com /) → caminho de URL, segmento a segmento. */
export const encodePath = (rel) => `/${rel.split("/").map(encodeURIComponent).join("/")}`;

export function loadHeadersConfig(file = HEADERS_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Arquivos sob `dir`, relativos e com /, em ordem. */
export function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/** `worker` sobre cada item, no máximo `limit` ao mesmo tempo; resultados na ordem dos itens. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * `--flag valor` e `--flag` (booleano). `spec` diz o tipo de cada flag:
 * "string" | "number" | "boolean". Flag desconhecida é erro.
 */
export function parseArgs(argv, spec) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const name = flag.startsWith("--") ? flag.slice(2) : null;
    const type = name === null ? undefined : spec[name];
    if (!type) throw new Error(`argumento desconhecido: ${flag}`);
    if (type === "boolean") {
      args[name] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} precisa de um valor`);
    args[name] = type === "number" ? Number(value) : value;
  }
  return args;
}

/**
 * Antes de qualquer `rm -rf`: o destino tem de ser um diretório OCULTO dentro
 * de `cloudflare/` (como `cloudflare/.assets` e `cloudflare/.prod-dist`), que o
 * git ignora. `--out .` ou `--out cloudflare/src` param aqui, sem apagar nada.
 * `allowedRoot` só existe para os testes apontarem para um diretório temporário.
 */
export function assertSafeOutDir(out, allowedRoot = CLOUDFLARE_DIR) {
  const target = path.resolve(out);
  const rel = path.relative(path.resolve(allowedRoot), target);
  const first = rel.split(path.sep)[0] ?? "";
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || !first.startsWith(".") || first === "." || first === "..") {
    throw new Error(
      `destino recusado: ${target}. Use um diretório oculto dentro de ${path.resolve(allowedRoot)} (ex.: cloudflare/.assets) — ele é apagado antes de ser escrito.`,
    );
  }
  return target;
}
