/**
 * Carga basic4u → carteira basicforu via Supabase Management API (/database/query).
 * Roda SQL como admin em PROD (jsjsmuncfkbsbzqzqhfq) usando o access token do CLI.
 *
 * Token via env SB_TOKEN (passar em runtime, NÃO hardcode):
 *   SB_TOKEN=$(security find-generic-password -s "Supabase CLI" -w) \
 *     node scripts/run-basic4u-via-mgmt.mjs [--execute] [--org-id=<uuid>]
 *
 * Decisões: ver scripts/import-basic4u-carteira.mjs (mesma lógica; aqui via REST).
 * - last_order_at gravado direto (cron patchado preserva quando 0 orders).
 * - dedup/upsert por nome normalizado; recência só atualiza se data mais nova.
 * - sem data → hoje. sem vendedora → null. valores iniciais health=70/atencao/novo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF = 'jsjsmuncfkbsbzqzqhfq';
const EXECUTE = process.argv.includes('--execute');
const ORG_ARG = (process.argv.find((a) => a.startsWith('--org-id=')) || '').split('=')[1] || null;
const TOKEN = process.env.SB_TOKEN;
if (!TOKEN) { console.error('ERRO: defina SB_TOKEN (access token do CLI).'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MgmtAPI ${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const lit = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const normalize = (s) =>
  (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const daysSince = (iso, now) => Math.round(Math.abs(new Date(now) - new Date(iso)) / 86_400_000);
const addDays = (iso, d) => new Date(new Date(iso).getTime() + d * 86_400_000).toISOString();
function resolveSeller(sn, members) {
  if (!sn) return null;
  const exact = members.find((m) => m.norm === sn);
  if (exact) return exact.id;
  const c = members.find((m) => m.norm.split(' ')[0] === sn || m.norm.includes(sn) || sn.includes(m.norm.split(' ')[0]));
  return c ? c.id : null;
}

const rows = JSON.parse(readFileSync(join(__dirname, 'basic4u-clients.json'), 'utf8'));
const todayISO = new Date().toISOString();
console.log(`Planilha: ${rows.length} linhas. Modo: ${EXECUTE ? 'EXECUTE ⚠️' : 'DRY-RUN'} | PROD ${REF}\n`);

// 1) org
let orgId = ORG_ARG;
const orgs = await q(`SELECT id, name FROM organizations WHERE name ILIKE '%basic%' ORDER BY name`);
console.log('Orgs candidatas (%basic%):'); orgs.forEach((o) => console.log(`  ${o.id}  ${o.name}`));
if (!orgId) {
  const strong = orgs.filter((o) => /basic.?(4|for).?u/i.test(o.name));
  if (strong.length === 1) { orgId = strong[0].id; console.log(`→ org auto: ${strong[0].name} (${orgId})`); }
  else { console.error('\nERRO: org ambígua. Rode com --org-id=<uuid>.'); process.exit(1); }
}

// 2) cycle, members, existing
const cycleDays = (await q(`SELECT COALESCE(default_reorder_cycle_days,30) c FROM organizations WHERE id=${lit(orgId)}`))[0]?.c ?? 30;
const members = (await q(`SELECT id, name FROM team_members WHERE organization_id=${lit(orgId)}`))
  .map((m) => ({ id: m.id, name: m.name, norm: normalize(m.name) }));
const existing = await q(`SELECT id, name, last_order_at FROM upsell_clients WHERE organization_id=${lit(orgId)}`);
const byName = new Map(existing.map((c) => [normalize(c.name), c]));
console.log(`cycle=${cycleDays} | members=${members.length} | já na carteira=${existing.length}`);

console.log('\nMapa vendedoras:');
const sellerMap = {};
for (const s of [...new Set(rows.map((r) => r.seller_norm).filter(Boolean))]) {
  const id = resolveSeller(s, members);
  sellerMap[s] = id;
  console.log(`  ${s.padEnd(12)} → ${id ? members.find((m) => m.id === id).name + ' (' + id + ')' : '⚠️ SEM MATCH → null'}`);
}

// 3) plano
const seen = new Map();
const inserts = [], updates = [];
let noDate = 0, noSeller = 0, skip = 0;
for (const r of rows) {
  const nameNorm = normalize(r.name);
  const date = r.last_purchase ? `${r.last_purchase}T12:00:00Z` : todayISO;
  if (!r.last_purchase) noDate++;
  const sellerId = r.seller_norm ? sellerMap[r.seller_norm] : null;
  if (!sellerId) noSeller++;
  const ds = daysSince(date, todayISO), nextOrder = addDays(date, cycleDays);
  const prior = byName.get(nameNorm) || seen.get(nameNorm);
  if (prior) {
    const newer = new Date(date) > new Date(prior.last_order_at || 0);
    if (newer && prior.id !== '__pending__') {
      updates.push({ id: prior.id, date, ds, nextOrder, sellerId });
    } else { skip++; }
  } else {
    inserts.push({ name: r.name, date, ds, nextOrder, sellerId });
  }
  seen.set(nameNorm, { id: prior?.id ?? '__pending__', last_order_at: date });
}
console.log(`\n── PLANO ──\n  inserir=${inserts.length} atualizar=${updates.length} pular=${skip} | sem-data=${noDate} sem-vendedora=${noSeller}`);
console.log('  amostra insert:'); inserts.slice(0, 8).forEach((p) => console.log(`    ${p.name.slice(0, 40).padEnd(40)} ${p.date.slice(0, 10)} seller=${p.sellerId ? 'ok' : '—'}`));

if (!EXECUTE) { console.log('\nDRY-RUN: nada escrito. Rode com --execute.'); process.exit(0); }

// 4) executar em UMA transação (script multi-statement roda atômico no endpoint)
console.log('\n⚠️ EXECUTANDO em PROD…');
const stmts = ['BEGIN;'];
for (const u of updates) {
  stmts.push(
    `UPDATE upsell_clients SET last_order_at=${lit(u.date)}, first_sale_at=LEAST(first_sale_at, ${lit(u.date)}), ` +
    `days_since_last_order=${u.ds}, reorder_cycle_days=${cycleDays}, next_order_expected=${lit(u.nextOrder)}, ` +
    (u.sellerId ? `responsible_id=${lit(u.sellerId)}, closer_id=${lit(u.sellerId)}, sale_responsible_id=${lit(u.sellerId)}, ` : '') +
    `updated_at=now() WHERE id=${lit(u.id)};`,
  );
  if (u.sellerId) stmts.push(`UPDATE leads SET responsible_id=${lit(u.sellerId)}, closer_id=${lit(u.sellerId)}, sale_responsible_id=${lit(u.sellerId)} WHERE id=(SELECT lead_id FROM upsell_clients WHERE id=${lit(u.id)});`);
}
for (const p of inserts) {
  const sid = p.sellerId ? lit(p.sellerId) : 'NULL';
  stmts.push(
    `WITH l AS (INSERT INTO leads (organization_id, name, origin, responsible_id, closer_id, sale_responsible_id) ` +
    `VALUES (${lit(orgId)}, ${lit(p.name)}, 'outro', ${sid}, ${sid}, ${sid}) RETURNING id) ` +
    `INSERT INTO upsell_clients (organization_id, lead_id, name, potencial, first_sale_at, last_order_at, ` +
    `days_since_last_order, reorder_cycle_days, next_order_expected, health_score, health_status, segment, order_count, ` +
    `responsible_id, closer_id, sale_responsible_id) ` +
    `SELECT ${lit(orgId)}, l.id, ${lit(p.name)}, 'medio', ${lit(p.date)}, ${lit(p.date)}, ${p.ds}, ${cycleDays}, ` +
    `${lit(p.nextOrder)}, 70, 'atencao', 'novo', 0, ${sid}, ${sid}, ${sid} FROM l;`,
  );
}
stmts.push('COMMIT;');
await q(stmts.join('\n'));

const cnt = (await q(`SELECT COUNT(*)::int n, COUNT(last_order_at)::int wd FROM upsell_clients WHERE organization_id=${lit(orgId)}`))[0];
console.log(`\n✅ OK. Carteira basicforu: ${cnt.n} clientes, ${cnt.wd} com última compra.`);
console.log('Cron patchado recalcula health/overdue na próxima rodada (ou dispare manual).');
