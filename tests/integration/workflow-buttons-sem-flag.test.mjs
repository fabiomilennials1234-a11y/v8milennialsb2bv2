// WhatsApp Menu sem flag — 20271122000000_workflow_buttons_sem_flag.sql, em PGlite.
//
// O esqueleto (fixtures/workflow-buttons-baseline.sql) carrega os corpos de
// PROD de freeze_workflow_button_definition e guard_workflow_button_activation,
// presos ao md5(prosrc) lido em 2026-10-14. Provado:
//   1. red de hoje: org sem a chave tem ativação recusada (23514) e freeze
//      recusado — a migration corrige os dois;
//   2. guard segue recusando definição inválida (sem texto, >3 botões, saída
//      sem conexão, instância não-Uazapi, override evolution);
//   3. freeze congela sem a chave, reusa o congelado e respeita a org;
//   4. ACL, prosecdef, proconfig e o trigger preservados; reaplicar é no-op;
//   5. corpo divergente do de prod aborta a migration sem tocar nada;
//   6. rollback devolve os corpos de prod (md5 de antes).
//
// Rodar: node --test tests/integration/workflow-buttons-sem-flag.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20271122000000_workflow_buttons_sem_flag.sql');
const RB = read('../../supabase/migrations/rollback/20271122000000_workflow_buttons_sem_flag.sql');
const SKELETON = read('./fixtures/workflow-buttons-baseline.sql');

const FREEZE = 'public.freeze_workflow_button_definition(uuid,uuid)';
const GUARD = 'public.guard_workflow_button_activation()';
const PROD_MD5 = { [FREEZE]: '09bf99fdb22eaf29a5347aaf6aa267bb', [GUARD]: '6cdd8cb2389e9818ba144480fe2654eb' };

const ORG = '0a000000-0000-4000-8000-000000000001';
const OTHER_ORG = '0a000000-0000-4000-8000-000000000002';
const INSTANCE = '0c000000-0000-4000-8000-000000000001';

const graph = ({ text = 'Qual setor?', buttons = [{ id: 'a', label: 'Vendas' }, { id: 'b', label: 'Suporte' }], skip = [], instanceId } = {}) => {
  const data = { type: 'question_buttons', text, buttons, timeoutHours: 24, ...(instanceId ? { instanceId } : {}) };
  const outputs = [...buttons.map((b) => `button:${b.id}`), 'other_response', 'timeout', 'send_failure'].filter((h) => !skip.includes(h));
  return {
    nodes: [{ id: 'ask', type: 'question_buttons', data }, { id: 'end', type: 'end', data: {} }],
    edges: outputs.map((sourceHandle) => ({ id: sourceHandle, source: 'ask', sourceHandle, target: 'end' })),
  };
};

async function fresh({ migrate = true, flags = '{}' } = {}) {
  const db = new PGlite();
  await db.exec(SKELETON);
  await db.query('INSERT INTO public.organizations (id, feature_flags) VALUES ($1, $2::jsonb), ($3, $4::jsonb)',
    [ORG, flags, OTHER_ORG, '{}']);
  await db.query("INSERT INTO public.whatsapp_instances (id, organization_id, provider, status) VALUES ($1, $2, 'uazapi', 'connected')", [INSTANCE, ORG]);
  if (migrate) await db.exec(MIG);
  return db;
}

const workflow = async (db, definition, org = ORG) =>
  (await db.query('INSERT INTO public.workflows (organization_id, definition) VALUES ($1, $2::jsonb) RETURNING id', [org, JSON.stringify(definition)])).rows[0].id;
const activate = (db, id) => db.query('UPDATE public.workflows SET is_active = true WHERE id = $1', [id]);
const execution = async (db, workflowId, org = ORG) =>
  (await db.query('INSERT INTO public.workflow_executions (workflow_id, organization_id) VALUES ($1, $2) RETURNING id', [workflowId, org])).rows[0].id;
