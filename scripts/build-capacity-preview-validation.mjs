import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const literal = value => `'${value.replaceAll("'", "''")}'`;
const migrations = ['20271021000026_cron_skip_idle_dispatch.sql', '20271021000027_cron_skip_idle_campaigns.sql'];

// Validate ORIGINAL definitions before replacing only their transport call.
// This avoids touching Supabase's protected pg_net schema or sending requests.
function verifyOriginals(sources) {
  const checks = [];
  const signatures = [];
  for (const source of sources) {
    const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?SET search_path TO ([^\n]+)\nAS \$function\$\n([\s\S]*?)\$function\$;/g;
    for (const [, name, args, searchPath, body] of source.matchAll(re)) {
      const signature = `public.${name}(${args ? 'text' : ''})`;
      signatures.push(signature);
      const pathConfig = `search_path=${searchPath.replaceAll("'", '')}`;
      checks.push(`
  SELECT * INTO p FROM pg_proc WHERE oid = ${literal(signature)}::regprocedure;
  IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY[${literal(pathConfig)}]::text[]
    OR btrim(p.prosrc, E' \\n\\r\\t') IS DISTINCT FROM ${literal(body.trim())}
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Original definition/security mismatch: %', ${literal(signature)};
  END IF;`);
    }
  }
  if (signatures.length !== 12 || new Set(signatures).size !== 12) {
    throw new Error('Expected twelve distinct dispatcher definitions; update generator for signature changes');
  }
  return { signatures, sql: `DO $verify$ DECLARE p pg_proc%ROWTYPE; BEGIN\n${checks.join('\n')}\nEND $verify$;` };
}

function redirectTransport(signatures) {
  return `-- Behavioral copies only: same body except transport namespace.
DO $redirect$ DECLARE sig text; original text; BEGIN
  FOREACH sig IN ARRAY ARRAY[${signatures.map(literal).join(',')}] LOOP
    original := pg_get_functiondef(sig::regprocedure);
    IF position('net.http_post' IN original) = 0 THEN
      RAISE EXCEPTION 'Missing original HTTP call: %', sig;
    END IF;
    EXECUTE replace(original, 'net.http_post', 'capacity_test_net.http_post');
  END LOOP;
END $redirect$;`;
}

function assertEmpty(signatures, expected) {
  return signatures.map(sig => sig.endsWith('(text)')
    ? `SELECT public.fixture_assert_call('invoke_oraculo_feedback_worker(''alerts'')', ${expected}, '{"mode":"alerts"}');`
    : `SELECT public.fixture_assert_dispatch(${literal(sig.slice('public.'.length, -2))}, ${expected});`
  ).join('\n');
}

export function buildCapacityPreviewValidation() {
  const originals = migrations.map(name => read(`supabase/migrations/${name}`));
  const rollbacks = [...migrations].reverse().map(name => read(`supabase/migrations/rollback/${name}`));
  const originalCheck = verifyOriginals(originals);
  const rollbackCheck = verifyOriginals(rollbacks);
  const fixture = read('tests/fixtures/cron-idle-dispatch-schema.sql')
    .replace('CREATE SCHEMA IF NOT EXISTS net;', 'CREATE SCHEMA capacity_test_net;')
    .replace('CREATE OR REPLACE FUNCTION net.http_post(', 'CREATE FUNCTION capacity_test_net.http_post(')
    .replace('-- In a disposable Supabase preview this replaces pg_net\'s entry point inside\n-- the test transaction. No request is enqueued, including hardcoded URLs.',
      '-- Dedicated transport collector. Protected net schema remains untouched.');
  return [
    '-- EMPTY DISPOSABLE PREVIEW ONLY. No pg_net mutations, no real HTTP, no production execution.',
    '-- Original DDL/security validated; behavioral copies use mocked HTTP. Everything rolls back.',
    "BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s';",
    fixture,
    read('tests/fixtures/cron-idle-campaigns-schema.sql'),
    ...originals,
    originalCheck.sql,
    redirectTransport(originalCheck.signatures),
    read('tests/integration/cron-idle-dispatch.sql'),
    read('tests/integration/cron-idle-campaigns.sql'),
    ...rollbacks,
    rollbackCheck.sql,
    redirectTransport(rollbackCheck.signatures),
    assertEmpty(originalCheck.signatures, 1),
    ...originals,
    originalCheck.sql,
    redirectTransport(originalCheck.signatures),
    assertEmpty(originalCheck.signatures, 0),
    `SELECT public.fixture_assert_call('invoke_oraculo_feedback_worker(''weekly'')', 1, '{"mode":"weekly"}');`,
    "SELECT 'PASS: original DDL/security; twelve behavioral guards with mock HTTP; rollback/reapply' AS validation;",
    'ROLLBACK;',
  ].join('\n\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/build-capacity-preview-validation.mjs /tmp/preview.sql');
  writeFileSync(output, buildCapacityPreviewValidation());
  console.log(`Wrote disposable preview validation: ${output}`);
}
