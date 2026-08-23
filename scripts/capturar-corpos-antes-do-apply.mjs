#!/usr/bin/env node
/**
 * Captura o corpo VIVO das funções que a virada vai substituir — antes do apply.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * Sete funções que já existem em produção são reescritas por `CREATE OR REPLACE`
 * pelas migrations da virada. `CREATE OR REPLACE` não guarda o corpo anterior em
 * lugar nenhum: depois do apply, `pg_get_functiondef` devolve o corpo NOVO, e o
 * antigo deixa de existir no banco.
 *
 * O rollback de `20270730000030_custom_pipe_entries_deal_id` (linhas 366-367) já
 * dizia, em prosa: "capture o corpo com pg_get_functiondef ANTES de aplicar esta
 * migration". Nenhum passo do runbook fazia isso. Era um pré-requisito com prazo
 * de validade — vence no instante do apply — escrito onde ninguém leria a tempo.
 *
 * ── POR QUE NÃO BASTA O BASELINE ───────────────────────────────────────────
 * `20260101000000_baseline_prod_schema.sql` tem os corpos, e foi de lá que o
 * rollback de `20270803000040` transcreveu o dele à mão. Mas o baseline é uma
 * foto de janeiro, e o ledger de prod carrega 35 versões SEM arquivo no repo:
 * qualquer uma delas pode ter reescrito uma dessas funções desde então. Corpo
 * transcrito do baseline é uma aposta de que não houve drift; corpo capturado do
 * alvo é o corpo que vai ser destruído.
 *
 * ── ESTE SCRIPT É SOMENTE LEITURA ──────────────────────────────────────────
 * Só roda `SELECT pg_get_functiondef(...)`. Não abre transação de escrita, não
 * altera nada. Por isso, ao contrário dos runners de backfill, ele NÃO recusa o
 * ref de produção — produção é exatamente onde ele precisa rodar, e rodá-lo em
 * outro lugar captura o corpo errado.
 *
 * ── QUANDO RODAR ───────────────────────────────────────────────────────────
 * Imediatamente antes do passo 5 da spec (o `db push`), no MESMO dia, e depois
 * de commitar o resultado. Rodar na véspera é aceitável; rodar depois do apply
 * não captura nada de útil — e o script avisa quando detecta isso.
 *
 *   node scripts/capturar-corpos-antes-do-apply.mjs --db-url "postgresql://..."
 *   node scripts/capturar-corpos-antes-do-apply.mjs --db-url "..." --forcar
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = resolve(RAIZ, "supabase/migrations/rollback/_corpos-anteriores");

const vermelho = (s) => `\x1b[1;31m${s}\x1b[0m`;
const verde = (s) => `\x1b[1;32m${s}\x1b[0m`;
const amarelo = (s) => `\x1b[1;33m${s}\x1b[0m`;
const ciano = (s) => `\x1b[1;36m${s}\x1b[0m`;

function morrer(msg) {
  console.error(vermelho(`\n✖ ${msg}\n`));
  process.exit(1);
}

/**
 * As funções que JÁ EXISTEM em prod e que a virada reescreve. Só estas — as que
 * a virada CRIA (`abrir_negocio`, `mover_negocio`, `fn_assert_member_same_org`,
 * `fn_negocio_titulo_padrao`, `fn_sync_deal_id_to_custom_pipe_entry`) não têm
 * corpo anterior para capturar, e o rollback delas é `DROP`.
 *
 * `marca_do_novo` é um trecho que só aparece na versão NOVA. Serve para o script
 * dizer "isto aqui já é o corpo pós-apply" em vez de gravar em silêncio um
 * arquivo inútil com nome de backup — que é a pior saída possível, porque
 * pareceria proteção no dia de reverter.
 */
const FUNCOES = [
  {
    nome: "public.sync_custom_pipe_to_entries",
    migration: "20270730000030_custom_pipe_entries_deal_id",
    marca_do_novo: "deal_id",
    nota: "O rollback da 30 EXIGE este corpo, e é o único que não tem plano B: sem ele, reverter deixa o sync mencionando deal_id depois do DROP COLUMN e todo arrastar-e-soltar de card custom quebra com `record \"new\" has no field \"deal_id\"`.",
  },
  {
    nome: "public.fn_auto_assign_lead_default_pipe",
    migration: "20270730000040_auto_seed_deal_manual_only",
    marca_do_novo: "deal_manual_only",
  },
  {
    nome: "public.fn_track_lead_field_changes",
    migration: "20270730000020_leads_claim",
    marca_do_novo: "claimed_by",
  },
  {
    nome: "public.bulk_move_stage",
    migration: "20270730000050_deal_por_lead_destrava",
    marca_do_novo: "deal_id",
  },
  {
    nome: "public.bulk_add_to_custom_pipe",
    migration: "20270730000050_deal_por_lead_destrava",
    marca_do_novo: "deal_id",
  },
  {
    nome: "public.sync_pipeline_entry_to_lead_pipe_whatsapp",
    migration: "20270803000040_sync_pipe_whatsapp_no_move",
    marca_do_novo: "pipeline_id IS DISTINCT FROM",
  },
  {
    nome: "public.create_default_pipeline_stages",
    migration: "20270805000010_aposenta_funis_de_carteira",
    // A versão nova é a que NÃO semeia carteira; a marca é a ausência, então
    // aqui a detecção é invertida (ver `jaEhNovo` abaixo).
    marca_do_ausente: "upsell_base",
  },
];

