import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../../supabase/migrations/20271122000000_feature_suggestions_first_run.sql', import.meta.url),
  'utf8',
);

const userA = '00000000-0000-0000-0000-00000000000a';
const userB = '00000000-0000-0000-0000-00000000000b';
const master = '00000000-0000-0000-0000-00000000000f';
const orgA = '00000000-0000-0000-0000-0000000000a1';
const orgB = '00000000-0000-0000-0000-0000000000b1';
const KEY = 'feature_suggestions_2026_10';

/**
 * Mesmo SQL que o PostgREST gera para `supabase.from(t).insert(obj)` (return=minimal):
 * só as chaves do payload entram na lista de colunas; as demais caem no DEFAULT.
 * É isto que prova o item `Aberto` do CP: grant por coluna + payload sem user_id passa.
 */
function postgrestInsert(db, table, payload) {
  const cols = Object.keys(payload).map((c) => `"${c}"`).join(', ');
  return db.query(
    `INSERT INTO public.${table} (${cols})
       SELECT ${cols} FROM json_populate_recordset(NULL::public.${table}, $1::json)`,
    [JSON.stringify([payload])],
  );
}

async function as(db, role, uid) {
  await db.exec(`RESET ROLE; SET test.uid='${uid ?? ''}'; SET ROLE ${role};`);
}

