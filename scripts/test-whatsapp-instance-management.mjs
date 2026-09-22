import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated SQL fixture: tests the real restrictive policy without customer data.
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let checks=0;
async function eq(actual, expected, message) { assert.deepEqual(await actual,expected,message); checks++; }
async function login(role, org=1) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('test.actor',$1,false),set_config('test.org',$2,false)",[role,id(org)]);
  await db.exec('SET ROLE authenticated');
}
const visible = async table => (await db.query(`SELECT id FROM public.${table} ORDER BY id`)).rows.map(r=>r.id);
try {
  await db.exec(`
    CREATE ROLE authenticated; CREATE SCHEMA private;
    CREATE TABLE whatsapp_instances(id uuid PRIMARY KEY, organization_id uuid, instance_name text);
    CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY, instance_id uuid);
    INSERT INTO whatsapp_instances VALUES ('${id(10)}','${id(1)}','new'),('${id(11)}','${id(1)}','linked'),('${id(12)}','${id(2)}','foreign');
    INSERT INTO whatsapp_messages VALUES ('${id(20)}','${id(10)}'),('${id(21)}','${id(11)}');
    CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.actor')='master' $$;
    CREATE FUNCTION public.can_manage_whatsapp_instances(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT $1=current_setting('test.org')::uuid AND current_setting('test.actor') IN ('manager','admin') $$;
    CREATE FUNCTION private.whatsapp_visible_instance_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN current_setting('test.actor')='linked' THEN ARRAY['${id(11)}'::uuid]
        WHEN current_setting('test.actor')='admin' THEN ARRAY['${id(10)}'::uuid,'${id(11)}'::uuid]
        ELSE ARRAY[]::uuid[] END $$;
    GRANT USAGE ON SCHEMA private TO authenticated;
    GRANT SELECT,UPDATE ON whatsapp_instances TO authenticated;
    GRANT SELECT ON whatsapp_messages TO authenticated;
    ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY org_read ON whatsapp_instances FOR SELECT TO authenticated USING
      (organization_id=current_setting('test.org')::uuid OR public.is_master_user());
    CREATE POLICY management_update ON whatsapp_instances FOR UPDATE TO authenticated USING
      (public.can_manage_whatsapp_instances(organization_id) OR public.is_master_user());
    CREATE POLICY whatsapp_instances_linked_read ON whatsapp_instances AS RESTRICTIVE FOR SELECT TO authenticated USING
      ((SELECT public.is_master_user()) OR id=ANY((SELECT private.whatsapp_visible_instance_ids())::uuid[]));
    CREATE POLICY message_read ON whatsapp_messages FOR SELECT TO authenticated USING
      ((SELECT public.is_master_user()) OR instance_id=ANY((SELECT private.whatsapp_visible_instance_ids())::uuid[]));
  `);
  await login('manager');
  await eq(visible('whatsapp_instances'),[],'RED: manager cannot read newly created connection');
  await db.exec('RESET ROLE');
  if (!process.argv.includes('--before')) await db.exec(await readFile(new URL('../supabase/migrations/20271021000023_allow_whatsapp_instance_management_read.sql',import.meta.url),'utf8'));
  await login('manager');
  await eq(visible('whatsapp_instances'),[id(10),id(11)],'manager must see own organization settings');
  await eq(visible('whatsapp_messages'),[],'management does not grant conversations');
  const updated=await db.query('UPDATE whatsapp_instances SET instance_name=$1 WHERE id=$2 RETURNING id',['renamed',id(10)]);
  await eq(updated.rows.map(r=>r.id),[id(10)],'manager can persist connection settings');
  await login('member'); await eq(visible('whatsapp_instances'),[],'unlinked member still denied');
  await login('linked'); await eq(visible('whatsapp_instances'),[id(11)],'linked member sees only own box');
  await eq(visible('whatsapp_messages'),[id(21)],'linked member retains only own conversations');
  await login('admin'); await eq(visible('whatsapp_instances'),[id(10),id(11)],'admin preserved');
  await login('manager',2); await eq(visible('whatsapp_instances'),[id(12)],'foreign manager cannot read target org');
  await login('master'); await eq(visible('whatsapp_instances'),[id(10),id(11),id(12)],'master preserved');
  await login('inactive'); await eq(visible('whatsapp_instances'),[],'inactive/no-grant actor denied');
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL('../supabase/migrations/rollback/20271021000023_allow_whatsapp_instance_management_read.sql',import.meta.url),'utf8'));
  await login('manager'); await eq(visible('whatsapp_instances'),[],'rollback restores former restriction');
  console.log(`PASS ${checks} SQL assertions`);
} finally { await db.close(); }
