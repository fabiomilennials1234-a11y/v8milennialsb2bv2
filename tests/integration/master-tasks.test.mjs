import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const query = (text, params = []) => db.query(text, params);
const one = async (text, params = []) => (await query(text, params)).rows[0];
const login = async (user = 1, role = 'authenticated') => {
  await db.exec('RESET ROLE');
  await query("select set_config('request.jwt.claim.sub',$1,false)", [user ? id(user) : '']);
  await db.exec(`SET ROLE ${role}`);
};
const create = (owner = 11, title = 'Revisar onboarding') => one(
  'insert into master_tasks(owner_master_user_id,title) values($1,$2) returning *', [id(owner), title]);

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE master_users(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),is_active boolean,permissions jsonb);
    CREATE TABLE master_audit_logs(id uuid DEFAULT gen_random_uuid(),master_user_id uuid,user_id uuid,action text,
      target_type text,target_id uuid,target_name text,details jsonb);
    ALTER TABLE master_users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE master_audit_logs ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON master_users TO authenticated;
    GRANT SELECT,INSERT ON master_audit_logs TO authenticated;
  `);
  const baseline = sql('supabase/migrations/20260101000000_baseline_prod_schema.sql');
  const masterFn = baseline.match(/CREATE OR REPLACE FUNCTION "public"\."is_master_user"[\s\S]*?\$\$;/)?.[0];
  assert.ok(masterFn);
  await db.exec(masterFn);
  for (const name of ['master_users_all', 'master_users_select', 'master_audit_logs_insert', 'master_audit_logs_select']) {
    const policy = baseline.match(new RegExp(`CREATE POLICY "${name}"[^;]+;`))?.[0];
    assert.ok(policy); await db.exec(policy);
  }
  await db.exec(sql('supabase/migrations/20261026161627_master_tasks_by_owner.sql'));
  for (let n = 1; n <= 6; n++) await query('insert into auth.users values($1)', [id(n)]);
  for (let n = 1; n <= 5; n++) await query('insert into master_users values($1,$2,$3,$4)',
    [id(n + 10), id(n), n !== 5, n === 4 ? { all: false, outbound_only: true } : { all: true }]);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE master_tasks,master_audit_logs;');
  await login();
});

test('cada responsável mantém suas tarefas; os três masters podem ler e editar todos os quadros', async () => {
  for (let owner = 11; owner <= 13; owner++) await create(owner);
  for (let user = 1; user <= 3; user++) {
    await login(user);
    assert.equal((await one('select count(*)::int n from master_tasks')).n, 3);
    assert.equal((await one('select count(*)::int n from master_tasks where owner_master_user_id=$1', [id(user + 10)])).n, 1);
  }
  assert.equal((await query("update master_tasks set status='fazendo' where owner_master_user_id=$1 returning id", [id(11)])).rows.length, 1);
});

test('criação, conclusão, reabertura e troca de responsável mantêm relógio e auditoria', async () => {
  const task = await create(11, '  Revisar onboarding  ');
  assert.equal(task.title, 'Revisar onboarding');
  assert.equal(task.created_by, id(1));
  assert.equal(task.completed_at, null);
  const complete = await one("update master_tasks set status='feito' where id=$1 returning *", [task.id]);
  assert.ok(complete.completed_at);
  const edit = await one("update master_tasks set description='Conferido' where id=$1 returning *", [task.id]);
  assert.deepEqual(edit.completed_at, complete.completed_at);
  await login(2);
  const reopen = await one("update master_tasks set status='a_fazer',owner_master_user_id=$2 where id=$1 returning *", [task.id, id(12)]);
  assert.equal(reopen.completed_at, null);
  assert.equal(reopen.owner_master_user_id, id(12));
  assert.equal(reopen.created_by, id(1));
  assert.notEqual(reopen.updated_at, task.updated_at);
  const audit = await one("select * from master_audit_logs where user_id=$1", [id(2)]);
  assert.equal(audit.details.before.owner_master_user_id, id(11));
  assert.equal(audit.details.after.owner_master_user_id, id(12));
  await query('delete from master_tasks where id=$1', [task.id]);
  assert.equal((await one('select count(*)::int n from master_audit_logs')).n, 5);
});

test('comum, outbounder, master inativo e anônimo não acessam nem alteram tarefas', async () => {
  const task = await create();
  for (const user of [4, 5, 6]) {
    await login(user);
    assert.equal((await query('select * from master_tasks')).rows.length, 0);
    await assert.rejects(create(), /policy|permission|responsável/i);
    assert.equal((await query("update master_tasks set status='feito' where id=$1 returning id", [task.id])).rows.length, 0);
    assert.equal((await query('delete from master_tasks where id=$1 returning id', [task.id])).rows.length, 0);
  }
  await login(null, 'anon');
  await assert.rejects(query('select * from master_tasks'), /permission denied/i);
  await assert.rejects(create(), /permission denied/i);
});

test('exige responsável ativo, título preenchido e status válido; cliente não falsifica metadados', async () => {
  for (const owner of [14, 15, 99]) await assert.rejects(create(owner), /responsável/i);
  await assert.rejects(create(11, '  '), /check constraint/i);
  const task = await create();
  await assert.rejects(query("update master_tasks set status='cancelado' where id=$1", [task.id]), /check constraint/i);
  await assert.rejects(query("update master_tasks set prompt_complexity='impossivel' where id=$1", [task.id]), /check constraint/i);
  await assert.rejects(query("update master_tasks set context=repeat('a',5001) where id=$1", [task.id]), /check constraint/i);
  await assert.rejects(query('update master_tasks set created_by=$2 where id=$1', [task.id, id(2)]), /permission denied/i);
  await assert.rejects(query('update master_tasks set completed_at=now() where id=$1', [task.id]), /permission denied/i);
  await assert.rejects(query('insert into master_tasks(owner_master_user_id,title,created_by) values($1,$2,$3)', [id(11), 'Falsa', id(2)]), /permission denied/i);
});

test('versão antiga não sobrescreve mudanças simultâneas nem exclui tarefa atualizada', async () => {
  const task = await create();
  await query("update master_tasks set status='fazendo' where id=$1", [task.id]);
  assert.equal((await query("update master_tasks set status='feito' where id=$1 and updated_at=$2 returning id", [task.id, task.updated_at])).rows.length, 0);
  assert.equal((await query('delete from master_tasks where id=$1 and updated_at=$2 returning id', [task.id, task.updated_at])).rows.length, 0);
  assert.equal((await one('select status from master_tasks where id=$1', [task.id])).status, 'fazendo');
});

test('pegar e encaminhar preserva o prompt e impede uma transferência com versão antiga', async () => {
  const task = await one("insert into master_tasks(owner_master_user_id,title,context,description,prompt_complexity,status) values($1,'Revisar acesso','Preservar permissões','Objetivo e passos','alta','fazendo') returning *", [id(11)]);
  await login(2);
  const taken = await one('update master_tasks set owner_master_user_id=$2 where id=$1 and updated_at=$3 returning *', [task.id, id(12), task.updated_at]);
  assert.equal(taken.description, task.description);
  assert.equal(taken.context, task.context);
  assert.equal(taken.prompt_complexity, 'alta');
  assert.equal(taken.status, 'fazendo');
  await login(3);
  assert.equal((await query('update master_tasks set owner_master_user_id=$2 where id=$1 and updated_at=$3 returning *', [task.id, id(13), task.updated_at])).rows.length, 0);
  const forwarded = await one('update master_tasks set owner_master_user_id=$2 where id=$1 and updated_at=$3 returning *', [task.id, id(13), taken.updated_at]);
  assert.equal(forwarded.owner_master_user_id, id(13));
  const audit = await one('select * from master_audit_logs where user_id=$1', [id(3)]);
  assert.equal(audit.details.before.owner_master_user_id, id(12));
  assert.equal(audit.details.after.owner_master_user_id, id(13));
});
