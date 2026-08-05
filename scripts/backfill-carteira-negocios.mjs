#!/usr/bin/env node
/**
 * Runner do backfill "cada pedido de ERP vira um Negócio ganho".
 * UMA org por execução, mesmas guardas do M4.
 *
 *   • recusa o ref de produção e o do dev aposentado, com qualquer flag;
 *   • exige --org, valida uuid E existência (uuid errado backfillaria 0 e
 *     pareceria sucesso);
 *   • DRY-RUN É O PADRÃO. Sem --commit termina em ROLLBACK, com todas as
 *     guardas do SQL tendo rodado;
 *   • transação única — guarda que falha desfaz tudo;
 *   • imprime os RAISE NOTICE, que são a saída útil.
 *
 *   node scripts/backfill-carteira-negocios.mjs --db-url "postgresql://..." --org <uuid>
 *   node scripts/backfill-carteira-negocios.mjs --db-url "..." --org <uuid> --commit
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO_SQL = resolve(RAIZ, "scripts/backfill-carteira-negocios.sql");
const PROD_REF = "jsjsmuncfkbsbzqzqhfq";
const DEV_APOSENTADO_REF = "bcfadphgsibjzivtbjvc";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const vermelho = (s) => `\x1b[1;31m${s}\x1b[0m`;
const verde = (s) => `\x1b[1;32m${s}\x1b[0m`;
const amarelo = (s) => `\x1b[1;33m${s}\x1b[0m`;
const ciano = (s) => `\x1b[1;36m${s}\x1b[0m`;

function morrer(msg) {
  console.error(vermelho(`\n✖ ${msg}\n`));
  process.exit(1);
}

let dbUrl = "";
let org = "";
let commit = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db-url") dbUrl = args[++i] ?? "";
  else if (args[i] === "--org") org = args[++i] ?? "";
  else if (args[i] === "--commit") commit = true;
  else morrer(`argumento desconhecido: ${args[i]}`);
}

if (!dbUrl) morrer("falta --db-url. O alvo nunca é implícito.");
if (dbUrl.includes(PROD_REF)) {
  morrer(
    `RECUSADO: a URL aponta para PRODUÇÃO (${PROD_REF}).\n` +
      `    Este backfill escreve dado de cliente em deals e pipeline_entries.\n` +
      `    Prod é botão do humano, por outro caminho, com autorização explícita.`,
  );
}
if (dbUrl.includes(DEV_APOSENTADO_REF)) {
  morrer(`RECUSADO: a URL aponta para o dev APOSENTADO (${DEV_APOSENTADO_REF}).`);
}
if (!org) morrer("falta --org <uuid>. Uma org por execução.");
if (!UUID_RE.test(org)) morrer(`--org não é um uuid: ${org}`);

const ref = dbUrl.match(/(?:postgres\.|db\.)([a-z]{20})/)?.[1] ?? "(ref não extraído)";
const sql = (() => {
  try {
    return readFileSync(ARQUIVO_SQL, "utf8");
  } catch {
    morrer(`não consegui ler ${ARQUIVO_SQL}`);
  }
})();

console.log(ciano(`→ alvo: ${ref}`));
console.log(commit ? amarelo("→ modo: COMMIT (escreve de verdade)") : ciano("→ modo: DRY-RUN (termina em ROLLBACK)"));

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
client.on("notice", (n) => console.log(`   ${n.message}`));

try {
  await client.connect();
  await client.query("BEGIN");

  const orgRow = await client.query("SELECT name FROM public.organizations WHERE id = $1", [org]);
  if (orgRow.rowCount === 0) {
    throw new Error(
      `org ${org} não existe neste banco. Backfill de org inexistente escreve 0 linhas e passa calado.`,
    );
  }
  console.log(ciano(`→ org:  ${orgRow.rows[0].name}`));

  const alvo = await client.query(
    `SELECT count(*)::int AS n
       FROM public.upsell_orders o
       JOIN public.upsell_clients c ON c.id = o.client_id
      WHERE c.organization_id = $1 AND c.lead_id IS NOT NULL`,
    [org],
  );
  console.log(ciano(`→ pedidos de ERP com lead nesta org: ${alvo.rows[0].n}`));

  await client.query("CREATE TEMP TABLE _param (org uuid NOT NULL) ON COMMIT DROP");
  await client.query("INSERT INTO _param (org) VALUES ($1)", [org]);

  await client.query(sql);

  if (commit) {
    await client.query("COMMIT");
    console.log(verde(`\n✓ Backfill de carteira COMMITADO em ${ref} para a org ${org}.`));
    console.log(
      amarelo(
        "  Rollback: DELETE em pipeline_entries e deals onde metadata->>'origem' = 'carteira_erp'.",
      ),
    );
  } else {
    await client.query("ROLLBACK");
    console.log(verde("\n✓ DRY-RUN passou: todas as guardas aprovaram. Nada foi escrito."));
    console.log(ciano("  Para aplicar de verdade, repita com --commit."));
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  morrer(`Backfill abortado — NADA foi escrito.\n    ${err.message}`);
} finally {
  await client.end().catch(() => {});
}
