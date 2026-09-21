/** Test chat projection against an authorized target with the button base schema. */
import { readFileSync } from 'node:fs';
const project = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!project || !/^[a-z]{20}$/.test(project) || !token) throw new Error('Set an explicitly authorized project and Management API token.');
async function query(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(55_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? `HTTP ${response.status}`);
  return data;
}
const check = "select not exists(select 1 from public.organizations where slug like 'button-rollback-%') as clean, to_regprocedure('public.mirror_workflow_button_message()') is not null as deployed";
const before = await query(check);
if (!before[0]?.clean) throw new Error('Preexisting fixtures; refusing to continue.');
const migration = before[0].deployed ? '' : readFileSync(new URL('../../../supabase/migrations/20271020000069_workflow_button_chat_mirror.sql', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./chat-rollback.sql', import.meta.url), 'utf8');
let failure, result;
try { result = await query(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='20s';\n${migration}\n${fixture}\nROLLBACK;`); }
catch (error) { failure = error; }
const after = await query(check);
console.log(JSON.stringify({ at: new Date().toISOString(), project, result, before, after }, null, 2));
if (!after[0]?.clean || after[0].deployed !== before[0].deployed) throw new Error('Cleanup failed.');
if (failure) throw failure;
