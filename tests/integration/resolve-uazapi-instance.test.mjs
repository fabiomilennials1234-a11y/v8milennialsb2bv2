// resolve_uazapi_instance + count_exhausted_uazapi_dlq_by_token em PGlite.
// Postgres em memória com esqueleto das colunas de prod; sem Docker, sem branch.
// Rodar: node --test tests/integration/resolve-uazapi-instance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIGRATION = '../../supabase/migrations/20271107100000_resolve_uazapi_instance_rpc.sql';
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ORG_A = id(100);
const ORG_B = id(200);
// Valores de teste fabricados — não são tokens reais.
const TOKEN_A = 'fixture-token-a';
const TOKEN_B = 'fixture-token-b';
const TOKEN_DUP = 'fixture-token-dup';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE ROLE intruder NOLOGIN;
    CREATE SCHEMA auth;
    -- Mesma semântica de auth.role() do Supabase: lê a claim do PostgREST.
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
      )::text $$;
    GRANT USAGE ON SCHEMA auth TO PUBLIC;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, intruder;
    -- Reproduz o default privilege de prod: função nova nasce com EXECUTE
    -- NOMINAL para os três papéis. O REVOKE da migration precisa vencer isso.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

    CREATE TABLE whatsapp_instances (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, instance_name text NOT NULL,
      phone_number text, provider text, status text,
      UNIQUE (organization_id, instance_name));
    CREATE TABLE whatsapp_instance_secrets (
      instance_id uuid PRIMARY KEY REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
      organization_id uuid NOT NULL, uazapi_token text, uazapi_instance_id text, webhook_secret text);
    CREATE TABLE whatsapp_webhook_dlq (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reason text, resolved_at timestamptz,
      attempts integer NOT NULL DEFAULT 0, payload jsonb);
    ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE whatsapp_instance_secrets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE whatsapp_webhook_dlq ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON whatsapp_instances, whatsapp_instance_secrets, whatsapp_webhook_dlq TO service_role;
    ALTER ROLE service_role BYPASSRLS;

    -- Mesmo NOME de instância em duas orgs (existe em prod: 2 nomes repetidos).
    INSERT INTO whatsapp_instances VALUES
      ('${id(1)}', '${ORG_A}', 'Comercial', '5511900000001', 'uazapi', 'connected'),
      ('${id(2)}', '${ORG_B}', 'Comercial', '5511900000002', 'uazapi', 'connected'),
      ('${id(3)}', '${ORG_A}', 'Dup1', NULL, 'uazapi', 'connected'),
      ('${id(4)}', '${ORG_B}', 'Dup2', NULL, 'uazapi', 'connected');
    INSERT INTO whatsapp_instance_secrets VALUES
      ('${id(1)}', '${ORG_A}', '${TOKEN_A}', 'rAAA111', NULL),
      ('${id(2)}', '${ORG_B}', '${TOKEN_B}', 'rBBB222', NULL),
      ('${id(3)}', '${ORG_A}', '${TOKEN_DUP}', 'rDUP', NULL),
      ('${id(4)}', '${ORG_B}', '${TOKEN_DUP}', 'rDUP', NULL);
    INSERT INTO whatsapp_webhook_dlq (reason, resolved_at, attempts, payload) VALUES
      ('unknown_instance', NULL, 5, '{"token":"ghost"}'),
      ('unknown_instance', NULL, 9, '{"token":"ghost"}'),
      ('unknown_instance', NULL, 1, '{"token":"ghost"}'),
      ('unknown_instance', now(), 9, '{"token":"ghost"}'),
      ('missing_instance', NULL, 9, '{"token":"ghost"}'),
      ('unknown_instance', NULL, 9, '{"token":"other"}');
  `);
  await db.exec(read(MIGRATION));
  return db;
}

const asServiceRole = async (db, fn) => {
  await db.exec(`SET ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; RESET request.jwt.claim.role;`); }
};
const resolve = (db, ref, token) =>
  db.query('SELECT * FROM resolve_uazapi_instance($1, $2)', [ref, token]).then((r) => r.rows);

test('grants: anon/authenticated/PUBLIC sem EXECUTE, service_role com — apesar do default privilege', async () => {
  const db = await setup();
  try {
    for (const sig of ['resolve_uazapi_instance(text,text)', 'count_exhausted_uazapi_dlq_by_token(text,integer)']) {
      const priv = async (role) =>
        (await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig])).rows[0].ok;
      assert.equal(await priv('anon'), false, `${sig} anon`);
      assert.equal(await priv('authenticated'), false, `${sig} authenticated`);
      assert.equal(await priv('intruder'), false, `${sig} PUBLIC (papel sem grant)`);
      assert.equal(await priv('service_role'), true, `${sig} service_role`);
    }
    const resolveFn = (await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'resolve_uazapi_instance'`)).rows[0];
    assert.equal(resolveFn.prosecdef, true);
    assert.deepEqual(resolveFn.proconfig, ['search_path=public, pg_temp']);
    const countFn = (await db.query(`SELECT prosecdef FROM pg_proc WHERE proname = 'count_exhausted_uazapi_dlq_by_token'`)).rows[0];
    assert.equal(countFn.prosecdef, false);

    await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claim.role', 'anon', false);`);
    await assert.rejects(resolve(db, 'rAAA111', null), /permission denied/i);
    await db.exec('RESET ROLE');
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
    await assert.rejects(resolve(db, null, TOKEN_A), /permission denied/i);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('guarda de papel: quem consegue executar mas não é service_role recebe 42501', async () => {
  const db = await setup();
  try {
    // Superusuário (tem EXECUTE) com claim de authenticated: só a guarda barra.
    await db.exec(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`);
    await assert.rejects(resolve(db, 'rAAA111', null), (e) => e.code === '42501');
    await assert.rejects(db.query(`SELECT count_exhausted_uazapi_dlq_by_token('ghost', 5)`), (e) => e.code === '42501');
    await db.exec(`RESET request.jwt.claim.role`);
    await assert.rejects(resolve(db, 'rAAA111', null), (e) => e.code === '42501');
  } finally { await db.close(); }
});

test('precedência id > token, contrato da linha e via', async () => {
  const db = await setup();
  try {
    await asServiceRole(db, async () => {
      // id e token apontam para instâncias diferentes: id vence.
      assert.deepEqual(await resolve(db, 'rAAA111', TOKEN_B), [{
        id: id(1), organization_id: ORG_A, instance_name: 'Comercial',
        phone_number: '5511900000001', provider: 'uazapi', via: 'instance_id',
      }]);
      // id não casa (é o NOME que o payload V2 manda) → token resolve.
      assert.deepEqual(await resolve(db, 'Comercial', TOKEN_B), [{
        id: id(2), organization_id: ORG_B, instance_name: 'Comercial',
        phone_number: '5511900000002', provider: 'uazapi', via: 'token',
      }]);
      assert.equal((await resolve(db, null, TOKEN_A))[0].via, 'token');
      assert.equal((await resolve(db, '', TOKEN_A))[0].id, id(1));
    });
  } finally { await db.close(); }
});

test('nome de instância nunca resolve sozinho (nome repete entre orgs)', async () => {
  const db = await setup();
  try {
    await asServiceRole(db, async () => {
      assert.deepEqual(await resolve(db, 'Comercial', null), []);
    });
  } finally { await db.close(); }
});

test('vazio: token inexistente, entradas nulas/vazias, ambiguidade', async () => {
  const db = await setup();
  try {
    await asServiceRole(db, async () => {
      assert.deepEqual(await resolve(db, null, 'fixture-token-inexistente'), []);
      assert.deepEqual(await resolve(db, 'rNADA', 'fixture-token-inexistente'), []);
      assert.deepEqual(await resolve(db, null, null), []);
      assert.deepEqual(await resolve(db, '', ''), []);
      // Token igual em duas orgs: não escolhe nenhuma (paridade com maybeSingle).
      assert.deepEqual(await resolve(db, null, TOKEN_DUP), []);
      // id ambíguo cai para o token; token único resolve.
      assert.equal((await resolve(db, 'rDUP', TOKEN_A))[0].id, id(1));
      assert.equal((await resolve(db, 'rDUP', TOKEN_A))[0].via, 'token');
    });
  } finally { await db.close(); }
});

test('count_exhausted_uazapi_dlq_by_token: mesmo filtro do HEAD antigo', async () => {
  const db = await setup();
  try {
    await asServiceRole(db, async () => {
      const count = async (t, n) =>
        Number((await db.query('SELECT count_exhausted_uazapi_dlq_by_token($1, $2) AS n', [t, n])).rows[0].n);
      assert.equal(await count('ghost', 5), 2);
      assert.equal(await count('ghost', 10), 0);
      assert.equal(await count('nope', 5), 0);
      assert.equal(await count('', 5), 0);
      assert.equal(await count(null, 5), 0);
    });
  } finally { await db.close(); }
});
