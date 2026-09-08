/** Run the real condition integration seam on an explicitly verified preview.
 * Credentials stay in memory and are passed only to the test child process.
 * Usage: node scripts/test-guided-preview.mjs <preview-ref> [test-name-pattern]
 */
import { execFileSync, spawnSync } from 'node:child_process';

const parent = 'jsjsmuncfkbsbzqzqhfq';
const ref = process.argv[2];
if (!ref || [parent, 'bcfadphgsibjzivtbjvc'].includes(ref)) throw new Error('An explicit preview ref is required');
function cli(args) {
  try { return execFileSync('supabase', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('Supabase preview lookup failed (credential output suppressed)'); }
}
const branches = JSON.parse(cli(['branches', 'list', '--project-ref', parent, '-o', 'json']));
const branch = branches.find(b => !b.is_default && b.project_ref === ref);
if (!branch || branch.preview_project_status !== 'ACTIVE_HEALTHY') throw new Error('Target is not a healthy non-default preview');
const raw = cli(['branches', 'get', branch.id, '--project-ref', parent, '-o', 'env']);
const values = Object.fromEntries(raw.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_]+)\s*=\s*["']?(.*?)["']?$/);
  return match ? [[match[1], match[2]]] : [];
}));
if (values.SUPABASE_URL !== `https://${ref}.supabase.co`) throw new Error('Returned URL does not match preview');
const env = { ...process.env, GUIDED_PREVIEW_REF: ref };
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!values[key]) throw new Error(`Preview did not return ${key}`);
  env[key] = values[key];
}
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/guided-condition.test.ts', ...(process.argv[3] ? ['-t', process.argv[3]] : [])], { env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
