#!/usr/bin/env node
/**
 * Aponta o `npm run dev` para a branch efêmera do Supabase.
 *
 * Escreve `.env.development.local` — o topo da precedência do Vite em modo
 * development, então ele vence `.env`, `.env.local` e `.env.development` sem
 * depender de ninguém lembrar de qual arquivo está valendo. Está coberto pelo
 * `.gitignore` (`.env.*.local`), logo não vaza credencial pro repo.
 *
 * ⚠️ A branch padrão que a API devolve carrega o `project_ref` de PRODUÇÃO.
 * Por isso filtramos `is_default` E conferimos o ref resolvido — duas checagens
 * de propósito, porque a primeira sozinha é fácil de escrever errado.
 *
 * Runbook da branch: `.specs/project/runbook-validacao-local.md`
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_REF = "jsjsmuncfkbsbzqzqhfq";
const DEV_APOSENTADO_REF = "bcfadphgsibjzivtbjvc";
const DESTINO = resolve(RAIZ, ".env.development.local");

const vermelho = (s) => `\x1b[1;31m${s}\x1b[0m`;
const verde = (s) => `\x1b[1;32m${s}\x1b[0m`;
const ciano = (s) => `\x1b[1;36m${s}\x1b[0m`;

function morrer(msg) {
  console.error(vermelho(`\n✖ ${msg}\n`));
  process.exit(1);
}

function supabase(args) {
  try {
    // shell:true porque no Windows o `supabase` é um shim .cmd, que o
    // execFileSync cru não resolve (ENOENT). Os argumentos aqui são refs e
    // ids alfanuméricos, sem espaço nem metacaractere.
    return execFileSync("supabase", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
  } catch (err) {
    const detalhe = (err.stderr || err.stdout || err.message || "").toString().trim();
    morrer(`falha ao rodar 'supabase ${args.join(" ")}':\n  ${detalhe}`);
  }
}

console.log(ciano("→ procurando branch efêmera..."));

let branches;
try {
  branches = JSON.parse(supabase(["branches", "list", "--project-ref", PROD_REF, "-o", "json"]));
} catch {
  morrer("não consegui interpretar a saída de 'supabase branches list'.");
}

const efemeras = (Array.isArray(branches) ? branches : []).filter((b) => !b.is_default);

if (efemeras.length === 0) {
  morrer(
    `nenhuma branch efêmera existe.

  Crie uma antes (custa ~US$ 0,01344/hora e deve ser encerrada no mesmo dia):
    veja '.specs/project/runbook-validacao-local.md'

  Depois rode este comando de novo.`,
  );
}

if (efemeras.length > 1) {
  morrer(
    `existem ${efemeras.length} branches efêmeras — ambíguo, e o runbook proíbe duas:\n` +
      efemeras.map((b) => `    ${b.name} (${b.project_ref})`).join("\n"),
  );
}

const branch = efemeras[0];

if (!branch.project_ref || branch.project_ref === PROD_REF) {
  morrer(`a branch '${branch.name}' resolveu para o ref de PRODUÇÃO. Abortado.`);
}
if (branch.project_ref === DEV_APOSENTADO_REF) {
  morrer(`a branch resolveu para o dev aposentado (${DEV_APOSENTADO_REF}). Abortado.`);
}
if (branch.preview_project_status && branch.preview_project_status !== "ACTIVE_HEALTHY") {
  morrer(
    `a branch '${branch.name}' não está saudável (${branch.preview_project_status}). ` +
      "Espere ela subir antes de apontar o dev pra lá.",
  );
}

console.log(ciano(`→ branch: ${branch.name} (${branch.project_ref})`));

const envBruto = supabase(["branches", "get", branch.id, "--project-ref", PROD_REF, "-o", "env"]);
const vals = {};
for (const linha of envBruto.split(/\r?\n/)) {
  const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m) vals[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const url = vals.SUPABASE_URL;
const key = vals.SUPABASE_ANON_KEY ?? vals.SUPABASE_DEFAULT_KEY;

if (!url || !key) morrer("'branches get' não devolveu SUPABASE_URL e chave anon.");
if (url.includes(PROD_REF)) morrer("a URL devolvida é a de PRODUÇÃO. Abortado.");

const conteudo = `# GERADO POR scripts/dev-target-branch.mjs — não commitar, não editar à mão.
# Branch efêmera: ${branch.name} (${branch.project_ref})
#
# Este arquivo é o topo da precedência do Vite em modo development, então vence
# .env, .env.local e .env.development. Some junto com a branch: ao encerrá-la,
# apague este arquivo, senão o dev aponta pra um projeto que não existe mais.
VITE_SUPABASE_PROJECT_ID="${branch.project_ref}"
VITE_SUPABASE_URL="${url}"
VITE_SUPABASE_PUBLISHABLE_KEY="${key}"
`;

writeFileSync(DESTINO, conteudo, "utf8");

console.log(verde(`✓ .env.development.local escrito — dev aponta para ${branch.project_ref}.`));
console.log("  Ao encerrar a branch, apague o arquivo: rm .env.development.local");