const freeze = (db, exec, org = ORG) => db.query('SELECT public.freeze_workflow_button_definition($1, $2) AS d', [exec, org]);
const md5 = async (db, sig) => (await db.query('SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = $1::regprocedure', [sig])).rows[0]?.m;
const meta = async (db, sig) => (await db.query(
  'SELECT prosecdef, proconfig, proacl::text AS acl, proowner::regrole::text AS owner FROM pg_proc WHERE oid = $1::regprocedure', [sig])).rows[0];
const trigger = async (db) => (await db.query(
  "SELECT pg_get_triggerdef(oid) AS def, tgenabled FROM pg_trigger WHERE tgname = 'guard_workflow_button_activation'")).rows;

async function rejects23514(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, '23514', error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test('esqueleto = prod (md5 de prosrc)', async () => {
  const db = await fresh({ migrate: false });
  for (const [sig, value] of Object.entries(PROD_MD5)) assert.equal(await md5(db, sig), value, sig);
});

test('red de hoje: org sem a chave tem ativação e freeze recusados; a migration corrige', async () => {
  const db = await fresh({ migrate: false });
  const id = await workflow(db, graph());
  await rejects23514(activate(db, id), /não habilitada/);
  const exec = await execution(db, id);
  await assert.rejects(freeze(db, exec), /question_feature_disabled/);

  await db.exec(MIG);
  await activate(db, id);
  assert.equal((await db.query('SELECT is_active FROM public.workflows WHERE id = $1', [id])).rows[0].is_active, true);
  assert.deepEqual((await freeze(db, exec)).rows[0].d, graph());
});

test('controle: org com a chave legada continua ativando (chave inerte)', async () => {
  const db = await fresh({ flags: '{"workflow_question_buttons":true}' });
  const id = await workflow(db, graph({ instanceId: INSTANCE }));
  await activate(db, id);
});

test('guard segue recusando definição inválida em org sem a chave', async () => {
  const db = await fresh();
  const cases = [
    [graph({ text: '   ' }), /preencha mensagem/],
    [graph({ buttons: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })) }), /um a três botões/],
    [graph({ skip: ['timeout'] }), /conecte uma saída válida para timeout/],
    [graph({ buttons: [{ id: 'a', label: 'Sim' }, { id: 'b', label: 'sim' }] }), /rótulos únicos/],
    [graph({ buttons: [{ id: 'a', label: 'A|B' }] }), /opção inválida/],
  ];
  for (const [definition, pattern] of cases) {
    const id = await workflow(db, definition);
    await rejects23514(activate(db, id), pattern);
  }

  const evolution = (await db.query("INSERT INTO public.whatsapp_instances (organization_id, provider) VALUES ($1, 'evolution') RETURNING id", [ORG])).rows[0].id;
  await rejects23514(activate(db, await workflow(db, graph({ instanceId: evolution }))), /instância Uazapi/);
  await rejects23514(activate(db, await workflow(db, graph({ instanceId: INSTANCE }), OTHER_ORG)), /instância Uazapi/);

  await db.query("UPDATE public.organizations SET whatsapp_provider_override = 'evolution' WHERE id = $1", [ORG]);
  await rejects23514(activate(db, await workflow(db, graph())), /provider efetivo/);
});

test('rascunho inativo inválido continua salvável (guard só olha ativação)', async () => {
  const db = await fresh();
  await workflow(db, graph({ text: '' }));
});

