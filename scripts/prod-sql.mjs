/**
 * Execute SQL on PROD (jsjsmuncfkbsbzqzqhfq) via Supabase Management API.
 * Token read from macOS keychain (Supabase CLI login) at runtime — never logged.
 *
 * Usage:
 *   node scripts/prod-sql.mjs "SELECT 1"
 *   node scripts/prod-sql.mjs --file path/to.sql
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROJECT_REF = 'jsjsmuncfkbsbzqzqhfq';

let token = execSync('security find-generic-password -s "Supabase CLI" -w', {
  encoding: 'utf8',
}).trim();
if (token.startsWith('go-keyring-base64:')) {
  token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/prod-sql.mjs "<sql>" | --file <path>');
  process.exit(1);
}
const query = arg === '--file' ? readFileSync(process.argv[3], 'utf8') : arg;

const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  }
);

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
