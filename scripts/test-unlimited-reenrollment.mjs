// Runs the real trigger in isolated PostgreSQL/WASM. Never connects to production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const load = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const insert = (status = 'completed', entry = id(4), org = id(1), lead = id(3)) => db.query(
  `INSERT INTO workflow_executions(organization_id,workflow_id,lead_id,pipeline_entry_id,status)
   VALUES($1,$2,$3,$4,$5) RETURNING id`, [org,id(2),lead,entry,status]);
let checks = 0;
async function check(name, run) { await run(); console.log(`PASS ${++checks}: ${name}`); }
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE workflows(id uuid PRIMARY KEY, organization_id uuid, re_enrollment_enabled boolean,
      re_enrollment_max_times integer DEFAULT 1, re_enrollment_cooldown_days integer DEFAULT 30);
    CREATE TABLE workflow_executions(id uuid DEFAULT gen_random_uuid(), organization_id uuid,
      workflow_id uuid, lead_id uuid, pipeline_entry_id uuid, status text, started_at timestamptz DEFAULT now());
    INSERT INTO workflows VALUES ('${id(2)}','${id(1)}',false,1,30);
  `);
  await db.exec(await load('20271021000002_workflow_reenrollment_guard.sql'));
  await db.exec(await load('20271021000003_workflow_active_enrollment_guard.sql'));
  await check('old guard reproduces enabled toggle blocked by legacy defaults', async () => {
    assert.equal((await insert()).rows.length, 1);
    await db.exec('UPDATE workflows SET re_enrollment_enabled=true');
    assert.equal((await insert()).rows.length, 0);
  });
  if (!process.argv.includes('--before')) {
    await db.exec(await load('20271021000022_unlimited_workflow_reenrollment.sql'));
  }
  await check('enabled allows 105 immediate terminal enrollments despite old max=1/cooldown=30', async () => {
    for (let i=0;i<105;i++) assert.equal((await insert()).rows.length, 1);
  });
  await check('all in-flight states block a second enrollment', async () => {
    for (const status of ['running','processing','waiting_response','paused']) {
      const active = (await insert(status)).rows[0];
      assert.ok(active);
      assert.equal((await insert()).rows.length, 0);
      await db.query('UPDATE workflow_executions SET status=$1 WHERE id=$2', ['completed',active.id]);
      assert.equal((await insert()).rows.length, 1);
    }
  });
  await check('disabled blocks reentry, allows first enrollment on a different business/lead', async () => {
    await db.exec('UPDATE workflows SET re_enrollment_enabled=false');
    assert.equal((await insert()).rows.length, 0);
    assert.equal((await insert('failed',id(5))).rows.length, 1);
    assert.equal((await insert('completed',id(5))).rows.length, 0);
    assert.equal((await insert('completed',id(4),id(1),id(6))).rows.length, 1);
  });
  await check('foreign organization cannot enroll in workflow', async () => {
    await assert.rejects(insert('completed',id(4),id(9)), e => e.code === '23514');
  });
  await check('legacy null-entry subject still prevents in-flight duplication', async () => {
    await db.exec('UPDATE workflows SET re_enrollment_enabled=true');
    const active = (await insert('running')).rows[0];
    assert.equal((await insert('completed',null)).rows.length, 0);
    await db.query('UPDATE workflow_executions SET status=$1 WHERE id=$2', ['completed',active.id]);
    assert.equal((await insert('completed',null)).rows.length, 1);
  });
  await check('trigger function remains unavailable as a public RPC', async () => {
    const { rows } = await db.query(`SELECT has_function_privilege('anon','public.guard_workflow_reenrollment()','EXECUTE') a,
      has_function_privilege('authenticated','public.guard_workflow_reenrollment()','EXECUTE') b`);
    assert.deepEqual(rows[0], {a:false,b:false});
  });
  await check('rollback restores former limits without rewriting settings', async () => {
    await db.exec(await load('20271021000003_workflow_active_enrollment_guard.sql'));
    assert.equal((await insert()).rows.length, 0);
  });
} finally { await db.close(); }