let dbUrl = "";
let forcar = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db-url") dbUrl = args[++i] ?? "";
  else if (args[i] === "--forcar") forcar = true;
  else morrer(`argumento desconhecido: ${args[i]}`);
}
if (!dbUrl) morrer("falta --db-url. O alvo nunca é implícito — e capturar do banco errado é pior que não capturar.");

const ref = dbUrl.match(/(?:postgres\.|db\.)([a-z]{20})/)?.[1] ?? "(ref não extraído)";

// Sobrescrever uma captura pré-apply com uma pós-apply destrói a única cópia do
// corpo antigo. O padrão é recusar; `--forcar` existe para a segunda tentativa
// legítima no mesmo dia (a primeira falhou no meio, por exemplo).
if (existsSync(DESTINO) && readdirSync(DESTINO).some((f) => f.endsWith(".sql")) && !forcar) {
  morrer(
    `já existem capturas em ${DESTINO}.\n` +
      `    Sobrescrever uma captura PRÉ-apply por uma PÓS-apply apaga a única cópia do corpo antigo.\n` +
      `    Se a captura anterior é do mesmo dia e você sabe que ainda é pré-apply, repita com --forcar.`,
  );
}

console.log(ciano(`→ alvo:    ${ref}`));
console.log(ciano(`→ destino: ${DESTINO}`));
console.log(ciano(`→ modo:    SOMENTE LEITURA (só pg_get_functiondef)`));

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

let capturadas = 0;
let ausentes = 0;
let jaNovas = 0;

try {
  await client.connect();
  mkdirSync(DESTINO, { recursive: true });

  for (const fn of FUNCOES) {
    const { rows } = await client.query(
      `SELECT p.oid::regprocedure::text AS assinatura, pg_get_functiondef(p.oid) AS corpo
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname || '.' || p.proname = $1`,
      [fn.nome],
    );

    if (rows.length === 0) {
      console.log(amarelo(`  ⚠ ${fn.nome} — NÃO EXISTE neste banco. Nada a capturar.`));
      ausentes += 1;
      continue;
    }

    for (const row of rows) {
      const corpo = row.corpo ?? "";
      const jaEhNovo = fn.marca_do_novo
        ? corpo.includes(fn.marca_do_novo)
        : fn.marca_do_ausente
          ? !corpo.includes(fn.marca_do_ausente)
          : false;

      if (jaEhNovo) {
        console.log(
          vermelho(`  ✖ ${fn.nome} — o corpo neste banco JÁ É a versão pós-apply (${fn.migration}).`),
        );
        console.log(amarelo(`     Captura inútil: o corpo antigo já não existe aqui. Não gravado.`));
        jaNovas += 1;
        continue;
      }

      const arquivo = join(DESTINO, `${fn.nome.replace(/^public\./, "")}.sql`);
      const cabecalho =
        `-- CORPO ANTERIOR de ${row.assinatura}\n` +
        `-- Capturado de ${ref} em ${new Date().toISOString()} por scripts/capturar-corpos-antes-do-apply.mjs\n` +
        `--\n` +
        `-- Substituído por: ${fn.migration}\n` +
        (fn.nota ? `--\n-- ${fn.nota.replace(/\n/g, "\n-- ")}\n` : "") +
        `--\n` +
        `-- Este arquivo é a ÚNICA cópia do corpo pré-apply vinda do banco vivo. O\n` +
        `-- baseline tem uma versão de janeiro, que pode ter sofrido drift desde então.\n` +
        `-- Para reverter: rode este CREATE OR REPLACE inteiro.\n\n`;

      writeFileSync(arquivo, cabecalho + corpo + "\n", "utf8");
      console.log(verde(`  ✓ ${row.assinatura}`));
      capturadas += 1;
    }
  }
} catch (err) {
  morrer(`captura abortada: ${err.message}`);
} finally {
  await client.end().catch(() => {});
}

console.log("");
console.log(verde(`✓ ${capturadas} corpo(s) capturado(s) em ${DESTINO}`));
if (ausentes) console.log(amarelo(`  ${ausentes} função(ões) não existem neste banco.`));

if (jaNovas > 0) {
  console.log("");
  console.log(
    vermelho(
      `⚠ ${jaNovas} função(ões) já estão na versão pós-apply neste banco.\n` +
        `  Ou a virada já foi aplicada aqui, ou este não é o banco que você pensa.\n` +
        `  Se for produção e a virada NÃO foi aplicada, pare e investigue antes do push.`,
    ),
  );
  process.exit(2);
}

console.log(ciano("  COMMITE estes arquivos antes do apply. Captura não versionada é captura perdida."));
