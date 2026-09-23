import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const read = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
export function buildIngressInboxValidation() {
  const isolated = source => source.replace(/\bpublic\b/g,'capacity_ingress_test');
  return [
    '-- Disposable preview only. Schema-isolated migration/fixtures, no outbound operations.',
    "BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';",
    'CREATE SCHEMA capacity_ingress_test;',
    isolated(read('tests/fixtures/whatsapp-ingress-inbox-schema.sql')),
    isolated(read('supabase/migrations/20271021000029_whatsapp_ingress_durable_inbox.sql')),
    isolated(read('tests/integration/whatsapp-ingress-inbox.sql')),
    'ROLLBACK;',
  ].join('\n\n');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]) throw new Error('Usage: node scripts/build-ingress-inbox-preview-validation.mjs /tmp/preview.sql');
  writeFileSync(process.argv[2],buildIngressInboxValidation());
}
