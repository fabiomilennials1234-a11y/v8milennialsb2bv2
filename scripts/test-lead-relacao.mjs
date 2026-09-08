/** Executes the actual migration and regression assertions on a preview, rolled back. */
import { readFileSync } from 'node:fs';

const ref = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !/^[a-z]{20}$/.test(ref) || ['jsjsmuncfkbsbzqzqhfq', 'bcfadphgsibjzivtbjvc'].includes(ref)) {
  throw new Error('Pass a Supabase preview ref, never production or retired dev');
}
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const branches = await fetch('https://api.supabase.com/v1/projects/jsjsmuncfkbsbzqzqhfq/branches', { headers });
if (!branches.ok) throw new Error(`Cannot verify preview: HTTP ${branches.status}`);
if (!(await branches.json()).some((branch) => branch.project_ref === ref && !branch.is_default)) {
  throw new Error('Target is not a non-default preview of this project');
}

const schema = `lead_relacao_test_${Date.now()}`;
const migration = readFileSync('supabase/migrations/20271018000000_lead_relacao_ganho_perdido.sql', 'utf8')
  .replace(/^BEGIN;|^COMMIT;/gm, '')
  .replace(/\bpublic\./g, `${schema}.`)
  .replace(/search_path = public, pg_temp/g, `search_path = ${schema}, pg_temp`);
const recovery = readFileSync('scripts/sql/recover-lead-first-sale-20260908.sql', 'utf8')
  .replace(/^BEGIN;|^COMMIT;/gm, '')
  .replace(/\bpublic\./g, `${schema}.`)
  .replace(/\bbackup\b/g, `${schema}_backup`);
const fixture = readFileSync('tests/sql/lead-relacao.sql', 'utf8');
const projection = readFileSync('supabase/migrations/20271018000001_lead_relacao_authenticated_performance.sql', 'utf8')
  .replace(/^BEGIN;|^COMMIT;/gm, '')
  .replace(/\bpublic\./g, `${schema}.`)
  .replace(/search_path=public,pg_temp/g, `search_path=${schema},pg_temp`);
const projectionTest = readFileSync('tests/sql/lead-relacao-projection.sql', 'utf8')
  .replace('-- APPLY_PROJECTION', () => projection).replaceAll('__SCHEMA__', schema);
const query = `BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE SCHEMA ${schema};
SET LOCAL search_path = ${schema}, public;
${fixture.replace('-- APPLY_MIGRATION', () => migration + '\n' + recovery + '\n' + recovery).replaceAll('__SCHEMA__', schema)}
${projectionTest}
ROLLBACK;
SELECT 'lead relation: all SQL assertions passed; fixtures rolled back' AS result;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(45000),
});
const result = await response.text();
if (!response.ok) throw new Error(`SQL regression failed: HTTP ${response.status}: ${result}`);
console.log(result);
