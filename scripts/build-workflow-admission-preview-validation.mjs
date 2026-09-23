import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const name = '20271021000030_workflow_stage_http_admission.sql';
// Only namespace/transport substitution. No protected public/auth/net objects
// are created, replaced or invoked. Every fixture object is rolled back.
const isolate = sql => sql.replaceAll('public.', 'workflow_admission_test.')
  .replaceAll("search_path TO 'public'", "search_path TO 'workflow_admission_test'")
  .replaceAll('auth.uid()', 'workflow_admission_test.uid()')
  .replaceAll('net.http_post(', 'workflow_admission_test.http_post(');
export function buildWorkflowAdmissionPreviewValidation() {
  const migration = isolate(read(`supabase/migrations/${name}`));
  const rollback = isolate(read(`supabase/migrations/rollback/${name}`));
  return [
    '-- DISPOSABLE PREVIEW ONLY. Isolated schema, mocked HTTP and auth, full rollback.',
    "BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s'; CREATE SCHEMA workflow_admission_test;",
    read('tests/fixtures/workflow-stage-admission-schema.sql'),
    rollback,
    `REVOKE ALL ON FUNCTION workflow_admission_test.trigger_workflow_pipeline_stage_changed() FROM PUBLIC,anon;
     GRANT EXECUTE ON FUNCTION workflow_admission_test.trigger_workflow_pipeline_stage_changed() TO authenticated,service_role;
     CREATE TRIGGER fixture_stage_changed AFTER UPDATE OF stage_key,stage_id ON workflow_admission_test.pipeline_entries
     FOR EACH ROW WHEN(OLD.stage_key IS DISTINCT FROM NEW.stage_key) EXECUTE FUNCTION workflow_admission_test.trigger_workflow_pipeline_stage_changed();`,
    migration,
    read('tests/integration/workflow-stage-admission.sql'),
    rollback,
    'TRUNCATE workflow_admission_test.workflows; SELECT workflow_admission_test.assert_move(1);',
    migration,
    'SELECT workflow_admission_test.assert_move(0);',
    "SELECT 'PASS: workflow admission tenant/active/derived, complete payload/auth/actor, non-retroactive enable, security, rollback/reapply' AS validation;",
    'ROLLBACK;',
  ].join('\n\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/build-workflow-admission-preview-validation.mjs /tmp/preview.sql');
  writeFileSync(process.argv[2], buildWorkflowAdmissionPreviewValidation());
}
