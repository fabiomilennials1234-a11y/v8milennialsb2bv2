#!/usr/bin/env node
/**
 * Runner do M4 — backfill "cada card vira um Negócio", UMA org por execução.
 *
 * Por que o SQL não roda sozinho: ele precisa de um parâmetro (`org`) e o
 * `psql` não está no PATH desta máquina. Interpolar uuid em texto SQL é o jeito
 * fácil e é injeção; aqui o uuid entra por bind parameter e nunca vira texto.
 *
 * Guardas — por desenho, não por disciplina:
 *   • recusa o ref de produção e o do dev aposentado, com qualquer flag;
 *   • exige --org e valida que é uuid E que a org existe (uuid errado
 *     backfillaria 0 cards em silêncio e pareceria sucesso);
 *   • DRY-RUN É O PADRÃO. Sem --commit, termina em ROLLBACK: as guardas do SQL
 *     rodam inteiras, nada persiste;
 *   • transação única. Guarda que falha aborta e desfaz — não existe
 *     meia-migração;
 *   • imprime os RAISE NOTICE do servidor (é neles que sai VALIDATION PASSED e
 *     o relatório de drift). Sem isso, sucesso e silêncio são indistinguíveis.
 *
 *   node scripts/backfill-lead-negocio-m4.mjs --db-url "postgresql://..." --org <uuid>
 *   node scripts/backfill-lead-negocio-m4.mjs --db-url "..." --org <uuid> --commit
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO_SQL = resolve(RAIZ, "scripts/backfill-lead-negocio-m4.sql");
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
/**
 * ADR-0023 decisão 11: os funis de sistema do mesmo lead são UMA jornada. Onde a
 * jornada tem mais de um card, o de trás é APAGADO — é a única escrita
 * destrutiva do backfill, e por isso não vem por padrão. Sem esta flag o SQL
 * aborta dizendo quantos cards estariam em jogo.
 */
let fundirJornada = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db-url") dbUrl = args[++i] ?? "";
  else if (args[i] === "--org") org = args[++i] ?? "";
  else if (args[i] === "--commit") commit = true;
  else if (args[i] === "--fundir-jornada") fundirJornada = true;
  else morrer(`argumento desconhecido: ${args[i]}`);
}

if (!dbUrl) morrer("falta --db-url. O alvo nunca é implícito.");
if (dbUrl.includes(PROD_REF)) {
  morrer(
    `RECUSADO: a URL aponta para PRODUÇÃO (${PROD_REF}).\n` +
      `    O M4 escreve dado de cliente em 3 tabelas. Isto não roda em prod, com nenhuma flag.\n` +
      `    Prod é botão do humano, por outro caminho, com autorização explícita do CTO.`
  );
}
if (dbUrl.includes(DEV_APOSENTADO_REF)) {
  morrer(`RECUSADO: a URL aponta para o dev APOSENTADO (${DEV_APOSENTADO_REF}).`);
}
if (!org) morrer("falta --org <uuid>. O M4 é uma org por execução, por decisão do plano.");
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
console.log(ciano(`→ org:  ${org}`));
console.log(commit ? amarelo("→ modo: COMMIT (escreve de verdade)") : ciano("→ modo: DRY-RUN (termina em ROLLBACK)"));

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

// Os RAISE NOTICE são a saída útil do SQL. Sem isto, o script "passa" calado.
client.on("notice", (n) => console.log(`   ${n.message}`));

let escreveu = false;
try {
  await client.connect();
  await client.query("BEGIN");

  const orgRow = await client.query(
    "SELECT name FROM public.organizations WHERE id = $1",
    [org]
  );
  if (orgRow.rowCount === 0) {
    throw new Error(
      `org ${org} não existe neste banco. Backfill de org inexistente escreve 0 linhas e passa calado.`
    );
  }
  console.log(ciano(`→ org:  ${orgRow.rows[0].name}`));

  const alvo = await client.query(
    `SELECT count(*)::int AS n FROM public.pipeline_entries
      WHERE organization_id = $1 AND deal_id IS NULL AND lead_id IS NOT NULL`,
    [org]
  );
  console.log(ciano(`→ cards sem negócio nesta org: ${alvo.rows[0].n}`));

  // O uuid entra por bind parameter; o arquivo SQL lê daqui e nunca é reescrito.
  await client.query("CREATE TEMP TABLE _param (org uuid NOT NULL) ON COMMIT DROP");
  await client.query("INSERT INTO _param (org) VALUES ($1)", [org]);

  // `SET LOCAL`: morre no fim da transação junto com tudo o mais. Literal fixo,
  // nunca interpolação da linha de comando.
  if (fundirJornada) {
    await client.query("SET LOCAL torque.m4_fundir_jornada = 'on'");
    console.log(amarelo("→ fusão de jornada LIGADA: card rebaixado será APAGADO"));
  }

  // Sem parâmetros → protocolo simples → múltiplos comandos permitidos.
  await client.query(sql);

  if (commit) {
    await client.query("COMMIT");
    escreveu = true;
    console.log(verde(`\n✓ M4 aplicado e COMMITADO em ${ref} para a org ${org}.`));
    console.log(amarelo("  Rollback: ver o bloco 'Rollback' em Obsidian/…/lead-negocio-migrations-db.md § M4."));
  } else {
    await client.query("ROLLBACK");
    console.log(verde(`\n✓ DRY-RUN passou: todas as guardas do M4 aprovaram. Nada foi escrito.`));
    console.log(ciano("  Para aplicar de verdade, repita o comando com --commit."));
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  morrer(
    `M4 abortado — NADA foi escrito${escreveu ? " (mas o COMMIT já tinha acontecido: verifique!)" : ""}.\n` +
      `    ${err.message}`
  );
} finally {
  await client.end().catch(() => {});
}
