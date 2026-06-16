/**
 * Print the PROD service_role key to stdout (for shell capture only — do not log).
 * Token from macOS keychain (Supabase CLI login).
 */
import { execSync } from 'node:child_process';

const PROJECT_REF = 'jsjsmuncfkbsbzqzqhfq';

let token = execSync('security find-generic-password -s "Supabase CLI" -w', {
  encoding: 'utf8',
}).trim();
if (token.startsWith('go-keyring-base64:')) {
  token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}
const keys = await res.json();
const svc = keys.find((k) => k.name === 'service_role');
if (!svc) {
  console.error('service_role key not found');
  process.exit(1);
}
process.stdout.write(svc.api_key);
