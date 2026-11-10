// scheduled_user_messages (20280102000100): a fila de envio deixa de aceitar
// escrita cross-tenant.
//
// O esqueleto (fixtures/scheduled-user-messages-rls-baseline.sql) carrega o
// corpo de PROD das funções que as policies chamam e o texto de PROD das
// policies (lido em 10/11/2026). Todo caso roda como `authenticated` (ou
// `service_role`) COM claims de JWT reais e conta as linhas devolvidas — um
// UPDATE que casa zero linha nunca passa por "não deu erro".
//
// Provado:
//   1. sentinela: ANTES da migration o ataque funciona (instância de outra org
//      via UPDATE e via INSERT; membro inativo ainda edita);
//   2. DEPOIS: todos os vetores de escrita cross-tenant falham;
//   3. DEPOIS: todos os fluxos legítimos do front e do worker seguem com 1 linha;
//   4. ação de FK ON DELETE SET NULL (apagar instância) continua funcionando;
//   5. funções de trigger não são executáveis por anon/authenticated/service_role;
//   6. rollback reabre exatamente o furo (sentinela de volta) e a migration
//      reaplica limpa por cima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20280102000100_scheduled_user_messages_fecha_escrita_cross_tenant.sql');
const RB = read('../../supabase/migrations/rollback/20280102000100_scheduled_user_messages_fecha_escrita_cross_tenant.sql');
const SKELETON = read('./fixtures/scheduled-user-messages-rls-baseline.sql');

const id = (p, n) => `${p}000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ORG_A = id('0a', 1), ORG_B = id('0a', 2), ORG_S = id('0a', 3); // S = suspensa
const U_A = id('0b', 1), U_A2 = id('0b', 2), U_B = id('0b', 3), U_INACTIVE = id('0b', 4),
  U_MASTER = id('0b', 5), U_SUSP = id('0b', 6), U_MULTI = id('0b', 7);
const T_A = id('0c', 1), T_A2 = id('0c', 2), T_B = id('0c', 3), T_INACTIVE = id('0c', 4), T_SUSP = id('0c', 5), T_MA = id('0c', 6), T_MB = id('0c', 7);
const I_A = id('0d', 1), I_A_DEL = id('0d', 2), I_B = id('0d', 3), I_S = id('0d', 4);
const L_A = id('0e', 1), L_B = id('0e', 2), L_S = id('0e', 3);
// linhas da fila
const M_SCHED = id('0f', 1), M_FAILED = id('0f', 2), M_SENT = id('0f', 3), M_CANCEL = id('0f', 4),
  M_INACTIVE = id('0f', 5), M_DEL = id('0f', 6), M_SUSP = id('0f', 7), M_MULTI = id('0f', 8);

const SEED = `
INSERT INTO public.organizations (id, subscription_status) VALUES
  ('${ORG_A}','active'),('${ORG_B}','active'),('${ORG_S}','suspended');
INSERT INTO public.team_members (id, user_id, organization_id, is_active) VALUES
  ('${T_A}','${U_A}','${ORG_A}',true),
  ('${T_A2}','${U_A2}','${ORG_A}',true),
  ('${T_B}','${U_B}','${ORG_B}',true),
  ('${T_INACTIVE}','${U_INACTIVE}','${ORG_A}',false),
  ('${T_SUSP}','${U_SUSP}','${ORG_S}',true),
  ('${T_MA}','${U_MULTI}','${ORG_A}',true),
  ('${T_MB}','${U_MULTI}','${ORG_B}',true);
INSERT INTO public.master_users (user_id) VALUES ('${U_MASTER}');
INSERT INTO public.whatsapp_instances (id, organization_id) VALUES
  ('${I_A}','${ORG_A}'),('${I_A_DEL}','${ORG_A}'),('${I_B}','${ORG_B}'),('${I_S}','${ORG_S}');