async function codeOf(promise) {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error.code ?? String(error.message);
  }
}

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;

    CREATE TABLE public.organizations (id uuid PRIMARY KEY);
    CREATE TABLE public.memberships (user_id uuid, organization_id uuid);
    CREATE TABLE public.master_users (user_id uuid);

    -- Stubs dos helpers DEFINER reais (mesma assinatura).
    CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT organization_id FROM public.memberships WHERE user_id = auth.uid() $$;
    CREATE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT EXISTS (SELECT 1 FROM public.master_users WHERE user_id = _user_id) $$;

    INSERT INTO auth.users VALUES ('${userA}'), ('${userB}'), ('${master}');
    INSERT INTO public.organizations VALUES ('${orgA}'), ('${orgB}');
    INSERT INTO public.memberships VALUES ('${userA}', '${orgA}'), ('${userB}', '${orgB}');
    INSERT INTO public.master_users VALUES ('${master}');

    -- O que o seed de roles do Supabase instala: toda tabela nova nasce com ALL
    -- para anon/authenticated. A migration precisa desfazer isso sozinha.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;

    -- Controle positivo: tabela criada sob o mesmo default, SEM REVOKE.
    CREATE TABLE public.default_privileges_control (id int);
  `);
  await db.exec(migration);
  return db;
}

async function acl(db, table) {
  const { rows } = await db.query(
    `SELECT
       has_table_privilege('anon', $1, 'SELECT') AS anon_select,
       has_table_privilege('anon', $1, 'INSERT') AS anon_insert,
       has_table_privilege('anon', $1, 'DELETE') AS anon_delete,
       has_any_column_privilege('anon', $1, 'INSERT') AS anon_any_insert,
       has_table_privilege('authenticated', $1, 'SELECT') AS auth_select,
       has_table_privilege('authenticated', $1, 'INSERT') AS auth_insert_table,
       has_table_privilege('authenticated', $1, 'UPDATE') AS auth_update_table,
       has_table_privilege('authenticated', $1, 'DELETE') AS auth_delete,
       has_table_privilege('authenticated', $1, 'TRUNCATE') AS auth_truncate,
       has_table_privilege('service_role', $1, 'DELETE') AS service_delete`,
    [table],
  );
  return rows[0];
}

async function colPriv(db, table, column, privilege) {
  const { rows } = await db.query(
    `SELECT has_column_privilege('authenticated', $1, $2, $3) AS ok`,
    [table, column, privilege],
  );
  return rows[0].ok;
}

test('ACL: default privileges do Supabase são neutralizados (com controle positivo)', async () => {
  const db = await setup();
  try {
    const control = await acl(db, 'public.default_privileges_control');
    assert.equal(control.anon_delete, true, 'controle positivo: o default privilege do harness concede ALL a anon');
    assert.equal(control.auth_delete, true);

    for (const table of ['public.user_prompt_impressions', 'public.feature_suggestions']) {
      const got = await acl(db, table);
      assert.equal(got.anon_select, false, `${table}: anon sem SELECT`);
      assert.equal(got.anon_any_insert, false, `${table}: anon sem INSERT em coluna alguma`);
      assert.equal(got.anon_delete, false);
      assert.equal(got.auth_select, true);
      assert.equal(got.auth_insert_table, false, `${table}: INSERT só por coluna`);
      assert.equal(got.auth_update_table, false, `${table}: UPDATE só por coluna`);
      assert.equal(got.auth_delete, false, `${table}: authenticated sem DELETE`);
      assert.equal(got.auth_truncate, false);
      assert.equal(got.service_delete, true, `${table}: service_role com ALL`);
    }

    const upi = 'public.user_prompt_impressions';
    assert.equal(await colPriv(db, upi, 'prompt_key', 'INSERT'), true);
    assert.equal(await colPriv(db, upi, 'user_id', 'INSERT'), false);
    assert.equal(await colPriv(db, upi, 'outcome', 'INSERT'), false);
    assert.equal(await colPriv(db, upi, 'seen_at', 'INSERT'), false);
    assert.equal(await colPriv(db, upi, 'outcome', 'UPDATE'), true);
    assert.equal(await colPriv(db, upi, 'user_id', 'UPDATE'), false);
    assert.equal(await colPriv(db, upi, 'prompt_key', 'UPDATE'), false);
    assert.equal(await colPriv(db, upi, 'seen_at', 'UPDATE'), false);

    const fs = 'public.feature_suggestions';
    for (const column of ['organization_id', 'kind', 'body']) {
      assert.equal(await colPriv(db, fs, column, 'INSERT'), true, `fs.${column} INSERT`);
    }
    for (const column of ['id', 'user_id', 'source', 'created_at']) {
      assert.equal(await colPriv(db, fs, column, 'INSERT'), false, `fs.${column} sem INSERT`);
    }
    for (const column of ['organization_id', 'kind', 'body', 'user_id', 'source']) {
      assert.equal(await colPriv(db, fs, column, 'UPDATE'), false, `fs.${column} sem UPDATE`);
    }

    const { rows: rls } = await db.query(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('user_prompt_impressions', 'feature_suggestions') ORDER BY relname`,
    );
    assert.deepEqual(rls.map((r) => r.relrowsecurity), [true, true]);

    const { rows: uniq } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.feature_suggestions'::regclass AND contype = 'u'`,
    );
    assert.deepEqual(uniq.map((r) => r.def), ['UNIQUE (user_id, source)'], 'UNIQUE começa por user_id: serve ao cascade');

    const { rows: fns } = await db.query(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname NOT IN ('get_my_organization_ids', 'is_master_user')`,
    );
    assert.equal(fns[0].n, 0, 'migration não cria função');
  } finally {
    await db.close();
  }
});

test('user_prompt_impressions: claim atômico, dono por DEFAULT, outcome write-once', async () => {
  const db = await setup();
  try {
    await as(db, 'authenticated', userA);

    // Payload do supabase-js: só prompt_key. user_id vem de DEFAULT auth.uid().
    assert.equal(await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: KEY })), 'ok');
    const { rows: own } = await db.query('SELECT user_id, prompt_key, outcome FROM public.user_prompt_impressions');
    assert.deepEqual(own, [{ user_id: userA, prompt_key: KEY, outcome: null }]);

    // Segunda aba/device: 23505 = já visto → não mostra.
    assert.equal(await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: KEY })), '23505');

    // Forjar dono ou desfecho no payload: sem grant na coluna.
    assert.equal(
      await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: KEY, user_id: userB })),
      '42501',
    );
    assert.equal(
      await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: KEY, outcome: 'submitted' })),
      '42501',
    );
    // Allowlist: chave fora da lista não cria linha (sem spam de impressões pela API).
    for (const key of ['other_key', 'feature_suggestions_2026_11', 'Bad-Key!', 'ab']) {
      assert.equal(await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: key })), '23514', key);
    }

    // Outcome: NULL → dismissed uma vez; depois não muda mais.
    const upd = (outcome, uid = userA) =>
      db.query(
        'UPDATE public.user_prompt_impressions SET outcome = $1 WHERE user_id = $2 AND prompt_key = $3 RETURNING outcome',
        [outcome, uid, KEY],
      );
    assert.equal((await upd('dismissed')).rows.length, 1);
    assert.equal((await upd('submitted')).rows.length, 0, 'write-once: linha com outcome não é mais alvo');
    assert.equal(await codeOf(upd('bogus')), 'ok', 'linha resolvida nem é alvo; CHECK não chega a rodar');
    assert.equal(
      (await db.query('SELECT outcome FROM public.user_prompt_impressions')).rows[0].outcome,
      'dismissed',
    );
    assert.equal(
      await codeOf(db.query('UPDATE public.user_prompt_impressions SET seen_at = now() WHERE prompt_key = $1', [KEY])),
      '42501',
    );
    assert.equal(
      await codeOf(db.query('DELETE FROM public.user_prompt_impressions WHERE prompt_key = $1', [KEY])),
      '42501',
      'apagar reabriria o prompt',
    );

    // B: não vê A, não mexe em A, e voltar o desfecho para NULL viola o CHECK da policy.
    await as(db, 'authenticated', userB);
    assert.equal((await db.query('SELECT * FROM public.user_prompt_impressions')).rows.length, 0);
    assert.equal((await upd('submitted', userA)).rows.length, 0);
    assert.equal(await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: KEY })), 'ok');
    assert.equal(await codeOf(upd(null, userB)), '42501', 'WITH CHECK exige outcome não nulo');
    assert.equal(await codeOf(upd('bogus', userB)), '23514');
    assert.equal((await upd('submitted', userB)).rows.length, 1);

    // Sem sessão (authenticated sem claim): dono NULL não entra.
    await as(db, 'authenticated', null);
    assert.notEqual(await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: 'no_session' })), 'ok');

    // anon: nada.
    await as(db, 'anon', null);
    assert.equal(await codeOf(db.query('SELECT * FROM public.user_prompt_impressions')), '42501');
    assert.equal(await codeOf(postgrestInsert(db, 'user_prompt_impressions', { prompt_key: KEY })), '42501');

    // Master lê tudo, não escreve por ninguém.
    await as(db, 'authenticated', master);
    assert.equal((await db.query('SELECT * FROM public.user_prompt_impressions')).rows.length, 2);
    assert.equal((await upd('submitted', userA)).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('feature_suggestions: insert só na própria org, uma por usuário, sem edição', async () => {
  const db = await setup();
  try {
    await as(db, 'authenticated', userA);
    const send = (payload) => postgrestInsert(db, 'feature_suggestions', payload);

    // Payload do supabase-js: organization_id, kind, body. Dono e source por DEFAULT.
    assert.equal(
      await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'Disparo por etapa no WhatsApp' })),
      'ok',
    );
    const { rows } = await db.query('SELECT user_id, organization_id, kind, source FROM public.feature_suggestions');
    assert.deepEqual(rows, [{ user_id: userA, organization_id: orgA, kind: 'feature', source: 'first_run_prompt' }]);

    // Anti-spam: a segunda do mesmo usuário cai no UNIQUE (user_id, source) (o front trata como sucesso).
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'other', body: 'Outra ideia aqui' })), '23505');

    // Cross-tenant: org de que não é membro.
    await db.exec('RESET ROLE');
    await db.exec(`DELETE FROM public.feature_suggestions`);
    await as(db, 'authenticated', userA);
    assert.equal(await codeOf(send({ organization_id: orgB, kind: 'feature', body: 'Invasão de org' })), '42501');

    // Forjar dono/source: sem grant na coluna.
    assert.equal(
      await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'Forjado', user_id: userB })),
      '42501',
    );
    assert.equal(
      await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'Forjado', source: 'first_run_prompt' })),
      '42501',
    );

    // CHECKs: tipo e tamanho (btrim conta).
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'bug', body: 'Tipo errado' })), '23514');
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'ab' })), '23514');
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'x'.repeat(1001) })), '23514');
    // Texto cru: padding de espaços não escapa do limite, e borda com espaço é recusada.
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'abc' + ' '.repeat(2000) })), '23514');
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: '  abc' })), '23514');
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'abc  ' })), '23514');
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'abc' + '\n'.repeat(2000) })), '23514');
    // Só whitespace não-espaço e borda com \n/\t: btrim não pega, a classe [:space:] pega.
    for (const body of ['\n\n\n', '\t\t\t', '\r\n\r', 'abc\n', '\nabc', 'abc\t', '\tabc']) {
      assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body })), '23514', JSON.stringify(body));
    }
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'x'.repeat(1000) })), 'ok');
    // Espaço/quebra no MEIO é texto normal.
    await db.exec('RESET ROLE');
    await db.exec('DELETE FROM public.feature_suggestions');
    await as(db, 'authenticated', userA);
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'a b c' })), 'ok');
    await db.exec('RESET ROLE');
    await db.exec('DELETE FROM public.feature_suggestions');
    await as(db, 'authenticated', userA);
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'linha 1\n\nlinha 2' })), 'ok');

    // Sem UPDATE/DELETE.
    assert.equal(await codeOf(db.query(`UPDATE public.feature_suggestions SET body = 'editado'`)), '42501');
    assert.equal(await codeOf(db.query('DELETE FROM public.feature_suggestions')), '42501');

    // B: não lê a de A; envia na própria org.
    await as(db, 'authenticated', userB);
    assert.equal((await db.query('SELECT * FROM public.feature_suggestions')).rows.length, 0);
    assert.equal(await codeOf(send({ organization_id: orgB, kind: 'integration', body: 'Integração com Omie' })), 'ok');
    assert.equal((await db.query('SELECT * FROM public.feature_suggestions')).rows.length, 1);

    // anon: nada.
    await as(db, 'anon', null);
    assert.equal(await codeOf(db.query('SELECT * FROM public.feature_suggestions')), '42501');
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'Anônimo' })), '42501');

    // Master lê tudo; sem org própria não insere.
    await as(db, 'authenticated', master);
    assert.equal((await db.query('SELECT * FROM public.feature_suggestions')).rows.length, 2);
    assert.equal(await codeOf(send({ organization_id: orgA, kind: 'feature', body: 'Master escrevendo' })), '42501');
  } finally {
    await db.close();
  }
});
