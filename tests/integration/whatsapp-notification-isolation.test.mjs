import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (name) => readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('WhatsApp previews follow number assignments, not shared lead ownership', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
        $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
      CREATE TABLE team_members(id uuid PRIMARY KEY, user_id uuid, organization_id uuid, is_active boolean, role text);
      CREATE TABLE whatsapp_instances(id uuid PRIMARY KEY, organization_id uuid);
      CREATE TABLE whatsapp_instance_allowed_members(whatsapp_instance_id uuid, team_member_id uuid);
      CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, name text, company text,
        sale_responsible_id uuid, closer_id uuid, pre_sale_responsible_id uuid, sdr_id uuid, responsible_id uuid);
      CREATE TABLE whatsapp_messages(id uuid DEFAULT gen_random_uuid(), organization_id uuid, instance_id uuid,
        lead_id uuid, direction text, is_group boolean, sent_by_ai boolean, received_via text,
        phone_number text, push_name text, content text, timestamp timestamptz DEFAULT now());
      CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid,
        type text, title text, description text, link text, lead_id uuid, entity_id uuid,
        group_key text, event_count integer DEFAULT 1, last_event_at timestamptz,
        created_at timestamptz DEFAULT now(), read_at timestamptz, pushed_at timestamptz);
      CREATE UNIQUE INDEX notifications_unread_group_key_uniq ON notifications(user_id,group_key)
        WHERE read_at IS NULL AND group_key IS NOT NULL;
      CREATE TABLE user_presence(user_id uuid, organization_id uuid,last_seen_at timestamptz);
      CREATE TABLE push_subscriptions(user_id uuid);
      CREATE FUNCTION fn_preferencias_de_aviso(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"push_enabled":true}'::jsonb $$;
      CREATE FUNCTION can_see_chat_scope(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION normalize_brazilian_phone(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
      CREATE FUNCTION is_master_user() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${id(99)}'::uuid $$;
      CREATE FUNCTION get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER AS
        $$ SELECT organization_id FROM public.team_members WHERE user_id=auth.uid() AND is_active $$;
      CREATE FUNCTION is_org_admin(uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS
        $$ SELECT EXISTS(SELECT 1 FROM public.team_members WHERE organization_id=$1 AND user_id=auth.uid() AND is_active AND role='admin') $$;
      ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_notifications ON notifications TO authenticated USING(user_id=auth.uid() OR is_master_user());
      ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
      CREATE POLICY org_instances ON whatsapp_instances TO authenticated
        USING(organization_id IN(SELECT get_my_organization_ids()) OR is_master_user());
      GRANT USAGE ON SCHEMA auth,private TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      INSERT INTO team_members VALUES
        ('${id(1)}','${id(11)}','${id(100)}',true,'member'),
        ('${id(2)}','${id(12)}','${id(100)}',true,'member'),
        ('${id(3)}','${id(13)}','${id(100)}',true,'admin'),
        ('${id(4)}','${id(14)}','${id(200)}',true,'member');
      INSERT INTO whatsapp_instances VALUES
        ('${id(21)}','${id(100)}'),('${id(22)}','${id(100)}'),
        ('${id(23)}','${id(100)}'),('${id(24)}','${id(200)}');
      INSERT INTO whatsapp_instance_allowed_members VALUES
        ('${id(21)}','${id(1)}'),('${id(22)}','${id(2)}'),('${id(24)}','${id(4)}');
      INSERT INTO leads(id,organization_id,name,sale_responsible_id)
        VALUES('${id(31)}','${id(100)}','Shared customer','${id(2)}');
      INSERT INTO push_subscriptions VALUES('${id(11)}'),('${id(12)}');
    `);
    const foundation = sql('20260831200000_avisos_fundacao');
    await db.exec(foundation.slice(foundation.indexOf('CREATE OR REPLACE FUNCTION public.fn_emit_aviso(')));
    await db.exec(sql('20260831210000_avisos_produtor_mensagem'));
    const incoming = (box, lead = id(31), content = 'hello') => db.exec(`
      INSERT INTO whatsapp_messages(organization_id,instance_id,lead_id,direction,phone_number,content)
      VALUES('${id(100)}','${id(box)}',${lead ? `'${lead}'` : 'NULL'},'incoming','5548999999999','${content}')`);
    // Deterministic reproduction: the owner of the shared lead receives a preview
    // from another member's number with the original production trigger.
    await incoming(21);
    assert.equal((await db.query('SELECT user_id FROM notifications')).rows[0].user_id,id(12));
    await db.exec(sql('20260916144825_isolate_whatsapp_notifications'));
    // A malformed cross-org allowlist row must never produce a notification.
    await db.exec(`INSERT INTO whatsapp_instance_allowed_members VALUES('${id(21)}','${id(4)}')`);
    await incoming(21);
    await incoming(21);
    await incoming(22);
    await incoming(23); // Unassigned number must not broadcast.
    let rows = (await db.query('SELECT * FROM notifications WHERE whatsapp_instance_id IS NOT NULL ORDER BY user_id')).rows;
    assert.equal(rows.length,2);
    assert.equal(rows[0].user_id,id(11)); assert.equal(rows[0].event_count,2);
    assert.equal(rows[1].user_id,id(12)); assert.notEqual(rows[0].group_key,rows[1].group_key);
    assert.ok(rows[0].link.includes(`instance=${id(21)}&phone=5548999999999`));
    await incoming(21,null,'without lead');
    assert.equal((await db.query(`SELECT event_count FROM notifications WHERE user_id='${id(11)}'`)).rows[0].event_count,3);
    for (const extra of ["'outgoing',false,false,NULL", "'incoming',true,false,NULL", "'incoming',false,true,NULL", "'incoming',false,false,'history_sync'"]) {
      await db.exec(`INSERT INTO whatsapp_messages(organization_id,instance_id,phone_number,direction,is_group,sent_by_ai,received_via)
        VALUES('${id(100)}','${id(21)}','5548999999999',${extra})`);
    }
    assert.equal((await db.query(`SELECT event_count FROM notifications WHERE user_id='${id(11)}'`)).rows[0].event_count,3);

    const asUser = async (user, query) => {
      await db.exec(`SET ROLE authenticated; SET test.user_id='${id(user)}'`);
      try { return (await db.query(query)).rows; } finally { await db.exec('RESET ROLE'); }
    };
    assert.equal((await asUser(11,'SELECT * FROM notifications')).length,1);
    assert.equal((await asUser(12,'SELECT * FROM notifications')).length,1); // Legacy preview hidden.
    assert.equal((await asUser(14,'SELECT * FROM notifications')).length,0);
    assert.deepEqual((await asUser(11,'SELECT id FROM whatsapp_instances')).map(r=>r.id),[id(21)]);
    assert.equal((await asUser(13,'SELECT * FROM whatsapp_instances')).length,3);
    assert.equal((await asUser(99,'SELECT * FROM whatsapp_instances')).length,4);
    assert.equal((await asUser(11,`SELECT whatsapp_readable_instance_ids('${id(100)}',ARRAY['${id(22)}'::uuid]) AS ids`))[0].ids.length,0);
    assert.equal((await asUser(11,`SELECT can_see_chat_target('${id(100)}',NULL,'5548999999999',NULL,'${id(21)}') AS allowed`))[0].allowed,true);
    assert.equal((await asUser(11,`SELECT can_see_chat_target('${id(100)}',NULL,'5548999999999',NULL,'${id(22)}') AS allowed`))[0].allowed,false);
    assert.equal((await asUser(11,`SELECT can_see_chat_target('${id(100)}',NULL,'5548999999999') AS allowed`))[0].allowed,false);
    await assert.rejects(asUser(11,`SELECT whatsapp_readable_instance_ids('${id(200)}')`),/forbidden/);
    assert.equal((await db.query('SELECT * FROM fn_avisos_pendentes_de_push()')).rows.length,2);
    await db.exec(`DELETE FROM whatsapp_instance_allowed_members WHERE team_member_id='${id(1)}'`);
    assert.equal((await asUser(11,'SELECT * FROM notifications')).length,0);
    assert.equal((await asUser(11,'SELECT * FROM whatsapp_instances')).length,0);
    assert.equal((await db.query('SELECT * FROM fn_avisos_pendentes_de_push()')).rows.length,1);
    await db.exec(`UPDATE team_members SET is_active=false WHERE id='${id(2)}'`);
    assert.equal((await db.query('SELECT * FROM fn_avisos_pendentes_de_push()')).rows.length,0);
    await db.exec(`INSERT INTO notifications(user_id,organization_id,type,title)
      VALUES('${id(11)}','${id(100)}','meeting_soon','Own meeting')`);
    assert.equal((await asUser(11,'SELECT * FROM notifications')).length,1);
  } finally { await db.close(); }
});
