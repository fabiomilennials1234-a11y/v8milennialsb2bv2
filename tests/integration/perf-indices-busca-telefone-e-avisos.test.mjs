// Perf onda 1 — os índices de `20271123000000` aplicam, são idempotentes e
// mudam o plano das duas consultas que motivaram a migration. Cada asserção
// "depois" tem o controle "antes" (sem a migration o plano é outro), senão
// um verde aqui não distingue índice útil de índice ignorado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const migration = readFileSync(
  new URL('../../supabase/migrations/20271123000000_perf_indices_busca_telefone_e_avisos.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../../supabase/migrations/rollback/20271123000000_perf_indices_busca_telefone_e_avisos.sql', import.meta.url),
  'utf8',
);

const ORG = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-0000000000aa';

async function novoBanco() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    CREATE EXTENSION pg_trgm WITH SCHEMA public;

    -- lead_phones como em 20271112000000 (só o que o plano enxerga).
    CREATE TABLE public.lead_phones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      lead_id uuid NOT NULL,
      normalized_phone text,
      deleted_at timestamptz
    );
    CREATE INDEX lead_phones_org_normalized_idx
      ON public.lead_phones (organization_id, normalized_phone) WHERE deleted_at IS NULL;
    -- 70 mil linhas em 20 orgs, números BR de 13 dígitos (55 + DDD + 9 + 8).
    INSERT INTO public.lead_phones (organization_id, lead_id, normalized_phone, deleted_at)
    SELECT ('00000000-0000-0000-0000-' || lpad((1 + i % 20)::text, 12, '0'))::uuid,
           gen_random_uuid(),
           '55' || (11 + (i * 7) % 89)::text || '9' || lpad(((i::bigint * 2654435761) % 100000000)::text, 8, '0'),
           CASE WHEN i % 15 = 0 THEN now() END
    FROM generate_series(1, 70000) i;
    ANALYZE public.lead_phones;

    -- notifications com o índice de 20260831200000 (read_at no meio).
    CREATE TABLE public.notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      user_id uuid NOT NULL,
      read_at timestamptz,
      last_event_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX notifications_recipient_org_unread_idx
      ON public.notifications (user_id, organization_id, read_at, last_event_at DESC);
    INSERT INTO public.notifications (organization_id, user_id, read_at, last_event_at)
    SELECT '${ORG}'::uuid,
           ('00000000-0000-0000-0000-' || lpad((170 + i % 40)::text, 12, '0'))::uuid,
           CASE WHEN i % 3 = 0 THEN NULL ELSE now() - (i || ' minutes')::interval END,
           CASE WHEN i % 50 = 0 THEN NULL ELSE now() - (i || ' seconds')::interval END
    FROM generate_series(1, 40000) i;
    INSERT INTO public.notifications (organization_id, user_id, read_at, last_event_at)
    SELECT '${ORG}'::uuid, '${USER}'::uuid,
           CASE WHEN i % 3 = 0 THEN NULL ELSE now() END,
           now() - (i || ' seconds')::interval
    FROM generate_series(1, 3000) i;
    ANALYZE public.notifications;
  `);
  return db;
}

const plano = async (db, sql) =>
  (await db.query(`EXPLAIN ${sql}`)).rows.map((r) => r['QUERY PLAN']).join('\n');

// A pré-consulta de `buscarLeadIdsPorTelefoneSecundario`, como o PostgREST a monta.
const buscaSecundaria = (digits) => `
  SELECT lead_id FROM public.lead_phones
  WHERE organization_id = '00000000-0000-0000-0000-000000000003'
    AND deleted_at IS NULL AND normalized_phone ILIKE '%${digits}%'
  LIMIT 200`;

// A consulta do sino (`useAvisos`).
const sino = `
  SELECT id FROM public.notifications
  WHERE user_id = '${USER}' AND organization_id = '${ORG}'
  ORDER BY last_event_at DESC NULLS LAST LIMIT 50`;

test('migration aplica duas vezes (idempotente) e o rollback desfaz', async () => {
  const db = await novoBanco();
  try {
    // `SET LOCAL lock_timeout` vale só dentro da transação da migration.
    assert.match(migration, /SET LOCAL lock_timeout = '3s';/);
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query('SHOW lock_timeout')).rows[0].lock_timeout, '0', 'lock_timeout não vaza da migration');
    const nomes = async () => (await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('lead_phones_normalized_phone_trgm_idx', 'notifications_recipient_org_recent_idx')
      ORDER BY 1`)).rows.map((r) => r.indexname);
    assert.deepEqual(await nomes(), ['lead_phones_normalized_phone_trgm_idx', 'notifications_recipient_org_recent_idx']);
    await db.exec(rollback);
    assert.deepEqual(await nomes(), []);
    // O antigo continua — esta migration não o remove.
    const antigo = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'notifications_recipient_org_unread_idx'`);
    assert.equal(antigo.rows.length, 1);
  } finally { await db.close(); }
});

test('busca "contém" em lead_phones passa a usar o trigrama, com o mesmo resultado', async () => {
  const db = await novoBanco();
  try {
    // Um número que existe, para o resultado não ser trivialmente vazio.
    const alvo = (await db.query(`
      SELECT normalized_phone FROM public.lead_phones
      WHERE organization_id = '00000000-0000-0000-0000-000000000003' AND deleted_at IS NULL
      ORDER BY id LIMIT 1`)).rows[0].normalized_phone;
    const onze = alvo.slice(2);

    const antes = await plano(db, buscaSecundaria(onze));
    assert.doesNotMatch(antes, /trgm/, 'controle: sem a migration não há trigrama no plano');
    const linhasAntes = (await db.query(buscaSecundaria(onze))).rows;

    await db.exec(migration);
    const depois = await plano(db, buscaSecundaria(onze));
    assert.match(depois, /lead_phones_normalized_phone_trgm_idx/, depois);
    const linhasDepois = (await db.query(buscaSecundaria(onze))).rows;
    assert.ok(linhasDepois.length >= 1);
    assert.deepEqual(
      linhasDepois.map((r) => r.lead_id).sort(),
      linhasAntes.map((r) => r.lead_id).sort(),
      'semântica "contém" intacta',
    );
  } finally { await db.close(); }
});

test('o sino deixa de ordenar: o índice novo entrega a ordem e para em 50', async () => {
  const db = await novoBanco();
  try {
    const antes = await plano(db, sino);
    assert.match(antes, /Sort/, `controle: o índice antigo não serve o ORDER BY\n${antes}`);
    await db.exec(migration);
    const depois = await plano(db, sino);
    assert.match(depois, /notifications_recipient_org_recent_idx/, depois);
    assert.doesNotMatch(depois, /Sort/, depois);
  } finally { await db.close(); }
});

test('trigrama só em leads.normalized_phone não alcança o OR da lista (por isso não foi criado)', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec(`
      CREATE EXTENSION pg_trgm WITH SCHEMA public;
      CREATE TABLE public.leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
        name text, company text, email text, phone text, erp_code text, normalized_phone text
      );
      CREATE INDEX leads_org ON public.leads (organization_id);
      INSERT INTO public.leads (organization_id, name, company, email, phone, erp_code, normalized_phone)
      SELECT ('00000000-0000-0000-0000-' || lpad((1 + i % 20)::text, 12, '0'))::uuid,
             'Lead ' || i, 'Empresa ' || i, 'l' || i || '@x.com', '(11) 9' || i, i::text,
             '5511' || lpad(((i::bigint * 2654435761) % 1000000000)::text, 9, '0')
      FROM generate_series(1, 30000) i;
      CREATE INDEX leads_normalized_phone_trgm_teste ON public.leads USING gin (normalized_phone public.gin_trgm_ops);
      ANALYZE public.leads;
      SET enable_seqscan = off;
    `);
    const sozinho = await plano(db, `SELECT id FROM public.leads WHERE normalized_phone ILIKE '%11987654321%'`);
    assert.match(sozinho, /leads_normalized_phone_trgm_teste/, 'controle: sozinho o braço usa o índice');
    const lista = await plano(db, `
      SELECT id FROM public.leads
      WHERE organization_id = '00000000-0000-0000-0000-000000000003'
        AND (name ILIKE '%11987654321%' OR company ILIKE '%11987654321%' OR email ILIKE '%11987654321%'
             OR phone ILIKE '%11987654321%' OR erp_code ILIKE '%11987654321%'
             OR normalized_phone ILIKE '%11987654321%')`);
    assert.doesNotMatch(lista, /leads_normalized_phone_trgm_teste/, lista);
  } finally { await db.close(); }
});
