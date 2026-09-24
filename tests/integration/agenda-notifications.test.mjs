import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migrations = readdirSync(new URL('../../supabase/migrations/', import.meta.url));
const fix = migrations.find(name => name.endsWith('_agenda_notification_reminders.sql'));

test('agenda reminders reach internal meetings and follow-ups once per scheduled instant', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
      CREATE TABLE team_members(id uuid PRIMARY KEY, organization_id uuid, user_id uuid, is_active boolean);
      CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, name text, company text, sale_responsible_id uuid, deleted_at timestamptz);
      CREATE TABLE pipeline_entries(id uuid PRIMARY KEY, organization_id uuid, lead_id uuid, assigned_to uuid,
        closed_at timestamptz, metadata jsonb, deal_id uuid);
      CREATE TABLE follow_ups(id uuid PRIMARY KEY, organization_id uuid, lead_id uuid, assigned_to uuid,
        title text, due_date timestamptz, completed_at timestamptz, archived_at timestamptz);
      CREATE TABLE meetings(id uuid PRIMARY KEY, organization_id uuid, lead_id uuid, title text, start_at timestamptz,
        end_at timestamptz, created_by uuid, status text DEFAULT 'scheduled', event_type text DEFAULT 'meeting',
        all_day boolean DEFAULT false, pipeline_entry_id uuid, booked_event_id uuid, deal_id uuid);
      CREATE TABLE meeting_participants(meeting_id uuid, team_member_id uuid, status text DEFAULT 'pending');
      CREATE TABLE meeting_events(id uuid PRIMARY KEY, organization_id uuid, source_entry_id uuid,
        booked_event_id uuid, event_type text, meeting_date timestamptz);
      CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid,
        type text, title text, description text, link text, lead_id uuid, entity_id uuid, group_key text,
        event_count integer DEFAULT 1, last_event_at timestamptz, created_at timestamptz DEFAULT now(), read_at timestamptz);
      CREATE UNIQUE INDEX notifications_unread_group_key_uniq ON notifications(user_id,group_key)
        WHERE read_at IS NULL AND group_key IS NOT NULL;
      CREATE FUNCTION fn_dono_do_lead(uuid) RETURNS uuid LANGUAGE sql AS $$
        SELECT tm.user_id FROM leads l JOIN team_members tm ON tm.id=l.sale_responsible_id
        WHERE l.id=$1 AND tm.organization_id=l.organization_id AND tm.is_active $$;
      INSERT INTO team_members VALUES
        ('${id(1)}','${id(100)}','${id(11)}',true), ('${id(2)}','${id(100)}','${id(12)}',true),
        ('${id(3)}','${id(200)}','${id(13)}',true), ('${id(4)}','${id(100)}','${id(14)}',false);
      INSERT INTO leads(id,organization_id,name,sale_responsible_id) VALUES('${id(30)}','${id(100)}','Lead','${id(1)}');
    `);
    const foundation = sql('20260831200000_avisos_fundacao.sql');
    await db.exec(foundation.slice(foundation.indexOf('CREATE OR REPLACE FUNCTION public.fn_emit_aviso(')));
    await db.exec(sql('20260831250000_avisos_varreduras.sql'));
    if (fix && !process.env.NOTIFICATION_BASELINE) await db.exec(sql(fix));
    await db.exec(`
      INSERT INTO meetings(id,organization_id,title,start_at,created_by) VALUES
        ('${id(40)}','${id(100)}','Reunião interna',now()+interval '10 minutes','${id(11)}');
      INSERT INTO meeting_participants VALUES
        ('${id(40)}','${id(1)}','accepted'), ('${id(40)}','${id(2)}','accepted'),
        ('${id(40)}','${id(3)}','accepted'), ('${id(40)}','${id(4)}','accepted');
      SELECT fn_varredura_avisos_reuniao_proxima();
    `);
    let rows = (await db.query('SELECT user_id,type,link FROM notifications ORDER BY user_id')).rows;
    assert.deepEqual(rows.map(r => r.user_id), [id(11),id(12)], 'internal meeting reaches creator and active same-org participants');
    assert.ok(rows.every(r => r.type==='meeting_soon' && r.link.startsWith('/agenda')));
    await db.exec(`UPDATE notifications SET read_at=now(); SELECT fn_varredura_avisos_reuniao_proxima();`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,2,'reading does not rearm reminder');
    await db.exec(`UPDATE meetings SET start_at=start_at+interval '5 minutes'; SELECT fn_varredura_avisos_reuniao_proxima();`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,4,'reschedule within same hour creates a new reminder');
    await db.exec(`
      INSERT INTO follow_ups(id,organization_id,lead_id,assigned_to,title,due_date) VALUES
        ('${id(50)}','${id(100)}','${id(30)}','${id(2)}','Contato',now()+interval '10 minutes'),
        ('${id(51)}','${id(100)}','${id(30)}','${id(2)}','Depois',now()+interval '2 hours');
      SELECT fn_varredura_avisos_followups();
    `);
    rows=(await db.query("SELECT user_id,entity_id,link FROM notifications WHERE type='follow_up_due'")).rows;
    assert.deepEqual(rows.map(r=>r.entity_id),[id(50)],'timed follow-up arrives near its due time');
    assert.equal(rows[0].user_id,id(12)); assert.ok(rows[0].link.startsWith('/agenda'));
    await db.exec(`UPDATE notifications SET read_at=now(); SELECT fn_varredura_avisos_followups();`);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM notifications WHERE entity_id='${id(50)}'`)).rows[0].n,1);

    // Other organization, declined/inactive invitees, cancelled/completed
    // appointments and projections must not leak or duplicate reminders.
    await db.exec(`
      INSERT INTO meetings(id,organization_id,title,start_at,created_by,event_type) VALUES
        ('${id(41)}','${id(100)}','Retornar contato',now()+interval '10 minutes','${id(11)}','follow_up'),
        ('${id(42)}','${id(200)}','Outra org',now()+interval '10 minutes','${id(13)}','meeting'),
        ('${id(43)}','${id(100)}','Cancelada',now()+interval '10 minutes','${id(11)}','meeting'),
        ('${id(44)}','${id(100)}','Concluída',now()+interval '10 minutes','${id(11)}','meeting');
      UPDATE meetings SET status='cancelled' WHERE id='${id(43)}';
      UPDATE meetings SET status='completed' WHERE id='${id(44)}';
      INSERT INTO meeting_participants VALUES ('${id(41)}','${id(2)}','declined');
      INSERT INTO pipeline_entries(id,organization_id,lead_id,assigned_to,metadata) VALUES
        ('${id(60)}','${id(100)}','${id(30)}','${id(2)}',jsonb_build_object('meeting_date',now()+interval '10 minutes')),
        ('${id(61)}','${id(100)}','${id(30)}','${id(2)}',jsonb_build_object('meeting_date','not-a-date')),
        ('${id(62)}','${id(100)}','${id(30)}','${id(2)}',jsonb_build_object('meeting_date',now()+interval '10 minutes',
           'agenda_espelho',jsonb_build_object('meeting_id','${id(43)}'))),
        ('${id(63)}','${id(100)}','${id(30)}','${id(2)}',jsonb_build_object('meeting_date',now()+interval '11 minutes'));
      INSERT INTO meeting_events VALUES
        ('${id(70)}','${id(100)}','${id(63)}',NULL,'meeting_booked',now()+interval '11 minutes'),
        ('${id(71)}','${id(100)}','${id(63)}','${id(70)}','meeting_held',now()+interval '11 minutes');
      SELECT fn_varredura_avisos_reuniao_proxima();
    `);
    rows=(await db.query(`SELECT entity_id,user_id,organization_id,type FROM notifications
      WHERE entity_id IN ('${id(41)}','${id(42)}','${id(43)}','${id(44)}','${id(60)}','${id(61)}','${id(62)}','${id(63)}') ORDER BY entity_id`)).rows;
    assert.deepEqual(rows.map(r=>[r.entity_id,r.user_id,r.organization_id,r.type]),[
      [id(41),id(11),id(100),'follow_up_due'], [id(42),id(13),id(200),'meeting_soon'],
      [id(60),id(12),id(100),'meeting_soon'],
    ]);
    await db.exec(`UPDATE follow_ups SET completed_at=now(),due_date=now() WHERE id='${id(50)}';
      UPDATE follow_ups SET archived_at=now(),due_date=now() WHERE id='${id(51)}';
      SELECT fn_varredura_avisos_followups();`);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM notifications WHERE entity_id IN ('${id(50)}','${id(51)}')`)).rows[0].n,1);
    for (const fn of ['fn_varredura_avisos_reuniao_proxima','fn_varredura_avisos_followups']) {
      const [access]=(await db.query(`SELECT has_function_privilege('anon','${fn}()','EXECUTE') AS anon,
        has_function_privilege('authenticated','${fn}()','EXECUTE') AS authenticated,
        has_function_privilege('service_role','${fn}()','EXECUTE') AS worker`)).rows;
      assert.deepEqual(access,{anon:false,authenticated:false,worker:true});
    }
    await db.exec(`INSERT INTO notifications(organization_id,user_id,type) VALUES('${id(100)}','${id(11)}','support_ticket_reply')`);
    assert.ok((await db.query("SELECT last_event_at FROM notifications WHERE type='support_ticket_reply'")).rows[0].last_event_at);
    const beforeRollback = (await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n;
    await db.exec(sql(`rollback/${fix}`));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,beforeRollback,'rollback preserves history');
    assert.equal((await db.query("SELECT to_regclass('notifications_reminder_lookup_idx') AS idx")).rows[0].idx,null);
    assert.match((await db.query("SELECT pg_get_functiondef('fn_varredura_avisos_reuniao_proxima()'::regprocedure) AS definition")).rows[0].definition,/interval '1 hour'/);
  } finally { await db.close(); }
});
