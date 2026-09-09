import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Install @electric-sql/pglite@0.5.8 in a disposable directory; pass its dist/index.js.
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const org = '10000000-0000-0000-0000-000000000001';
const box = n => '20000000-0000-0000-0000-00000000000' + n;
const user = n => '00000000-0000-0000-0000-00000000000' + n;
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
async function login(n, role = 'authenticated') {
  await db.exec('RESET ROLE;');
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: n ? user(n) : null, role })]);
  await db.exec('SET LOCAL ROLE ' + role);
}
async function count(table, id) {
  const result = await db.query('SELECT count(*)::int AS n FROM chat_access_test.' + table + (id ? ' WHERE instance_id=$1' : ''), id ? [id] : []);
  return result.rows[0].n;
}
async function list(fn, id) {
  return (await db.query('SELECT count(*)::int AS n FROM chat_access_test.' + fn + '($1::uuid,$2::uuid)', [org, id])).rows[0].n;
}
try {
  await db.exec(`
    BEGIN;
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims',true)::jsonb->>'role' $$;
  `);
  await db.exec(readFileSync(new URL('../tests/fixtures/chat-instance-access-schema.sql', import.meta.url), 'utf8'));
  await login(1);
  eq(await count('whatsapp_messages', box(2)), 1, 'baseline reproduces foreign messages');
  eq(await list('get_whatsapp_conversation_list', box(2)), 1, 'baseline reproduces foreign list');
  console.log('RED reproduced: member reads another instance through messages and single-box RPC');
  await db.exec('RESET ROLE;');
  const migration = readFileSync(new URL('../supabase/migrations/20271019000002_enforce_whatsapp_instance_read_access.sql', import.meta.url), 'utf8')
    .replaceAll('public.', 'chat_access_test.')
    .replaceAll("'public'", "'chat_access_test'")
    .replaceAll('private.', 'chat_access_private_test.')
    .replaceAll('SCHEMA IF NOT EXISTS private', 'SCHEMA IF NOT EXISTS chat_access_private_test')
    .replaceAll('SCHEMA private TO', 'SCHEMA chat_access_private_test TO');
  await db.exec(migration);
  for (const member of [1,2]) {
    await login(member);
    for (const table of ['whatsapp_messages','whatsapp_conversation_summary','whatsapp_conversations','channel_messages']) {
      eq(await count(table, box(member)), 1, table + ' own box visible');
      eq(await count(table, box(member === 1 ? 2 : 1)), 0, table + ' other box hidden');
      eq(await count(table, box(3)), member === 1 ? 1 : 0, table + ' historical box follows live access');
      eq(await count(table, box(4)), 0, table + ' orphan hidden for member');
    }
    for (const fn of ['get_whatsapp_conversation_list','get_official_whatsapp_conversation_list']) {
      eq(await list(fn, box(member)), 1, fn + ' own box visible');
      eq(await list(fn, box(member === 1 ? 2 : 1)), 0, fn + ' other box hidden');
    }
    eq((await db.query('SELECT chat_access_test.whatsapp_chip_instance_ids($1,$2) AS ids',[org,box(member === 1 ? 2 : 1)])).rows[0].ids, [], 'cannot resolve another box history');
  }
  for (const admin of [3,9]) {
    await login(admin);
    for (const table of ['whatsapp_messages','whatsapp_conversation_summary','whatsapp_conversations','channel_messages']) {
      eq(await count(table), 4, table + ' admin/master sees all including orphan history');
    }
    for (const fn of ['get_whatsapp_conversation_list','get_official_whatsapp_conversation_list']) {
      for (const id of [box(1),box(2)]) eq(await list(fn,id),1,fn + ' admin/master can select each box');
    }
  }
  for (const denied of [4,5]) {
    await login(denied);
    eq(await count('whatsapp_messages'),0,'inactive and foreign-org admin cannot read messages');
    // Catch inside a savepoint so the transaction remains usable.
    await db.exec('SAVEPOINT denied_access;');
    await assert.rejects(list('get_whatsapp_conversation_list',box(1)), /forbidden/);
    checks++;
    await db.exec('ROLLBACK TO SAVEPOINT denied_access;');
  }
  await login(null,'anon');
  await db.exec('SAVEPOINT anon_access;');
  await assert.rejects(db.query('SELECT chat_access_private_test.whatsapp_readable_message_instance_ids()'), /permission denied/);
  checks++;
  await db.exec('ROLLBACK TO SAVEPOINT anon_access;');
  await login(null,'service_role');
  eq((await db.query('SELECT chat_access_test.whatsapp_chip_instance_ids($1,$2) AS ids',[org,box(1)])).rows[0].ids.sort(),[box(1),box(3)].sort(),'service worker retains history resolution');
  console.log('GREEN: ' + checks + ' SQL assertions passed');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
