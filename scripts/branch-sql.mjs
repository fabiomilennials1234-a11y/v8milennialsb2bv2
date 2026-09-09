/**
 * Execute SQL on a Supabase preview branch via the Management API.
 *
 * A preview branch has no public DNS for `db.<ref>` and the pooler refuses the
 * tenant, so psql/pg_prove cannot reach it — the Management API is the only
 * door. Token read from the macOS keychain (Supabase CLI login) at runtime,
 * never logged.
 *
 * Usage:
 *   SUPABASE_BRANCH_REF=<ref> node scripts/branch-sql.mjs "SELECT 1"
 *   SUPABASE_BRANCH_REF=<ref> node scripts/branch-sql.mjs --file path/to.sql
 *   node scripts/branch-sql.mjs --ref <ref> --file path/to.sql
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);

function takeFlag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}

const ref = takeFlag('--ref') ?? process.env.SUPABASE_BRANCH_REF;
if (!ref) {
  console.error('missing branch ref: pass --ref <ref> or set SUPABASE_BRANCH_REF');
  process.exit(1);
}
if (ref === 'jsjsmuncfkbsbzqzqhfq') {
  console.error('refusing to run: that is the production ref. Use scripts/prod-sql.mjs deliberately.');
  process.exit(1);
}

const filePath = takeFlag('--file');
const query = filePath ? readFileSync(filePath, 'utf8') : argv[0];
if (!query) {
  console.error('usage: node scripts/branch-sql.mjs [--ref <ref>] "<sql>" | --file <path>');
  process.exit(1);
}

let token = execSync('security find-generic-password -s "Supabase CLI" -w', {
  encoding: 'utf8',
}).trim();
if (token.startsWith('go-keyring-base64:')) {
  token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
});

const body = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${body}`);
  process.exit(1);
}
try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body);
}
