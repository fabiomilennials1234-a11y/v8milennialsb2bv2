import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../../supabase/migrations/20271115000000_whatsapp_unarchive_on_inbound.sql', import.meta.url),
  'utf8',
);

const ORG = '00000000-0000-0000-0000-0000000000a1';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000a2';
const INST = '00000000-0000-0000-0000-0000000000b1';
const OTHER_INST = '00000000-0000-0000-0000-0000000000b2';
const PHONE = '5511999990000';
const ARCHIVED_AT = '2027-01-01T12:00:00Z';
const AFTER = '2027-01-01T12:05:00Z';
const BEFORE = '2027-01-01T11:55:00Z';

// Esqueleto com as colunas reais de prod (information_schema, 09/10) que o
// gatilho lê. `riofix_reabrir_conversa_arquivada` é um dublê que registra
// quantas linhas o UPDATE DELE reabriu — a prova de que a ordem alfabética
// mantém o workflow da Riofix vivo.
async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.whatsapp_conversations(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL, instance_id uuid NOT NULL,
      phone_number text NOT NULL, normalized_phone text,
      archived_at timestamptz, deleted_at timestamptz,
      UNIQUE (instance_id, phone_number)
    );
    CREATE INDEX idx_whatsapp_conversations_org ON public.whatsapp_conversations (organization_id);
    CREATE INDEX idx_whatsapp_conversations_state ON public.whatsapp_conversations (instance_id, deleted_at, archived_at);
    CREATE INDEX idx_whatsapp_conversations_normalized_phone
      ON public.whatsapp_conversations (organization_id, instance_id, normalized_phone)
      WHERE normalized_phone IS NOT NULL;
    CREATE TABLE public.whatsapp_messages(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL, instance_id uuid,
      phone_number text NOT NULL, normalized_phone text,
      remote_jid text NOT NULL, direction text NOT NULL,
      received_via text NOT NULL DEFAULT 'webhook',
      is_group boolean NOT NULL DEFAULT false,
      edited boolean NOT NULL DEFAULT false,
      deleted_at timestamptz, "timestamp" timestamptz NOT NULL
    );
    GRANT INSERT, SELECT ON public.whatsapp_messages TO authenticated;
    GRANT SELECT ON public.whatsapp_conversations TO authenticated;

    CREATE SCHEMA private;
    CREATE TABLE public.riofix_log(reopened int);
    CREATE FUNCTION private.riofix_stub() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    DECLARE n int;
    BEGIN
      WITH c AS (
        UPDATE public.whatsapp_conversations SET archived_at = NULL
         WHERE organization_id = NEW.organization_id AND instance_id = NEW.instance_id
           AND normalized_phone = NEW.normalized_phone AND deleted_at IS NULL
           AND archived_at IS NOT NULL AND archived_at <= NEW."timestamp"
        RETURNING 1)
      SELECT count(*) INTO n FROM c;
      INSERT INTO public.riofix_log VALUES (n);
      RETURN NEW;
    END $$;
    CREATE TRIGGER riofix_reabrir_conversa_arquivada AFTER INSERT ON public.whatsapp_messages
      FOR EACH ROW WHEN (NEW.organization_id = '${OTHER_ORG}'::uuid AND NEW.direction = 'incoming')
      EXECUTE FUNCTION private.riofix_stub();
  `);
  await db.exec(migration);
  return db;
}

async function seedConversation(db, { org = ORG, inst = INST, phone = PHONE, archivedAt = ARCHIVED_AT, deletedAt = null } = {}) {
  const { rows } = await db.query(
    `INSERT INTO public.whatsapp_conversations(organization_id, instance_id, phone_number, normalized_phone, archived_at, deleted_at)
     VALUES ($1, $2, $3, $3, $4, $5) RETURNING id`,
    [org, inst, phone, archivedAt, deletedAt],
  );
  return rows[0].id;
}

function insertMessage(db, overrides = {}) {
  const m = {
    org: ORG, inst: INST, phone: PHONE, jid: `${PHONE}@s.whatsapp.net`, direction: 'incoming',
    via: 'webhook', isGroup: false, edited: false, deletedAt: null, ts: AFTER, ...overrides,
  };
  return db.query(
    `INSERT INTO public.whatsapp_messages(organization_id, instance_id, phone_number, normalized_phone, remote_jid,
       direction, received_via, is_group, edited, deleted_at, "timestamp")
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [m.org, m.inst, m.phone, m.jid, m.direction, m.via, m.isGroup, m.edited, m.deletedAt, m.ts],
  );
}

