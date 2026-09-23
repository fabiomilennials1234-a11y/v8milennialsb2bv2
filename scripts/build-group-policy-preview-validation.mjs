import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const name='20271021000028_uazapi_group_source_policy.sql';
// Namespace substitution only; original function bodies, constraints and grants remain intact.
const isolate=sql=>sql.replaceAll('public.','group_policy_test.').replaceAll('search_path = public,','search_path = group_policy_test,').replaceAll('search_path=public,','search_path=group_policy_test,');
export function buildGroupPolicyPreviewValidation(){
 return [
  '-- DISPOSABLE PREVIEW ONLY. No HTTP or provider calls. Isolated fixture schema; entire validation rolls back.',
  "BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s'; CREATE SCHEMA group_policy_test;",
  isolate(read('tests/fixtures/uazapi-group-policy-schema.sql')),
  isolate(read(`supabase/migrations/${name}`)),
  isolate(read('tests/integration/uazapi-group-policy.sql')),
  isolate(read(`supabase/migrations/rollback/${name}`)),
  isolate(read(`supabase/migrations/${name}`)),
  "SELECT 'PASS: group policy scoped state, RLS/grants, lease, intent, all-instance activation, rollback/reapply' AS validation;",
  'ROLLBACK;',
 ].join('\n\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw new Error('Usage: node scripts/build-group-policy-preview-validation.mjs /tmp/preview.sql');
 writeFileSync(process.argv[2],buildGroupPolicyPreviewValidation());
}