test('freeze sem a chave: congela, reusa o congelado e respeita a org', async () => {
  const db = await fresh();
  const id = await workflow(db, graph());
  const exec = await execution(db, id);
  assert.deepEqual((await freeze(db, exec)).rows[0].d, graph());
  await db.query('UPDATE public.workflows SET definition = $1::jsonb WHERE id = $2', [JSON.stringify(graph({ text: 'editado' })), id]);
  assert.equal((await freeze(db, exec)).rows[0].d.nodes[0].data.text, 'Qual setor?');
  await assert.rejects(freeze(db, exec, OTHER_ORG), /question_execution_unavailable/);

  const guided = (await db.query('INSERT INTO public.workflow_guided_versions (workflow_id, organization_id, definition) VALUES ($1, $2, $3::jsonb) RETURNING id',
    [id, ORG, JSON.stringify(graph({ text: 'versão guiada' }))])).rows[0].id;
  const guidedExec = (await db.query('INSERT INTO public.workflow_executions (workflow_id, organization_id, guided_version_id) VALUES ($1, $2, $3) RETURNING id', [id, ORG, guided])).rows[0].id;
  assert.equal((await freeze(db, guidedExec)).rows[0].d.nodes[0].data.text, 'versão guiada');
});

test('ACL, prosecdef, proconfig, owner e trigger preservados; reaplicar é no-op', async () => {
  const before = await fresh({ migrate: false });
  const metaBefore = { [FREEZE]: await meta(before, FREEZE), [GUARD]: await meta(before, GUARD) };
  const trigBefore = await trigger(before);
  assert.equal(metaBefore[FREEZE].acl, '{postgres=X/postgres,service_role=X/postgres}');
  assert.equal(metaBefore[GUARD].acl, '{postgres=X/postgres}');

  await before.exec(MIG);
  const migrated = { [FREEZE]: await md5(before, FREEZE), [GUARD]: await md5(before, GUARD) };
  for (const sig of [FREEZE, GUARD]) {
    assert.deepEqual(await meta(before, sig), metaBefore[sig], sig);
    assert.notEqual(migrated[sig], PROD_MD5[sig], `${sig} mudou`);
  }
  assert.equal((await meta(before, FREEZE)).prosecdef, false);
  assert.equal((await meta(before, GUARD)).prosecdef, true);
  assert.deepEqual((await meta(before, FREEZE)).proconfig, ['search_path=""']);
  assert.deepEqual(await trigger(before), trigBefore);

  await before.exec(MIG);
  for (const sig of [FREEZE, GUARD]) assert.equal(await md5(before, sig), migrated[sig], `reaplicar ${sig}`);
  for (const role of ['anon', 'authenticated']) {
    for (const sig of [FREEZE, GUARD]) {
      const { rows } = await before.query('SELECT has_function_privilege($1, $2, \'EXECUTE\') AS ok', [role, sig]);
      assert.equal(rows[0].ok, false, `${role} ${sig}`);
    }
  }
});

test('corpo divergente do de prod aborta a migration sem tocar nada', async () => {
  const db = await fresh({ migrate: false });
  await db.exec(`CREATE OR REPLACE FUNCTION public.guard_workflow_button_activation() RETURNS trigger LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN NEW; END $$;`);
  const freezeBefore = await md5(db, FREEZE);
  await assert.rejects(db.exec(MIG), /divergente do corpo de prod/);
  assert.equal(await md5(db, FREEZE), freezeBefore);
});

test('função guard ausente aborta a migration sem tocar nada', async () => {
  const db = await fresh({ migrate: false });
  await db.exec('DROP FUNCTION public.guard_workflow_button_activation() CASCADE');
  const freezeBefore = await md5(db, FREEZE);
  await assert.rejects(db.exec(MIG), /guard_workflow_button_activation divergente do corpo de prod conferido \(md5 <NULL>\)/);
  assert.equal(await md5(db, FREEZE), freezeBefore);
  assert.equal((await db.query('SELECT to_regprocedure($1) IS NULL AS absent', [GUARD])).rows[0].absent, true);
  assert.deepEqual(await trigger(db), []);
});

test('rollback devolve os corpos de prod', async () => {
  const db = await fresh();
  await db.exec(RB);
  for (const [sig, value] of Object.entries(PROD_MD5)) assert.equal(await md5(db, sig), value, sig);
  await rejects23514(activate(db, await workflow(db, graph())), /não habilitada/);
});

test('a migration nova não menciona a chave da flag', () => {
  assert.equal(MIG.includes('workflow_question_buttons'), false);
});