INSERT INTO public.leads (id, organization_id) VALUES ('${L_A}','${ORG_A}'),('${L_B}','${ORG_B}'),('${L_S}','${ORG_S}');
INSERT INTO public.scheduled_user_messages
  (id, organization_id, lead_id, phone_number, created_by, whatsapp_instance_id, message_content, scheduled_at, status, retry_count, error_message, sent_at)
VALUES
  ('${M_SCHED}','${ORG_A}','${L_A}','5511999990001','${T_A}','${I_A}','oi', now() + interval '1 day','scheduled',0,NULL,NULL),
  ('${M_FAILED}','${ORG_A}','${L_A}','5511999990001','${T_A}','${I_A}','oi', now() - interval '1 hour','failed',3,'provider fora',NULL),
  ('${M_SENT}','${ORG_A}','${L_A}','5511999990001','${T_A}','${I_A}','oi', now() - interval '2 hour','sent',0,NULL, now() - interval '2 hour'),
  ('${M_CANCEL}','${ORG_A}','${L_A}','5511999990001','${T_A}','${I_A}','oi', now() + interval '1 day','cancelled',0,NULL,NULL),
  ('${M_INACTIVE}','${ORG_A}','${L_A}','5511999990001','${T_INACTIVE}','${I_A}','oi', now() + interval '1 day','scheduled',0,NULL,NULL),
  ('${M_DEL}','${ORG_A}',NULL,'5511999990002','${T_A}','${I_A_DEL}','oi', now() + interval '1 day','scheduled',0,NULL,NULL),
  ('${M_SUSP}','${ORG_S}','${L_S}','5511999990003','${T_SUSP}','${I_S}','oi', now() + interval '1 day','scheduled',0,NULL,NULL),
  ('${M_MULTI}','${ORG_A}','${L_A}','5511999990004','${T_MA}','${I_A}','oi', now() + interval '1 day','scheduled',0,NULL,NULL);
