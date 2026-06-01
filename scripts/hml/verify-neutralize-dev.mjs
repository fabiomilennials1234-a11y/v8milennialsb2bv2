#!/usr/bin/env node
/**
 * One-off, NON-DESTRUCTIVE verification of neutralize_hml.sql against a real
 * (dev) Supabase schema, using the node `pg` driver (no psql install needed).
 *
 * Wraps seed + neutralize + assertions in a single transaction that ROLLS BACK:
 * the target database is left UNTOUCHED. Safe for dev. NEVER point at prod.
 *
 * Usage:
 *   PG_CONN='postgres://postgres:PWD@db.bcfadphgsibjzivtbjvc.supabase.co:5432/postgres' \
 *     node scripts/hml/verify-neutralize-dev.mjs
 */
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PG_CONN = process.env.PG_CONN;
if (!PG_CONN) {
  console.error('PG_CONN is required (dev connection string). Refusing to run.');
  process.exit(2);
}
if (PG_CONN.includes('jsjsmuncfkbsbzqzqhfq')) {
  console.error('PG_CONN points at PROD. Refusing — this script is dev-only.');
  process.exit(2);
}

const NEUTRALIZE = readFileSync(
  resolve(process.cwd(), 'scripts/hml/neutralize_hml.sql'),
  'utf8',
);

const c = new Client({ connectionString: PG_CONN, connectionTimeoutMillis: 15000 });
const fail = (msg) => {
  throw new Error(msg);
};

await c.connect();
try {
  await c.query('BEGIN');

  const org = (await c.query('select id from public.organizations limit 1')).rows[0];
  if (!org) fail('no organization in target DB');
  const user = (await c.query('select id from auth.users limit 1')).rows[0];
  if (!user) fail('no auth.users in target DB');

  const inst = (
    await c.query(
      'insert into public.whatsapp_instances (instance_name, organization_id) values ($1,$2) returning id',
      ['hml-verify', org.id],
    )
  ).rows[0];
  await c.query(
    'insert into public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token) values ($1,$2,$3)',
    [inst.id, org.id, 'tok-verify'],
  );
  await c.query(
    "insert into public.copilot_agents (created_by, main_objective, name, organization_id, is_active) values ($1,'verify','hml-verify-agent',$2,true)",
    [user.id, org.id],
  );
  await c.query(
    "insert into public.cron_config (key, value) values ('hml_verify_url','https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/x') on conflict (key) do update set value = excluded.value",
  );

  // Run the real artifact under test.
  await c.query(NEUTRALIZE);

  // Assertions.
  const secrets = (await c.query('select count(*)::int n from public.whatsapp_instance_secrets')).rows[0].n;
  if (secrets !== 0) fail(`layer2: whatsapp_instance_secrets not empty (${secrets})`);

  const leaked = (await c.query("select count(*)::int n from public.cron_config where value like '%jsjsmuncfkbsbzqzqhfq%'")).rows[0].n;
  if (leaked !== 0) fail(`layer3: cron_config still has prod URL (${leaked})`);

  const active = (await c.query('select count(*)::int n from public.copilot_agents where is_active')).rows[0].n;
  if (active !== 0) fail(`layer4: ${active} copilot_agents still active`);

  console.log('VERIFY OK — checked vectors (secrets, cron_config, agents) severed; rolling back.');
} catch (e) {
  console.error('VERIFY FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await c.query('ROLLBACK');
  await c.end();
}
