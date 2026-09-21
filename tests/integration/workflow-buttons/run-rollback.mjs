/** Explicit target only. Applies the candidate schema inside a transaction that always rolls back. */
import { readFileSync } from 'node:fs';

const suite = process.argv[2] ?? 'base';
const suites = {
  release: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000061_workflow_question_images.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql', '20271020000064_workflow_button_queue.sql', '20271020000065_workflow_button_activation.sql', '20271020000066_workflow_button_history.sql', '20271020000067_workflow_button_admission_failure.sql', '20271020000068_workflow_button_instance_retention.sql'], fixture: ['activation-rollback.sql', 'history-rollback.sql', 'admission-rollback.sql', 'lifecycle-rollback.sql'] },
  lifecycle: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql', '20271020000064_workflow_button_queue.sql', '20271020000068_workflow_button_instance_retention.sql'], fixture: 'lifecycle-rollback.sql' },
  admission: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql', '20271020000064_workflow_button_queue.sql', '20271020000067_workflow_button_admission_failure.sql'], fixture: 'admission-rollback.sql' },
  history: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql', '20271020000064_workflow_button_queue.sql', '20271020000066_workflow_button_history.sql'], fixture: 'history-rollback.sql' },
  activation: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000061_workflow_question_images.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql', '20271020000064_workflow_button_queue.sql', '20271020000065_workflow_button_activation.sql'], fixture: 'activation-rollback.sql' },
  queue: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql', '20271020000064_workflow_button_queue.sql'], fixture: 'queue-rollback.sql' },
  failure: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql'], fixture: 'failure-rollback.sql' },
  images: { migrations: ['20271020000061_workflow_question_images.sql'], fixture: 'images-rollback.sql' },
  base: { migrations: ['20271020000060_workflow_button_questions.sql'], fixture: 'rollback.sql' },
  inbox: { migrations: ['20271020000060_workflow_button_questions.sql', '20271020000062_workflow_button_inbox.sql'], fixture: 'inbox-rollback.sql' },
};
if (!Object.hasOwn(suites, suite)) throw new Error('Unknown rollback suite');
const project = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!project || !/^[a-z]{20}$/.test(project) || !token) {
  throw new Error('Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN for the explicitly authorized target.');
}
const endpoint = `https://api.supabase.com/v1/projects/${project}/database/query`;
async function query(sql) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Database request failed: HTTP ${response.status}`);
  }
  return response.json();
}
const check = suite === 'images' ? `select
 not exists(select 1 from storage.buckets where id='workflow-question-images') as bucket_absent,
 not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='workflow_question_images_api_only') as policy_absent,
 not exists(select 1 from storage.objects where bucket_id='workflow-question-images') as fixtures_absent` : `select
  not exists(select 1 from auth.users where email like 'button-rollback-%@example.invalid') as test_users_absent,
  not exists(select 1 from storage.buckets where id='workflow-question-images') as bucket_absent,
  to_regclass('public.workflow_button_questions') is null as table_absent,
  to_regclass('public.workflow_button_replies') is null as replies_absent,
  to_regclass('public.workflow_button_ingress') is null as ingress_absent,
  not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='workflow_executions' and column_name='question_buttons_definition') as column_absent,
  not exists(select 1 from public.organizations where slug like 'button-rollback-%') as fixtures_absent`;
function clean(result) {
  return result[0] && Object.values(result[0]).every(value => value === true);
}
const before = await query(check);
if (!clean(before)) throw new Error('Candidate schema or test fixtures already exist; refusing to overwrite state.');
const migration = suites[suite].migrations.map(file => readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8')).join('\n');
const fixtures = [suites[suite].fixture].flat().map(file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).join('\n');
if (/\b(COMMIT|BEGIN\s+TRANSACTION)\s*;/i.test(migration + fixtures)) {
  throw new Error('Transaction control is forbidden in migration/test input.');
}
let result;
let failure;
try {
  result = await query(`BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s';\n${migration}\n${fixtures}\nROLLBACK;`);
} catch (error) {
  failure = error;
}
// Separate connection proves cleanup even after an assertion fails and aborts the transaction.
const after = await query(check);
console.log(JSON.stringify({ tested_at: new Date().toISOString(), project, suite, transaction: 'rollback', before, result, after }, null, 2));
if (!clean(after)) throw new Error('Rollback cleanup not confirmed. Inspect target before retrying.');
if (failure) throw failure;