`;

async function freshDb({ migrated }) {
  const db = new PGlite();
  await db.exec(SKELETON);
  await db.exec(SEED);
  if (migrated) await db.exec(MIG);
  return db;
}

/** Roda `sql` como `role` com claims reais, sempre em ROLLBACK. */
async function as(db, role, uid, sql) {
  await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: uid ?? '', role }),
    ]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    const r = await db.query(sql);
    // affectedRows, não rows: o atacante usa `Prefer: return=minimal` (sem
    // RETURNING), e RETURNING aplica a policy de SELECT na linha nova — o que
    // mascararia um UPDATE que de fato gravou.
    return { ok: true, n: r.affectedRows ?? r.rows.length, rows: r.rows };
  } catch (e) {
    return { ok: false, code: e.code, msg: e.message };
  } finally {
    await db.exec('ROLLBACK');
  }
}

const upd = (set, where = '', ret = false) =>
  `UPDATE public.scheduled_user_messages SET ${set} ${where}${ret ? ' RETURNING id, status, assigned_to' : ''}`;
const ins = (cols, ret = false) => {
  const base = {
    organization_id: `'${ORG_A}'`, lead_id: `'${L_A}'`, phone_number: `'5511988887777'`,
    created_by: `'${T_A}'`, assigned_to: `'${T_A}'`, whatsapp_instance_id: `'${I_A}'`,
    message_content: `'novo'`, scheduled_at: `now() + interval '1 hour'`, ...cols,
  };
  return `INSERT INTO public.scheduled_user_messages (${Object.keys(base).join(',')})
          VALUES (${Object.values(base).join(',')})${ret ? ' RETURNING id, assigned_to' : ''}`;
};

/** Escrita bloqueada: erro OU zero linhas. Nunca 1 linha. */
function assertBlocked(r, label) {
  if (r.ok) assert.equal(r.n, 0, `${label}: deveria bloquear, afetou ${r.n} linha(s)`);
}
/** Escrita permitida: exatamente 1 linha. */
function assertOne(r, label) {
  assert.ok(r.ok, `${label}: falhou com ${r.code} ${r.msg}`);
  assert.equal(r.n, 1, `${label}: esperava 1 linha, veio ${r.n}`);
  return r.rows[0];
}

// md5(pg_get_functiondef) em prod, 10/11/2026. Se divergir, o esqueleto mente.
const PROD_MD5 = {
  'default_assigned_to_scheduled_msg()': '7c7fc2d0d45ee508287914c54cc6775c',
  'get_my_gestor_organization_ids()': 'a342535bf36d39ce5dba59fd8441e122',
  'get_my_member_organization_ids()': '2335cc678384684526a34e384bfc7d26',
  'get_my_organization_ids()': '72fb9e49c1956386ac3eca3d96325a5a',
  'is_master_user(uuid)': '0fdb47977f7bc6a3b19a4c892e350075',
  'my_team_member_id(uuid)': '42ec93f7d27bd5ec491db96e0f388247',
};

test('esqueleto: funções batem byte a byte com prod', async () => {
  const db = await freshDb({ migrated: false });
  for (const [fn, md5] of Object.entries(PROD_MD5)) {
    const r = await db.query(`SELECT md5(pg_get_functiondef($1::regprocedure)) AS m`, [`public.${fn}`]);
    assert.equal(r.rows[0].m, md5, `${fn} diverge de prod`);
  }
  await db.close();
});

// ---------------------------------------------------------------------------
test('sentinela: o furo existe ANTES da migration', async () => {
  const db = await freshDb({ migrated: false });
  assertOne(await as(db, 'authenticated', U_A,
    upd(`whatsapp_instance_id = '${I_B}'`, `WHERE id = '${M_SCHED}'`)), 'UPDATE para instância da org B');
  // Mover de org exige que a linha nova passe na policy de SELECT (o UPDATE
  // tem WHERE). Membro de UMA org não consegue; membro de DUAS consegue.
  assertBlocked(await as(db, 'authenticated', U_A,
    upd(`organization_id = '${ORG_B}', whatsapp_instance_id = '${I_B}'`, `WHERE id = '${M_SCHED}'`)),
    'membro de uma org só não move a linha');
  assertOne(await as(db, 'authenticated', U_MULTI,
    upd(`organization_id = '${ORG_B}', whatsapp_instance_id = '${I_B}', lead_id = '${L_B}'`, `WHERE id = '${M_MULTI}'`)),
    'membro de duas orgs move a linha de A para B mantendo created_by de A');
  assertOne(await as(db, 'authenticated', U_A,
    upd(`phone_number = '5599900000000'`, `WHERE id = '${M_SCHED}'`)), 'UPDATE do telefone de destino');
  assertOne(await as(db, 'authenticated', U_A, ins({ whatsapp_instance_id: `'${I_B}'` })), 'INSERT com instância da org B');
  assertOne(await as(db, 'authenticated', U_A, ins({ status: `'sent'`, sent_at: 'now()' })), 'INSERT forjando enviada');
  // Membro inativo: com WHERE a policy de SELECT (que exige ativo) barra; SEM
  // WHERE não há leitura, só o USING do UPDATE (que não olha is_active) — e ele
  // reescreve as próprias linhas, inclusive o destino.
  assertBlocked(await as(db, 'authenticated', U_INACTIVE,
    upd(`message_content = 'x'`, `WHERE id = '${M_INACTIVE}'`)), 'inativo com filtro');
  assertOne(await as(db, 'authenticated', U_INACTIVE,
    upd(`phone_number = '5599900000000'`)), 'inativo sem filtro reescreve o destino');
  await db.close();
});

// ---------------------------------------------------------------------------
test('depois: vetores de escrita cross-tenant falham', async () => {
  const db = await freshDb({ migrated: true });
  const w = `WHERE id = '${M_SCHED}'`;
  const cases = [
    ['UPDATE instância → org B', U_A, upd(`whatsapp_instance_id = '${I_B}'`, w)],
    ['UPDATE organization_id → B', U_A, upd(`organization_id = '${ORG_B}'`, w)],
    ['UPDATE linha inteira → B', U_A, upd(`organization_id = '${ORG_B}', whatsapp_instance_id = '${I_B}', created_by = '${T_B}', lead_id = '${L_B}'`, w)],
    ['UPDATE created_by → colega', U_A, upd(`created_by = '${T_A2}'`, w)],
    ['UPDATE created_by → org B', U_A, upd(`created_by = '${T_B}'`, w)],
    ['UPDATE phone_number', U_A, upd(`phone_number = '5599900000000'`, w)],
    ['UPDATE lead_id → org B', U_A, upd(`lead_id = '${L_B}'`, w)],
    ['UPDATE lead_id → mesmo org', U_A, upd(`lead_id = NULL`, w)],
    ['UPDATE instância → NULL', U_A, upd(`whatsapp_instance_id = NULL`, w)],
    ['UPDATE assigned_to → org B', U_A, upd(`assigned_to = '${T_B}'`, w)],
    ['UPDATE sent_at', U_A, upd(`sent_at = now()`, w)],
    ['UPDATE status → sending', U_A, upd(`status = 'sending'`, w)],
    ['UPDATE status → sent', U_A, upd(`status = 'sent'`, w)],
    ['UPDATE status → failed', U_A, upd(`status = 'failed'`, w)],
    ['UPDATE retry_count = 5', U_A, upd(`retry_count = 5`, w)],
    ['UPDATE error_message', U_A, upd(`error_message = 'forjado'`, w)],
    ['reviver sent → scheduled', U_A, upd(`status = 'scheduled'`, `WHERE id = '${M_SENT}'`)],
    ['editar conteúdo de sent', U_A, upd(`message_content = 'reescrito'`, `WHERE id = '${M_SENT}'`)],
    ['reviver cancelled → scheduled', U_A, upd(`status = 'scheduled'`, `WHERE id = '${M_CANCEL}'`)],
    ['outra org edita linha de A', U_B, upd(`message_content = 'x'`, w)],
    ['colega edita linha do autor', U_A2, upd(`message_content = 'x'`, w)],
    ['membro inativo sem filtro', U_INACTIVE, upd(`phone_number = '5599900000000'`)],
    ['UPDATE sem filtro instância → B', U_A, upd(`whatsapp_instance_id = '${I_B}'`)],
    ['membro inativo edita a própria', U_INACTIVE, upd(`message_content = 'x'`, `WHERE id = '${M_INACTIVE}'`)],
    ['membro de org suspensa edita a própria', U_SUSP, upd(`message_content = 'x'`, `WHERE id = '${M_SUSP}'`)],
    ['INSERT instância da org B', U_A, ins({ whatsapp_instance_id: `'${I_B}'` })],
    ['INSERT lead da org B', U_A, ins({ lead_id: `'${L_B}'` })],
    ['INSERT assigned_to da org B', U_A, ins({ assigned_to: `'${T_B}'` })],
    ['INSERT created_by = colega', U_A, ins({ created_by: `'${T_A2}'`, assigned_to: `'${T_A2}'` })],
    ['INSERT created_by da org B', U_A, ins({ created_by: `'${T_B}'`, assigned_to: `'${T_B}'` })],
    ['INSERT em nome da org B', U_A, ins({ organization_id: `'${ORG_B}'`, whatsapp_instance_id: `'${I_B}'`, lead_id: `'${L_B}'` })],
    ['INSERT por membro inativo', U_INACTIVE, ins({ created_by: `'${T_INACTIVE}'`, assigned_to: `'${T_INACTIVE}'` })],
    ['INSERT em org suspensa', U_SUSP, ins({ organization_id: `'${ORG_S}'`, created_by: `'${T_SUSP}'`, assigned_to: `'${T_SUSP}'`, whatsapp_instance_id: `'${I_S}'`, lead_id: `'${L_S}'` })],
    ['multi-org move linha de A para B', U_MULTI, upd(`organization_id = '${ORG_B}', whatsapp_instance_id = '${I_B}', lead_id = '${L_B}'`, `WHERE id = '${M_MULTI}'`)],
    ['multi-org move e troca autor para o de B', U_MULTI, upd(`organization_id = '${ORG_B}', whatsapp_instance_id = '${I_B}', lead_id = '${L_B}', created_by = '${T_MB}', assigned_to = '${T_MB}'`, `WHERE id = '${M_MULTI}'`)],
    ['multi-org INSERT em A com autor de B', U_MULTI, ins({ created_by: `'${T_MB}'`, assigned_to: `'${T_MB}'` })],
    ['master move linha para org B', U_MASTER, upd(`organization_id = '${ORG_B}', whatsapp_instance_id = '${I_B}'`, w)],
    ['master INSERT com instância cruzada', U_MASTER, ins({ whatsapp_instance_id: `'${I_B}'` })],
    ['INSERT já como sent', U_A, ins({ status: `'sent'`, sent_at: 'now()' })],
  ];
  for (const [label, uid, sql] of cases) assertBlocked(await as(db, 'authenticated', uid, sql), label);
  await db.close();
});

test('depois: casos barrados por trigger falham com 42501 (não por 0 linhas)', async () => {
  const db = await freshDb({ migrated: true });
  const w = `WHERE id = '${M_SCHED}'`;
  const cases = [
    ['phone_number', upd(`phone_number = '5599900000000'`, w)],
    ['instância → org B', upd(`whatsapp_instance_id = '${I_B}'`, w)],
    ['instância → NULL', upd(`whatsapp_instance_id = NULL`, w)],
    ['lead_id', upd(`lead_id = NULL`, w)],
    ['sent_at', upd(`sent_at = now()`, w)],
    ['status → sending', upd(`status = 'sending'`, w)],
    ['status → sent', upd(`status = 'sent'`, w)],
    ['retry_count = 5', upd(`retry_count = 5`, w)],
    ['error_message forjado', upd(`error_message = 'forjado'`, w)],
    ['sent → scheduled', upd(`status = 'scheduled'`, `WHERE id = '${M_SENT}'`)],
    ['editar sent', upd(`message_content = 'x'`, `WHERE id = '${M_SENT}'`)],
    ['cancelled → scheduled', upd(`status = 'scheduled'`, `WHERE id = '${M_CANCEL}'`)],
    ['assigned_to → org B', upd(`assigned_to = '${T_B}'`, w)],
    ['INSERT instância B', ins({ whatsapp_instance_id: `'${I_B}'` })],
    ['INSERT lead B', ins({ lead_id: `'${L_B}'` })],
    ['INSERT assigned_to B', ins({ assigned_to: `'${T_B}'` })],
    ['INSERT já sent', ins({ status: `'sent'`, sent_at: 'now()' })],
    ['INSERT failed', ins({ status: `'failed'` })],
    ['INSERT com retry_count', ins({ retry_count: '2' })],
    ['INSERT com error_message', ins({ error_message: `'x'` })],
  ];
  for (const [label, sql] of cases) {
    const r = await as(db, 'authenticated', U_A, sql);
    assert.equal(r.ok, false, `${label}: deveria levantar erro, afetou ${r.n}`);
    assert.equal(r.code, '42501', `${label}: código ${r.code} ${r.msg}`);
  }
  await db.close();
});

test('depois: o erro de integridade é 42501, não silêncio', async () => {
  const db = await freshDb({ migrated: true });
  const r = await as(db, 'authenticated', U_A, upd(`whatsapp_instance_id = '${I_B}'`, `WHERE id = '${M_SCHED}'`));
  assert.equal(r.ok, false);
  assert.equal(r.code, '42501');
  const r2 = await as(db, 'authenticated', U_A, ins({ whatsapp_instance_id: `'${I_B}'` }));
  assert.equal(r2.ok, false);
  assert.equal(r2.code, '42501');
  await db.close();
});

// ---------------------------------------------------------------------------
test('depois: fluxos legítimos do front seguem com 1 linha', async () => {
  const db = await freshDb({ migrated: true });
  const s = `WHERE id = '${M_SCHED}' AND status = 'scheduled'`;
  const f = `WHERE id = '${M_FAILED}' AND status = 'failed'`;

  assertOne(await as(db, 'authenticated', U_A, ins({})), 'criar agendamento');
  const semLead = assertOne(await as(db, 'authenticated', U_A, ins({ lead_id: 'NULL', assigned_to: 'NULL' }, true)),
    'criar sem lead (conversa) e sem assigned_to');
  assert.equal(semLead.assigned_to, T_A, 'default_assigned_to segue preenchendo com o autor');
  assertOne(await as(db, 'authenticated', U_A, ins({ whatsapp_instance_id: 'NULL' })), 'criar sem instância (worker escolhe)');

  assertOne(await as(db, 'authenticated', U_A, upd(`status = 'cancelled'`, s)), 'cancelar');
  assertOne(await as(db, 'authenticated', U_A,
    upd(`message_content = 'novo texto', scheduled_at = now() + interval '2 day'`, s)), 'editar conteúdo e horário');
  assertOne(await as(db, 'authenticated', U_A, upd(`scheduled_at = now()`, s)), 'enviar agora');
  assertOne(await as(db, 'authenticated', U_A,
    upd(`media_url = 'https://x/y.png', media_type = 'image', media_filename = 'y.png'`, s)), 'trocar mídia');
  assertOne(await as(db, 'authenticated', U_A, upd(`assigned_to = '${T_A2}'`, s)), 'reatribuir a colega da org');
  const reset = assertOne(await as(db, 'authenticated', U_A, upd(`assigned_to = NULL`, s, true)), 'limpar responsável');
  assert.equal(reset.assigned_to, T_A);

  assertOne(await as(db, 'authenticated', U_A,
    upd(`message_content = 'de novo', status = 'scheduled', retry_count = 0, error_message = NULL`, f)),
    'tentar de novo (edita + failed→scheduled)');
  assertOne(await as(db, 'authenticated', U_A,
    upd(`status = 'scheduled', scheduled_at = now(), retry_count = 0, error_message = NULL`, f)),
    'tentar de novo agora');
  assertOne(await as(db, 'authenticated', U_A, upd(`status = 'cancelled'`, f)), 'descartar falha');

  // CAS do front: linha que o worker já pegou casa zero linha, sem erro.
  const cas = await as(db, 'authenticated', U_A, upd(`status = 'cancelled'`, `WHERE id = '${M_SENT}' AND status = 'scheduled'`));
  assert.ok(cas.ok); assert.equal(cas.n, 0);

  // Master opera dentro da org (policy ghost) sem mudar endereço.
  assertOne(await as(db, 'authenticated', U_MASTER, upd(`status = 'cancelled'`, s)), 'master cancela');
  await db.close();
});

test('depois: worker (service_role) segue com 1 linha em cada passo', async () => {
  const db = await freshDb({ migrated: true });
  const steps = [
    ['lock CAS scheduled→sending', upd(`status = 'sending'`, `WHERE id = '${M_SCHED}' AND status = 'scheduled'`)],
    ['marcar sent', upd(`status = 'sent', sent_at = now(), error_message = 'parcial'`, `WHERE id = '${M_SCHED}'`)],
    ['retry: volta a scheduled', upd(`status = 'scheduled', retry_count = 2, scheduled_at = now() + interval '2 min'`, `WHERE id = '${M_SCHED}'`)],
    ['esgotou: failed', upd(`status = 'failed', error_message = 'x', retry_count = 3`, `WHERE id = '${M_SCHED}'`)],
    ['sent → scheduled (servidor pode)', upd(`status = 'scheduled'`, `WHERE id = '${M_SENT}'`)],
  ];
  for (const [label, sql] of steps) assertOne(await as(db, 'service_role', null, sql), label);

  assertOne(await as(db, 'service_role', null, ins({ status: `'sent'`, sent_at: 'now()' })), 'servidor insere em qualquer estado');

  // A invariante de tenant vale até para o service_role.
  const r = await as(db, 'service_role', null, upd(`whatsapp_instance_id = '${I_B}'`, `WHERE id = '${M_SCHED}'`));
  assert.equal(r.ok, false, 'service_role não aponta linha para instância de outra org');
  assert.equal(r.code, '42501');
  await db.close();
});

test('depois: apagar instância (FK ON DELETE SET NULL) não é barrado pela guarda', async () => {
  const db = await freshDb({ migrated: true });
  await db.exec('BEGIN');
  await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U_A, role: 'authenticated' })]);
  await db.exec('SET LOCAL ROLE authenticated');
  const del = await db.query(`DELETE FROM public.whatsapp_instances WHERE id = '${I_A_DEL}' RETURNING id`);
  assert.equal(del.rows.length, 1);
  await db.exec('RESET ROLE');
  const row = await db.query(`SELECT whatsapp_instance_id FROM public.scheduled_user_messages WHERE id = '${M_DEL}'`);
  assert.equal(row.rows[0].whatsapp_instance_id, null);
  await db.exec('ROLLBACK');
  await db.close();
});

test('depois: funções de trigger não são executáveis por nenhuma role de API', async () => {
  const db = await freshDb({ migrated: true });
  for (const fn of ['scheduled_user_messages_tenant_integrity()', 'scheduled_user_messages_client_guard()']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const r = await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS x`, [role, `public.${fn}`]);
      assert.equal(r.rows[0].x, false, `${role} executa ${fn}`);
    }
    const sd = await db.query(`SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`]);
    assert.equal(sd.rows[0].prosecdef, fn.startsWith('scheduled_user_messages_tenant'),
      `${fn}: integridade é DEFINER, guarda é INVOKER`);
  }
  const pol = await db.query(`SELECT policyname, cmd, roles::text, qual IS NOT NULL AS q, with_check IS NOT NULL AS c
    FROM pg_policies WHERE tablename = 'scheduled_user_messages' AND cmd IN ('INSERT','UPDATE') ORDER BY cmd`);
  assert.deepEqual(pol.rows.map((p) => [p.cmd, p.roles, p.q, p.c]), [
    ['INSERT', '{authenticated}', false, true],
    ['UPDATE', '{authenticated}', true, true],
  ]);
  await db.close();
});

// ---------------------------------------------------------------------------
test('rollback reabre o furo; migration reaplica limpa por cima', async () => {
  const db = await freshDb({ migrated: true });
  await db.exec(RB);
  assertOne(await as(db, 'authenticated', U_A,
    upd(`whatsapp_instance_id = '${I_B}'`, `WHERE id = '${M_SCHED}'`)), 'pós-rollback: furo de volta (sentinela)');
  const trg = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.scheduled_user_messages'::regclass AND NOT tgisinternal`);
  assert.equal(trg.rows[0].n, 1, 'só o trigger de default_assigned_to sobra');

  await db.exec(MIG);
  await db.exec(MIG); // idempotente
  assertBlocked(await as(db, 'authenticated', U_A,
    upd(`whatsapp_instance_id = '${I_B}'`, `WHERE id = '${M_SCHED}'`)), 'reaplicada: furo fechado');
  assertOne(await as(db, 'authenticated', U_A, upd(`status = 'cancelled'`, `WHERE id = '${M_SCHED}'`)), 'reaplicada: cancelar ok');
  await db.close();
});
