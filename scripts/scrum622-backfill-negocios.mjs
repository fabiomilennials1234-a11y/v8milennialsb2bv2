#!/usr/bin/env node
/**
 * Runner do SCRUM-622 — backfill "um Negócio por card custom", UMA org por
 * execução. Molde: scripts/backfill-lead-negocio-m4.mjs (guardas idênticas).
 *
 * Guardas — por desenho, não por disciplina:
 *   • recusa o dev aposentado, sem escape;
 *   • recusa PRODUÇÃO por padrão; escape auditável `--eu-sei-que-e-prod <ref>`
 *     com o ref tendo de bater com o extraído da própria URL;
 *   • exige --org, valida uuid e existência (uuid errado = 0 cards em silêncio);
 *   • DRY-RUN É O PADRÃO — sem --commit termina em ROLLBACK com todas as
 *     guardas do SQL rodadas;
 *   • transação única; imprime os RAISE NOTICE do servidor.
 *
 * Ordem de rollout (decisão CTO): Milennials primeiro
 * (6030520a-2ca7-477d-be89-55758e2cd808), depois as demais, uma a uma.
 *
 *   node scripts/scrum622-backfill-negocios.mjs --db-url "postgresql://…" --org <uuid>
 *   node scripts/scrum622-backfill-negocios.mjs --db-url "…" --org <uuid> --commit
 *   node scripts/scrum622-backfill-negocios.mjs --db-url "…" --org <uuid> --rollback [--commit]
 *
 * `--rollback` roda scripts/scrum622-rollback-negocios.sql para a org: desamarra
 * deal_id e apaga os Negócios de procedência backfill_funil_custom — seguro por
 * construção (a procedência é a marca; nada mais tem esse valor).
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SQL_BACKFILL = resolve(RAIZ, "scripts/scrum622-backfill-negocios.sql");
const SQL_ROLLBACK = resolve(RAIZ, "scripts/scrum622-rollback-negocios.sql");
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
let rollback = false;
let escapeProd = "";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db-url") dbUrl = args[++i] ?? "";
  else if (args[i] === "--org") org = args[++i] ?? "";
  else if (args[i] === "--commit") commit = true;
  else if (args[i] === "--rollback") rollback = true;
  else if (args[i] === "--eu-sei-que-e-prod") escapeProd = args[++i] ?? "";
  else morrer(`argumento desconhecido: ${args[i]}`);
}

if (!dbUrl) morrer("falta --db-url. O alvo nunca é implícito.");
const refDaUrl =
  (dbUrl.match(/postgres\.([a-z]{20})/)?.[1] ??
    dbUrl.match(/db\.([a-z]{20})\.supabase/)?.[1] ??
    "");

if (dbUrl.includes(PROD_REF)) {
  if (!escapeProd) {
    morrer(
      `RECUSADO: a URL aponta para PRODUÇÃO (${PROD_REF}).\n` +
        `    O SCRUM-622 escreve dado de cliente (deals + pipeline_entries.deal_id).\n\n` +
        `    Se é intencional — é o rollout org a org da W2 — repita o ref do alvo:\n` +
        `      --eu-sei-que-e-prod ${PROD_REF}\n\n` +
        `    Sem --commit isto ainda roda em DRY-RUN e termina em ROLLBACK.`
    );
  }
  if (!refDaUrl) {
    morrer(
      `Não consegui extrair o project ref da URL para conferir contra --eu-sei-que-e-prod.\n` +
        `    Formato esperado: 'postgres.<ref>' ou 'db.<ref>.supabase'. Nada foi executado.`
    );
  }
  if (escapeProd !== refDaUrl) {
    morrer(
      `--eu-sei-que-e-prod '${escapeProd}' não bate com o ref da própria URL ('${refDaUrl}').\n` +
        `    Nada foi executado.`
    );
  }
  console.error(
    vermelho(
      `\n  ⚠  ALVO É PRODUÇÃO (${refDaUrl}). Org ${org || "(não informada)"}. Modo: ${rollback ? "ROLLBACK DE DADO" : "backfill"} ${commit ? "COMMIT — ESCREVE" : "dry-run (ROLLBACK ao fim)"}.\n`
    )
  );
} else if (escapeProd) {
  morrer(
    `--eu-sei-que-e-prod foi passado, mas a URL NÃO aponta para produção (ref '${refDaUrl || "?"}').\n` +
      `    Confira qual das duas está errada. Nada foi executado.`
  );
}
if (dbUrl.includes(DEV_APOSENTADO_REF)) {
  morrer(`RECUSADO: a URL aponta para o dev APOSENTADO (${DEV_APOSENTADO_REF}).`);
}
if (!org) morrer("falta --org <uuid>. O rollout é uma org por execução (Milennials primeiro).");
if (!UUID_RE.test(org)) morrer(`--org não é um uuid: ${org}`);

const arquivo = rollback ? SQL_ROLLBACK : SQL_BACKFILL;
const sql = (() => {
  try {
    return readFileSync(arquivo, "utf8");
  } catch {
    morrer(`não consegui ler ${arquivo}`);
  }
})();

const ref = refDaUrl || "(ref não extraído)";
console.log(ciano(`→ alvo:    ${ref}`));
console.log(ciano(`→ org:     ${org}`));
console.log(ciano(`→ arquivo: ${arquivo.replace(RAIZ + "/", "")}`));
console.log(commit ? amarelo("→ modo:    COMMIT (escreve de verdade)") : ciano("→ modo:    DRY-RUN (termina em ROLLBACK)"));

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
client.on("notice", (n) => console.log(`   ${n.message}`));

let escreveu = false;
try {
  await client.connect();
  await client.query("BEGIN");

  const orgRow = await client.query("SELECT name FROM public.organizations WHERE id = $1", [org]);
  if (orgRow.rowCount === 0) {
    throw new Error(`org ${org} não existe neste banco.`);
  }
  console.log(ciano(`→ org:     ${orgRow.rows[0].name}`));

  // O uuid entra por bind parameter; o arquivo SQL lê de _param e nunca é reescrito.
  await client.query("CREATE TEMP TABLE _param (org uuid NOT NULL, ord int NOT NULL) ON COMMIT DROP");
  await client.query("INSERT INTO _param (org, ord) VALUES ($1, 1)", [org]);

  await client.query(sql);

  if (commit) {
    await client.query("COMMIT");
    escreveu = true;
    console.log(verde(`\n✓ SCRUM-622 ${rollback ? "REVERTIDO" : "aplicado"} e COMMITADO em ${ref} para a org ${org}.`));
  } else {
    await client.query("ROLLBACK");
    console.log(verde(`\n✓ DRY-RUN passou: todas as guardas aprovaram. Nada foi escrito.`));
    console.log(ciano("  Para aplicar de verdade, repita o comando com --commit."));
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  morrer(
    `SCRUM-622 abortado — NADA foi escrito${escreveu ? " (mas o COMMIT já tinha acontecido: verifique!)" : ""}.\n` +
      `    ${err.message}`
  );
} finally {
  await client.end().catch(() => {});
}
