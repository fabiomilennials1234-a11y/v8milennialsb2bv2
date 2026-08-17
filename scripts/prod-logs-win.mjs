/**
 * Query PROD edge function logs via Supabase Management API analytics endpoint (Logflare).
 * Usage: node scripts/prod-logs-win.mjs "<sql>"
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = 'jsjsmuncfkbsbzqzqhfq';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const token = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)[1].trim();

const sql = process.argv[2];
if (!sql) { console.error('need sql'); process.exit(1); }

const start = process.argv[3]; // ISO
const end = process.argv[4];    // ISO
let url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`;
if (start) url += `&iso_timestamp_start=${encodeURIComponent(start)}`;
if (end) url += `&iso_timestamp_end=${encodeURIComponent(end)}`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const body = await res.text();
if (!res.ok) { console.error(`HTTP ${res.status}: ${body}`); process.exit(1); }
try { console.log(JSON.stringify(JSON.parse(body), null, 2)); } catch { console.log(body); }
