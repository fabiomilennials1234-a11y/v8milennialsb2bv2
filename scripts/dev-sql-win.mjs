/**
 * Execute SQL on DEV (bcfadphgsibjzivtbjvc) via Supabase Management API.
 * Windows variant: reads SUPABASE_ACCESS_TOKEN from .env.local (account-scoped PAT).
 *
 * Usage:
 *   node scripts/dev-sql-win.mjs "SELECT 1"
 *   node scripts/dev-sql-win.mjs --file path/to.sql
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = 'bcfadphgsibjzivtbjvc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const m = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
if (!m) {
  console.error('SUPABASE_ACCESS_TOKEN not found in .env.local');
  process.exit(1);
}
const token = m[1].trim();

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/dev-sql-win.mjs "<sql>" | --file <path>');
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