async function archivedAt(db, id) {
  const { rows } = await db.query('SELECT archived_at FROM public.whatsapp_conversations WHERE id = $1', [id]);
  return rows[0].archived_at;
}

test('incoming message unarchives the conversation, even when inserted by a role without UPDATE', async () => {
  const db = await freshDb();
  try {
    const id = await seedConversation(db);
    await db.exec('SET ROLE authenticated');
    await insertMessage(db);
    await db.exec('RESET ROLE');
    assert.equal(await archivedAt(db, id), null);
  } finally { await db.close(); }
});

test('incoming at exactly archived_at unarchives (>=, same as the front predicate)', async () => {
  const db = await freshDb();
  try {
    const id = await seedConversation(db);
    await insertMessage(db, { ts: ARCHIVED_AT });
    assert.equal(await archivedAt(db, id), null);
  } finally { await db.close(); }
});

for (const [name, overrides] of [
  ['outgoing', { direction: 'outgoing' }],
  ['group flag', { isGroup: true }],
  ['group jid without flag', { jid: '120363000000000000@g.us' }],
  ['history_sync', { via: 'history_sync' }],
  ['edited', { edited: true }],
  ['deleted', { deletedAt: AFTER }],
  ['message older than the archive', { ts: BEFORE }],
]) {
  test(`${name} keeps the conversation archived`, async () => {
    const db = await freshDb();
    try {
      const id = await seedConversation(db);
      await insertMessage(db, overrides);
      assert.notEqual(await archivedAt(db, id), null);
    } finally { await db.close(); }
  });
}

test('only the matching (org, instance, phone) row is touched; deleted conversation stays as is', async () => {
  const db = await freshDb();
  try {
    const target = await seedConversation(db);
    const otherInst = await seedConversation(db, { inst: OTHER_INST });
    const otherOrg = await seedConversation(db, { org: OTHER_ORG, inst: '00000000-0000-0000-0000-0000000000b3' });
    const otherPhone = await seedConversation(db, { phone: '5511888880000' });
    await insertMessage(db);
    assert.equal(await archivedAt(db, target), null);
    for (const id of [otherInst, otherOrg, otherPhone]) assert.notEqual(await archivedAt(db, id), null);

    const deleted = await seedConversation(db, { phone: '5511777770000', deletedAt: ARCHIVED_AT });
    await insertMessage(db, { phone: '5511777770000', jid: '5511777770000@s.whatsapp.net' });
    assert.notEqual(await archivedAt(db, deleted), null);
  } finally { await db.close(); }
});

test('an internal failure never aborts the message INSERT', async () => {
  const db = await freshDb();
  try {
    const id = await seedConversation(db);
    await db.exec(`
      CREATE FUNCTION public.boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure' USING ERRCODE = '40001'; END $$;
      CREATE TRIGGER boom BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.boom();
    `);
    const { rows } = await insertMessage(db);
    assert.equal(rows.length, 1);
    const persisted = await db.query('SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE id = $1', [rows[0].id]);
    assert.equal(persisted.rows[0].n, 1);
    assert.notEqual(await archivedAt(db, id), null, 'failed unarchive is rolled back, message kept');
  } finally { await db.close(); }
});

