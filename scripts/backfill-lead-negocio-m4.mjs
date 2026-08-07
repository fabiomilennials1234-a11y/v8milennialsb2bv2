#!/usr/bin/env node
/**
 * Runner do M4 — backfill "cada card vira um Negócio", UMA org por execução.
 *
 * Por que o SQL não roda sozinho: ele precisa de um parâmetro (`org`) e o
 * `psql` não está no PATH desta máquina. Interpolar uuid em texto SQL é o jeito
 * fácil e é injeção; aqui o uuid entra por bind parameter e nunca vira texto.
 *
 * Guardas — por desenho, não por disciplina:
 *   • recusa o ref do dev aposentado, sem escape;
 *   • recusa o ref de PRODUÇÃO por padrão. O escape existe e é auditável —
 *     `--eu-sei-que-e-prod <ref>`, com o ref tendo de BATER com o extraído da
 *     própria URL. Ver "Sobre o escape de produção" abaixo;
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
 *
 * ── Sobre o escape de produção ─────────────────────────────────────────────
 * Até 2026-08-07 este runner recusava prod "com qualquer flag" e mandava usar
 * "outro caminho, com autorização explícita do CTO". Esse outro caminho NUNCA
 * EXISTIU no repo. O efeito prático não era segurança: era que o backfill —
 * 39.499 cards em 67 orgs, passo obrigatório da virada — não tinha como rodar no
 * dia, e a saída no dia D seria improvisar `psql` na mão, sem transação única,
 * sem dry-run e sem os NOTICE do servidor. A guarda empurrava para o caminho
 * MENOS seguro por não oferecer um seguro.
 *
 * O escape que existe agora é deliberadamente chato:
 *
 *   --eu-sei-que-e-prod <ref>   o ref tem de bater com o extraído da URL. Não dá
 *                               para confirmar sem ter lido o alvo — é a mesma
 *                               mecânica de `scripts/db-push-branch.sh --confirm`;
 *   --commit                    continua sendo obrigatório para persistir. Em
 *                               prod, sem ele, roda o dry-run e faz ROLLBACK;
 *   --org <uuid>                continua sendo uma org por execução. Não existe
 *                               "todas": o passo a passo org a org é o que
 *                               permite parar no meio sem deixar metade do banco
 *                               num estado e metade em outro.
 *
 * O que ele NÃO faz, de propósito: não pede senha, não checa quem é você, não
 * grava auditoria. Isto é uma guarda contra ENGANO — a URL errada colada às
 * pressas — e não contra intenção. Quem quer rodar em prod com má-fé tem o
 * `psql`; quem cola a URL de prod achando que é a da branch é quem esta guarda
 * protege, e é esse o acidente que já aconteceu neste projeto.
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
let escapeProd = "";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db-url") dbUrl = args[++i] ?? "";
  else if (args[i] === "--org") org = args[++i] ?? "";
  else if (args[i] === "--commit") commit = true;
  else if (args[i] === "--eu-sei-que-e-prod") escapeProd = args[++i] ?? "";
  else morrer(`argumento desconhecido: ${args[i]}`);
}

if (!dbUrl) morrer("falta --db-url. O alvo nunca é implícito.");
// ── Prod: recusa por padrão, escape auditável se explicitado ────────────────
// O ref sai da PRÓPRIA URL, e não da constante: confirmar exige ter lido o alvo
// que se está prestes a escrever. Mesma mecânica de db-push-branch.sh --confirm.
const refDaUrl =
  (dbUrl.match(/postgres\.([a-z]{20})/)?.[1] ??
    dbUrl.match(/db\.([a-z]{20})\.supabase/)?.[1] ??
    "");

if (dbUrl.includes(PROD_REF)) {
  if (!escapeProd) {
    morrer(
      `RECUSADO: a URL aponta para PRODUÇÃO (${PROD_REF}).\n` +
        `    O M4 escreve dado de cliente em 3 tabelas.\n\n` +
        `    Se é intencional — é o passo do backfill da virada — repita o ref do alvo:\n` +
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
        `    Isto é a guarda funcionando: ou a URL não é a que você pensa, ou o ref foi copiado de outro lugar.\n` +
        `    Nada foi executado.`
    );
  }
  console.error(
    vermelho(
      `\n  ⚠  ALVO É PRODUÇÃO (${refDaUrl}). Org ${org || "(não informada)"}. Modo: ${commit ? "COMMIT — ESCREVE" : "dry-run (ROLLBACK ao fim)"}.\n`
    )
  );
} else if (escapeProd) {
  // Passar o escape para um alvo que não é prod é sinal de URL trocada — e é
  // exatamente o engano que a guarda existe para pegar. Falhar é mais útil que
  // ignorar o argumento em silêncio.
  morrer(
    `--eu-sei-que-e-prod foi passado, mas a URL NÃO aponta para produção (ref '${refDaUrl || "?"}').\n` +
      `    Confira qual das duas está errada antes de rodar. Nada foi executado.`
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
