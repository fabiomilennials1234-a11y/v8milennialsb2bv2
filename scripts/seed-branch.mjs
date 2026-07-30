#!/usr/bin/env node
/**
 * Aplica um arquivo SQL de seed numa branch efêmera.
 *
 * Por que existe: a CLAUDE.md manda fazer escrita de QA com `psql` em
 * `supabase/qa-seed/` — mas `psql` não está no PATH desta máquina e aquela
 * pasta nunca existiu. E `supabase db query -f` roda o arquivo como statement
 * único, então morre com `42601 cannot insert multiple commands into a
 * prepared statement` em qualquer seed de verdade.
 *
 * Usa o `pg` que já é dependência do projeto. Sem parâmetros na query, o
 * driver usa o protocolo simples, que aceita múltiplos comandos.
 *
 * Recusa produção pelo ref, como `scripts/db-push-branch.sh`. Seed é escrita de
 * dado — o alvo errado aqui é pior que numa migration de schema.
 *
 *   node scripts/seed-branch.mjs --db-url "postgresql://..." [--file supabase/seed.sql]
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_REF = "jsjsmuncfkbsbzqzqhfq";
const DEV_APOSENTADO_REF = "bcfadphgsibjzivtbjvc";

const vermelho = (s) => `\x1b[1;31m${s}\x1b[0m`;
const verde = (s) => `\x1b[1;32m${s}\x1b[0m`;
const ciano = (s) => `\x1b[1;36m${s}\x1b[0m`;

function morrer(msg) {
  console.error(vermelho(`\n✖ ${msg}\n`));
  process.exit(1);
}

let dbUrl = "";
let arquivo = "supabase/seed.sql";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db-url") dbUrl = args[++i] ?? "";
  else if (args[i] === "--file" || args[i] === "-f") arquivo = args[++i] ?? arquivo;
  else morrer(`argumento desconhecido: ${args[i]}`);
}

if (!dbUrl) morrer("falta --db-url. O alvo nunca é implícito.");
if (dbUrl.includes(PROD_REF)) {
  morrer(`RECUSADO: a URL aponta para PRODUÇÃO (${PROD_REF}).\n    Seed escreve dado. Isto não roda em prod, com nenhuma flag.`);
}
if (dbUrl.includes(DEV_APOSENTADO_REF)) {
  morrer(`RECUSADO: a URL aponta para o dev APOSENTADO (${DEV_APOSENTADO_REF}).`);
}

const ref = dbUrl.match(/(?:postgres\.|db\.)([a-z]{20})/)?.[1] ?? "(ref não extraído)";
const caminho = resolve(RAIZ, arquivo);

let sql;
try {
  sql = readFileSync(caminho, "utf8");
} catch {
  morrer(`não consegui ler ${arquivo}`);
}

console.log(ciano(`→ alvo: ${ref}`));
console.log(ciano(`→ arquivo: ${arquivo} (${sql.split(/\r?\n/).length} linhas)`));

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  // Sem parâmetros → protocolo simples → múltiplos comandos permitidos.
  await client.query(sql);
  console.log(verde(`✓ seed aplicado em ${ref}.`));
} catch (err) {
  morrer(`falha ao aplicar o seed:\n    ${err.message}`);
} finally {
  await client.end().catch(() => {});
}
