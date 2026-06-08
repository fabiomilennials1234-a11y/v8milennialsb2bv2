/**
 * One-off: importa planilha_Basic4u (clientes da carteira) para a org basicforu em PROD.
 *
 * Decisões travadas (grill 2026-06-08):
 *  - "Data última compra" → grava DIRETO em upsell_clients.last_order_at (sem order).
 *    O cron calculate-portfolio-health foi patchado pra PRESERVAR last_order_at quando
 *    o cliente tem 0 orders (sale_value tem CHECK > 0, e a planilha não traz valor).
 *  - first_sale_at = última compra (único dado disponível).
 *  - Vendedora → team_member resolvido por nome (exato → first-name contains). Vazio → null.
 *  - Dedup/upsert por nome normalizado dentro da org: existe → atualiza vendedora +
 *    recência (só se a data for mais nova); não existe → cria lead + upsell_client.
 *  - 5 linhas sem data → sold_at = hoje (escolha do CTO; recência "comprou hoje").
 *  - Valores iniciais: health_score=70, health_status='atencao', segment='novo',
 *    reorder_cycle_days = org default ?? 30. O cron refina na próxima rodada.
 *
 * ORDEM CORRETA: o cron patchado precisa estar deployado em prod ANTES desta carga,
 * senão a 1ª rodada noturna zera last_order_at.
 *
 * Uso (rode você, a senha nunca entra nas tool calls do agente):
 *   # dry-run (padrão, não escreve nada):
 *   SUPABASE_DB_PASSWORD='...' node scripts/import-basic4u-carteira.mjs
 *   # executar de verdade:
 *   SUPABASE_DB_PASSWORD='...' node scripts/import-basic4u-carteira.mjs --execute
 *   # forçar org (se a auto-detecção achar mais de uma candidata):
 *   SUPABASE_DB_PASSWORD='...' node scripts/import-basic4u-carteira.mjs --org-id=<uuid>
 *
 * Senha: Supabase Dashboard → Project Settings → Database.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXECUTE = process.argv.includes('--execute');
const ORG_ARG = (process.argv.find((a) => a.startsWith('--org-id=')) || '').split('=')[1] || null;

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('ERRO: defina SUPABASE_DB_PASSWORD.\n  SUPABASE_DB_PASSWORD=... node scripts/import-basic4u-carteira.mjs [--execute]');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────
const normalize = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const todayISO = new Date().toISOString();
const daysSince = (iso, now) =>
  Math.round(Math.abs(new Date(now).getTime() - new Date(iso).getTime()) / 86_400_000);
const addDays = (iso, days) =>
  new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

// Resolve seller normalized name → member id (exato, depois first-name contains).
function resolveSeller(sellerNorm, members) {
  if (!sellerNorm) return null;
  const exact = members.find((m) => m.norm === sellerNorm);
  if (exact) return exact.id;
  const contains = members.find(
    (m) => m.norm.split(' ')[0] === sellerNorm || m.norm.includes(sellerNorm) || sellerNorm.includes(m.norm.split(' ')[0]),
  );
  return contains ? contains.id : null;
}

// ── load data ────────────────────────────────────────────────────────────────
const rows = JSON.parse(readFileSync(join(__dirname, 'basic4u-clients.json'), 'utf8'));
console.log(`Planilha: ${rows.length} linhas válidas carregadas.`);

const client = new pg.Client({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.jsjsmuncfkbsbzqzqhfq',
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(`Conectado a PROD (jsjsmuncfkbsbzqzqhfq). Modo: ${EXECUTE ? 'EXECUTE ⚠️' : 'DRY-RUN'}\n`);

  // 1) Resolver org basicforu
  let orgId = ORG_ARG;
  if (!orgId) {
    const { rows: orgs } = await client.query(
      `SELECT id, name FROM organizations
        WHERE name ILIKE '%basic%' ORDER BY name`,
    );
    console.log('Orgs candidatas (ILIKE %basic%):');
    orgs.forEach((o) => console.log(`  ${o.id}  ${o.name}`));
    const strong = orgs.filter((o) => /basic.?(4|for).?u/i.test(o.name));
    if (strong.length === 1) {
      orgId = strong[0].id;
      console.log(`\n→ org resolvida automaticamente: ${strong[0].name} (${orgId})`);
    } else {
      console.error('\nERRO: não consegui resolver a org com segurança. Rode com --org-id=<uuid> de uma das candidatas acima.');
      process.exit(1);
    }
  }

  // 2) Org default reorder cycle
  const { rows: orgCfg } = await client.query(
    `SELECT COALESCE(default_reorder_cycle_days, 30) AS cycle FROM organizations WHERE id = $1`,
    [orgId],
  );
  const cycleDays = orgCfg[0]?.cycle ?? 30;
  console.log(`reorder_cycle_days base: ${cycleDays}`);

  // 3) Team members → mapa vendedora
  const { rows: memberRows } = await client.query(
    `SELECT id, name FROM team_members WHERE organization_id = $1`,
    [orgId],
  );
  const members = memberRows.map((m) => ({ id: m.id, name: m.name, norm: normalize(m.name) }));
  const distinctSellers = [...new Set(rows.map((r) => r.seller_norm).filter(Boolean))];
  console.log('\nMapa vendedoras (planilha → team_member):');
  const sellerMap = {};
  for (const s of distinctSellers) {
    const id = resolveSeller(s, members);
    const m = members.find((x) => x.id === id);
    sellerMap[s] = id;
    console.log(`  ${s.padEnd(12)} → ${id ? `${m.name} (${id})` : '⚠️  SEM MATCH → null'}`);
  }

  // 4) Clientes existentes (dedup por nome normalizado)
  const { rows: existing } = await client.query(
    `SELECT id, lead_id, name, last_order_at FROM upsell_clients WHERE organization_id = $1`,
    [orgId],
  );
  const byName = new Map();
  for (const c of existing) byName.set(normalize(c.name), c);
  console.log(`\nClientes já na carteira: ${existing.length} (dedup por nome).`);

  // 5) Plano
  let toInsert = 0, toUpdate = 0, toSkip = 0, noDate = 0, noSeller = 0;
  const plan = [];
  const seenThisRun = new Map(); // norm → {last_order_at} pra dedup intra-planilha
  for (const r of rows) {
    const nameNorm = normalize(r.name);
    const date = r.last_purchase ? `${r.last_purchase}T12:00:00Z` : todayISO;
    if (!r.last_purchase) noDate++;
    const sellerId = r.seller_norm ? sellerMap[r.seller_norm] : null;
    if (!sellerId) noSeller++;

    const prior = byName.get(nameNorm) || seenThisRun.get(nameNorm);
    if (prior) {
      const priorDate = prior.last_order_at ? new Date(prior.last_order_at).getTime() : 0;
      const newer = new Date(date).getTime() > priorDate;
      plan.push({ op: newer ? 'update' : 'skip', nameNorm, name: r.name, date, sellerId, id: prior.id });
      if (newer) toUpdate++; else toSkip++;
    } else {
      plan.push({ op: 'insert', nameNorm, name: r.name, date, sellerId });
      toInsert++;
    }
    seenThisRun.set(nameNorm, { id: prior?.id ?? '__pending__', last_order_at: date });
  }

  console.log('\n── PLANO ──────────────────────────────────────────────');
  console.log(`  inserir novos:        ${toInsert}`);
  console.log(`  atualizar existentes: ${toUpdate}`);
  console.log(`  pular (data antiga):  ${toSkip}`);
  console.log(`  sem data (→ hoje):    ${noDate}`);
  console.log(`  sem vendedora (null): ${noSeller}`);
  console.log('\n  amostra (10):');
  plan.slice(0, 10).forEach((p) =>
    console.log(`    [${p.op}] ${p.name.slice(0, 38).padEnd(38)} ${p.date.slice(0, 10)} seller=${p.sellerId ? 'ok' : '—'}`),
  );

  if (!EXECUTE) {
    console.log('\nDRY-RUN: nada escrito. Revise o plano e rode com --execute.');
    process.exit(0);
  }

  // 6) Executar em transação
  console.log('\n⚠️  EXECUTANDO em PROD…');
  await client.query('BEGIN');
  let inserted = 0, updated = 0, skipped = 0;
  for (const p of plan) {
    const ds = daysSince(p.date, todayISO);
    const nextOrder = addDays(p.date, cycleDays);
    if (p.op === 'skip') { skipped++; continue; }

    if (p.op === 'update') {
      await client.query(
        `UPDATE upsell_clients
            SET last_order_at = $2, first_sale_at = LEAST(first_sale_at, $2),
                days_since_last_order = $3, reorder_cycle_days = $4,
                next_order_expected = $5,
                responsible_id = COALESCE($6, responsible_id),
                closer_id = COALESCE($6, closer_id),
                sale_responsible_id = COALESCE($6, sale_responsible_id),
                updated_at = now()
          WHERE id = $1`,
        [p.id, p.date, ds, cycleDays, nextOrder, p.sellerId],
      );
      if (p.sellerId) {
        await client.query(
          `UPDATE leads SET responsible_id = $2, closer_id = $2, sale_responsible_id = $2
             WHERE id = (SELECT lead_id FROM upsell_clients WHERE id = $1)`,
          [p.id, p.sellerId],
        );
      }
      updated++;
      continue;
    }

    // insert: lead → upsell_client
    const { rows: leadRows } = await client.query(
      `INSERT INTO leads (organization_id, name, origin, responsible_id, closer_id, sale_responsible_id)
       VALUES ($1, $2, 'outro', $3, $3, $3) RETURNING id`,
      [orgId, p.name, p.sellerId],
    );
    const leadId = leadRows[0].id;
    const { rows: cliRows } = await client.query(
      `INSERT INTO upsell_clients
         (organization_id, lead_id, name, potencial, first_sale_at, last_order_at,
          days_since_last_order, reorder_cycle_days, next_order_expected,
          health_score, health_status, segment, order_count,
          responsible_id, closer_id, sale_responsible_id)
       VALUES ($1, $2, $3, 'medio', $4, $4, $5, $6, $7, 70, 'atencao', 'novo', 0, $8, $8, $8)
       RETURNING id`,
      [orgId, leadId, p.name, p.date, ds, cycleDays, nextOrder, p.sellerId],
    );
    // registra no dedup intra-run pra ocorrências seguintes do mesmo nome
    byName.set(p.nameNorm, { id: cliRows[0].id, lead_id: leadId, last_order_at: p.date });
    inserted++;
  }
  await client.query('COMMIT');
  console.log(`\n✅ COMMIT. inseridos=${inserted} atualizados=${updated} pulados=${skipped}`);

  // smoke
  const { rows: cnt } = await client.query(
    `SELECT COUNT(*)::int AS n, COUNT(last_order_at)::int AS with_date FROM upsell_clients WHERE organization_id = $1`,
    [orgId],
  );
  console.log(`Carteira basicforu agora: ${cnt[0].n} clientes, ${cnt[0].with_date} com última compra.`);
  console.log('\nPróximo: o cron calculate-portfolio-health (patchado) recalcula health/segment/overdue na próxima rodada — ou dispare manualmente.');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ Falhou (rollback feito):', err.message);
  process.exit(1);
} finally {
  await client.end();
}