// Volta 2 (F1): falha de LEITURA/PLANEJAMENTO de whatsapp_conversations (drift
// de coluna = 42703; em prod, lock_timeout com AccessExclusive pendente =
// 55P03) também tem de virar WARNING. Qualquer acesso à tabela FORA do bloco
// EXCEPTION — como a guarda `IF NOT EXISTS (SELECT …)` da volta 1 — faz este
// teste ficar vermelho (controle positivo verificado reinserindo a guarda).
for (const [coluna, nova] of [['archived_at', 'archived_at_x'], ['normalized_phone', 'normalized_phone_x']]) {
  test(`schema drift (${coluna} renomeada) never aborts the inbound INSERT, even for a NON-archived conversation`, async () => {
    const db = await freshDb();
    try {
      await seedConversation(db, { archivedAt: null });
      await db.exec(`ALTER TABLE public.whatsapp_conversations RENAME COLUMN ${coluna} TO ${nova}`);
      const notices = [];
      const m = { phone: PHONE, ts: AFTER };
      const { rows } = await db.query(
        `INSERT INTO public.whatsapp_messages(organization_id, instance_id, phone_number, normalized_phone, remote_jid,
           direction, received_via, is_group, edited, deleted_at, "timestamp")
         VALUES ($1, $2, $3, $3, $4, 'incoming', 'webhook', false, false, NULL, $5) RETURNING id`,
        [ORG, INST, m.phone, `${m.phone}@s.whatsapp.net`, m.ts],
        { onNotice: (n) => notices.push(n) },
      );
      assert.equal(rows.length, 1);
      const persisted = await db.query('SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE id = $1', [rows[0].id]);
      assert.equal(persisted.rows[0].n, 1, 'message must persist');
      assert.ok(
        notices.some((n) => n.severity === 'WARNING' && /unarchive_conversation_on_inbound/.test(n.message) && /42703/.test(n.message)),
        `expected WARNING with SQLSTATE 42703, got ${JSON.stringify(notices.map((n) => n.message))}`,
      );
    } finally { await db.close(); }
  });
}

test('fires after the Riofix trigger, which still sees its own reopen', async () => {
  const db = await freshDb();
  try {
    const { rows } = await db.query(`
      SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'public.whatsapp_messages'::regclass AND NOT tgisinternal ORDER BY tgname`);
    assert.deepEqual(rows.map(r => r.tgname), ['riofix_reabrir_conversa_arquivada', 'trg_unarchive_on_inbound']);

    const id = await seedConversation(db, { org: OTHER_ORG });
    await insertMessage(db, { org: OTHER_ORG });
    assert.equal(await archivedAt(db, id), null);
    const log = await db.query('SELECT reopened FROM public.riofix_log');
    assert.deepEqual(log.rows, [{ reopened: 1 }]);
  } finally { await db.close(); }
});

test('function is not executable by any API role and the migration is re-runnable', async () => {
  const db = await freshDb();
  try {
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      const r = role === 'public'
        ? await db.query(`SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS ok
             FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = 'private.unarchive_conversation_on_inbound'::regproc`)
        : await db.query(`SELECT has_function_privilege($1, 'private.unarchive_conversation_on_inbound()', 'EXECUTE') AS ok`, [role]);
      assert.equal(Boolean(r.rows[0].ok), false, `${role} can EXECUTE`);
    }
    const defn = await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'private.unarchive_conversation_on_inbound'::regproc`);
    assert.equal(defn.rows[0].prosecdef, true);
    assert.deepEqual(defn.rows[0].proconfig, ['search_path=""']);

    await db.exec(migration);
    const count = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_unarchive_on_inbound'`);
    assert.equal(count.rows[0].n, 1);
    const id = await seedConversation(db);
    await insertMessage(db);
    assert.equal(await archivedAt(db, id), null);
  } finally { await db.close(); }
});

test('UPDATE plan (generic, as plpgsql runs it) uses the normalized_phone index', async () => {
  const db = await freshDb();
  try {
    await db.exec(`
      INSERT INTO public.whatsapp_conversations(organization_id, instance_id, phone_number, normalized_phone, archived_at)
      SELECT ('00000000-0000-0000-0000-' || lpad((i % 60)::text, 12, '0'))::uuid,
             ('00000000-0000-0000-0001-' || lpad((i % 120)::text, 12, '0'))::uuid,
             (5500000000000 + i)::text, (5500000000000 + i)::text,
             CASE WHEN i % 50 = 0 THEN now() END
        FROM generate_series(1, 50000) i;
      ANALYZE public.whatsapp_conversations;
      SET plan_cache_mode = force_generic_plan;
      PREPARE u(uuid, uuid, text, timestamptz) AS
        UPDATE public.whatsapp_conversations c SET archived_at = NULL
         WHERE c.organization_id = $1 AND c.instance_id = $2 AND c.normalized_phone = $3
           AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL AND c.archived_at <= $4;
    `);
    const { rows } = await db.query(
      `EXPLAIN EXECUTE u('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', '5500000000001', now())`,
    );
    const plan = rows.map(r => r['QUERY PLAN']).join('\n');
    assert.match(plan, /idx_whatsapp_conversations_normalized_phone/);
  } finally { await db.close(); }
});
