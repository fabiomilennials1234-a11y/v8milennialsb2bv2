import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const org = '10000000-0000-0000-0000-000000000001';
const otherOrg = '10000000-0000-0000-0000-000000000002';
const instance = '20000000-0000-0000-0000-000000000001';
const otherInstance = '20000000-0000-0000-0000-000000000002';
const stats = (checked, values = {}) => ({checked, planned:0, enqueued:0,
  inconclusive:0, unscanned:0, error:0, ...values});

test('receipt recovery cursor scopes, fences and advances bounded batches', async () => {
  const db = new PGlite();
  const begin = async (o = org, i = instance) => (await db.query(
    'SELECT public.begin_whatsapp_receipt_recovery($1,$2) AS result',[o,i])).rows[0].result;
  const finish = async (lease, result, ids = []) => (await db.query(
    'SELECT public.finish_whatsapp_receipt_recovery($1,$2,$3,$4::jsonb,$5::uuid[]) AS ok',
    [org,instance,lease,JSON.stringify(result),ids])).rows[0].ok;
  const enqueue = async (lease, rowId, status = 'read', observedAt = new Date().toISOString()) =>
    (await db.query('SELECT public.enqueue_whatsapp_receipt_recovery($1,$2,$3,$4,$5,$6) AS id',
      [org,instance,lease,rowId,status,observedAt])).rows[0].id;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY);
      CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
      CREATE TABLE public.whatsapp_messages(
        id uuid PRIMARY KEY, organization_id uuid NOT NULL, instance_id uuid NOT NULL,
        message_id text NOT NULL, remote_jid text NOT NULL, direction text NOT NULL,
        status text NOT NULL, deleted_at timestamptz, created_at timestamptz NOT NULL);
      CREATE TABLE public.whatsapp_instance_secrets(
        instance_id uuid PRIMARY KEY, organization_id uuid NOT NULL,
        uazapi_instance_id text, uazapi_token text NOT NULL);
      CREATE TABLE public.copilot_quotes(id uuid PRIMARY KEY,organization_id uuid NOT NULL,status text NOT NULL);
      GRANT ALL ON public.copilot_quotes TO service_role;
      INSERT INTO public.organizations VALUES('${org}'),('${otherOrg}');
      INSERT INTO public.whatsapp_instances VALUES('${instance}','${org}'),('${otherInstance}','${otherOrg}');
      INSERT INTO public.whatsapp_instance_secrets VALUES('${instance}','${org}','provider-one','secret');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;`);
    for (const file of ['29_whatsapp_ingress_durable_inbox','32_whatsapp_ingress_worker_pause',
      '33_whatsapp_edge_execution_gate','34_whatsapp_ingress_completion_outcome',
      '35_whatsapp_receipt_recovery_cursor']) {
      await db.exec(read(`supabase/migrations/202710210000${file}.sql`));
    }
    const sigs = ['begin_whatsapp_receipt_recovery(uuid,uuid)',
      'enqueue_whatsapp_receipt_recovery(uuid,uuid,uuid,uuid,text,timestamptz)',
      'finish_whatsapp_receipt_recovery(uuid,uuid,uuid,jsonb,uuid[])'];
    for (const sig of sigs) {
      assert.deepEqual((await db.query(
        "SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",
        [`public.${sig}`])).rows[0],{anon:false,authenticated:false,service:true});
      assert.deepEqual((await db.query('SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure',
        [`public.${sig}`])).rows[0].proconfig,['search_path=""']);
    }
    for (const table of ['whatsapp_receipt_recovery_state','whatsapp_receipt_recovery_gaps']) {
      assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[`public.${table}`])).rows[0].relrowsecurity,true);
      for (const role of ['anon','authenticated','service_role']) {
        for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
          assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed',
            [role,`public.${table}`,privilege])).rows[0].allowed,false);
        }
        assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,`public.${table}`])).rows[0].allowed,role==='service_role');
      }
    }
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(begin(),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.equal(await begin(),null,'uninitialized gate cannot recover');
    await assert.rejects(begin(otherOrg,instance),/organization mismatch/);
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'inline',0)",[org,instance]);
    assert.equal(await begin(),null,'inline gate cannot recover');
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'queued',1)",[org,instance]);
    await db.exec(`INSERT INTO public.copilot_quotes VALUES('50000000-0000-0000-0000-000000000001','${org}','awaiting_confirmation')`);
    assert.equal(await begin(),null,'active commercial confirmation blocks recovery');
    await db.exec('DELETE FROM public.copilot_quotes');
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,true,0)',[org,instance]);
    assert.equal(await begin(),null,'paused worker cannot recover');
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,false,1)',[org,instance]);
    await db.exec('RESET ROLE');
    await db.query(`INSERT INTO public.whatsapp_messages
      SELECT ('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
        $1,$2,'owner:m'||n,'555@s.whatsapp.net','outgoing','sent',NULL,
        now()-interval '1 day'
      FROM generate_series(1,55) AS n`,[org,instance]);
    await db.query(`INSERT INTO public.whatsapp_messages VALUES
      ('40000000-0000-0000-0000-000000000001',$1,$2,'old','555','outgoing','sent',NULL,now()-interval '8 days'),
      ('40000000-0000-0000-0000-000000000002',$1,$2,'read','555','outgoing','read',NULL,now()-interval '1 day'),
      ('40000000-0000-0000-0000-000000000003',$1,$2,'deleted','555','outgoing','sent',now(),now()-interval '1 day'),
      ('40000000-0000-0000-0000-000000000004',$1,$2,'inbound','555','incoming','received',NULL,now()-interval '1 day')`,[org,instance]);
    await db.exec('SET ROLE service_role');
    const first = await begin();
    assert.equal(first.candidates.length,50);
    assert.equal(first.has_more,true);
    assert.equal(new Set(first.candidates.map(x=>x.id)).size,50);
    assert.equal(await begin(),null,'active lease fences duplicate runner');
    await assert.rejects(finish(first.lease_token,{...stats(50),checked:51}),/invalid recovery result/);
    await assert.rejects(finish(first.lease_token,{...stats(50),extra:1}),/invalid recovery result/);
    await assert.rejects(finish(first.lease_token,{...stats(49)}),/count mismatch/);
    assert.equal(await finish(otherOrg,stats(50)),false,'wrong lease cannot finish');
    await assert.rejects(enqueue(otherOrg,first.candidates[0].id),/lease unavailable/);
    await assert.rejects(enqueue(first.lease_token,'40000000-0000-0000-0000-000000000002'),/candidate unavailable/);
    await assert.rejects(enqueue(first.lease_token,first.candidates[0].id,'failed'),/invalid recovery enqueue/);
    await assert.rejects(enqueue(first.lease_token,first.candidates[0].id,null),/invalid recovery enqueue/);
    const eventId = await enqueue(first.lease_token,first.candidates[0].id,'read');
    assert.ok(eventId);
    assert.equal(await enqueue(first.lease_token,first.candidates[0].id,'read'),null,'one enqueue per candidate');
    const event = (await db.query('SELECT payload,status,receipt_recovery FROM public.whatsapp_ingress_events WHERE id=$1',[eventId])).rows[0];
    assert.equal(event.payload.data.id,first.candidates[0].message_id);
    assert.equal(event.payload.data.chatid,first.candidates[0].remote_jid);
    assert.equal(event.payload.data.status,'read');
    assert.equal(event.payload.instance,'provider-one');
    assert.equal(event.status,'pending');
    assert.equal(event.receipt_recovery,true,'recovery RPC stamps trusted provenance');
    const ordinary = (await db.query(
      "SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id",
      [org,instance,JSON.stringify({instance:'provider-one',event:'messages_update',
        data:{id:'ordinary',status:'read'},receipt_recovery:true})])).rows[0].id;
    assert.equal((await db.query('SELECT receipt_recovery FROM public.whatsapp_ingress_events WHERE id=$1',
      [ordinary])).rows[0].receipt_recovery,false,'payload cannot forge provenance');
    await db.exec(`INSERT INTO public.copilot_quotes VALUES('50000000-0000-0000-0000-000000000001','${org}','awaiting_confirmation')`);
    await assert.rejects(enqueue(first.lease_token,first.candidates[1].id),/gate unavailable/);
    await db.exec('DELETE FROM public.copilot_quotes');
    await assert.rejects(finish(first.lease_token,stats(50,{planned:1,enqueued:1,inconclusive:1}),
      [otherInstance]),/gap outside batch/);
    assert.equal(await finish(first.lease_token,stats(50,{planned:1,enqueued:1,inconclusive:1}),
      [first.candidates[1].id]),true);
    assert.equal((await db.query('SELECT message_row_id FROM public.whatsapp_receipt_recovery_gaps')).rows[0].message_row_id,
      first.candidates[1].id,'inconclusive ID persists privately');
    assert.equal(await finish(first.lease_token,stats(50)),false,'finished lease fenced');
    assert.equal(await begin(),null,'unresolved ingress blocks new batch');
    await db.exec('RESET ROLE');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',completed_at=now() WHERE id=ANY($1::uuid[])",[[eventId,ordinary]]);
    await db.exec('SET ROLE service_role');
    const second=await begin();
    assert.equal(second.candidates.length,5);
    assert.equal(second.has_more,false);
    assert.ok(second.candidates.every(x=>!first.candidates.some(y=>x.id===y.id)),'keyset reaches tail');
    assert.equal(await finish(second.lease_token,stats(5,{error:1})),true);
    const retry=await begin();
    assert.deepEqual(retry.candidates.map(x=>x.id),second.candidates.map(x=>x.id),'error preserves cursor');
    assert.equal(await finish(retry.lease_token,stats(5)),true);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.whatsapp_receipt_recovery_gaps')).rows[0].count,1,
      'gap remains after completed seven-day window');
    const restart=await begin();
    assert.equal(restart.candidates.length,50,'completed window restarts rolling cycle');
    await db.exec('RESET ROLE');
    await db.query("UPDATE public.whatsapp_receipt_recovery_state SET lease_until=now()-interval '1 second' WHERE instance_id=$1",[instance]);
    await db.exec('SET ROLE service_role');
    const reclaimed=await begin();
    assert.notEqual(reclaimed.lease_token,restart.lease_token);
    assert.equal(await finish(restart.lease_token,stats(50)),false,'stale owner fenced');
    await assert.rejects(enqueue(restart.lease_token,restart.candidates[0].id),/lease unavailable/);
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'inline',2)",[org,instance]);
    await assert.rejects(enqueue(reclaimed.lease_token,reclaimed.candidates[0].id),/gate unavailable/);
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'queued',3)",[org,instance]);
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,true,2)',[org,instance]);
    await assert.rejects(enqueue(reclaimed.lease_token,reclaimed.candidates[0].id),/gate unavailable/);
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,false,3)',[org,instance]);
    await assert.rejects(finish(reclaimed.lease_token,stats(50,{error:-1})),/invalid recovery result/);
    assert.equal(await finish(reclaimed.lease_token,stats(49,{unscanned:1})),true);
    const still=await begin();
    assert.deepEqual(still.candidates.map(x=>x.id),reclaimed.candidates.map(x=>x.id),'unscanned preserves cursor');
    await db.exec('RESET ROLE');
    const activeRollback=read('supabase/migrations/rollback/20271021000035_whatsapp_receipt_recovery_cursor.sql');
    await assert.rejects(db.exec(activeRollback),/requires drained leases/);
    await db.exec('ROLLBACK');
    await db.exec('SET ROLE service_role');
    assert.equal(await finish(still.lease_token,stats(50)),true);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.whatsapp_receipt_recovery_gaps')).rows[0].count,0,
      'verified later batch clears prior gap');
    await db.exec('RESET ROLE');
    await db.query(`WITH added AS (
      INSERT INTO public.whatsapp_messages
      SELECT ('60000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
        $1,$2,'historical-'||n,'555','outgoing','sent',NULL,now()-interval '8 days'
      FROM generate_series(1,1000) AS n RETURNING id
    ) INSERT INTO public.whatsapp_receipt_recovery_gaps(organization_id,instance_id,message_row_id)
      SELECT $1,$2,id FROM added`,[org,instance]);
    await db.exec('SET ROLE service_role');
    const capped=await begin();
    assert.equal(capped.candidates.length,5);
    await assert.rejects(finish(capped.lease_token,stats(5,{inconclusive:1}),
      [capped.candidates[0].id]),/gap capacity exhausted/);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.whatsapp_receipt_recovery_gaps')).rows[0].count,1000,
      'capacity failure is atomic');
    await db.exec('RESET ROLE');
    await db.query('DELETE FROM public.whatsapp_receipt_recovery_gaps WHERE message_row_id=$1',
      ['60000000-0000-0000-0000-000000000001']);
    await db.exec('SET ROLE service_role');
    assert.equal(await finish(capped.lease_token,stats(5,{inconclusive:1}),[capped.candidates[0].id]),true);
    await db.exec('RESET ROLE');
    const rollback=read('supabase/migrations/rollback/20271021000035_whatsapp_receipt_recovery_cursor.sql');
    await db.exec(rollback);
    assert.equal((await db.query("SELECT has_function_privilege('service_role','public.begin_whatsapp_receipt_recovery(uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.whatsapp_receipt_recovery_state')).rows[0].count,1,'rollback retains audit');
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.whatsapp_receipt_recovery_gaps')).rows[0].count,1000,'rollback retains gaps');
    assert.equal((await db.query('SELECT receipt_recovery FROM public.whatsapp_ingress_events WHERE id=$1',[eventId])).rows[0].receipt_recovery,true,
      'rollback retains trusted provenance for accepted work');
  } finally { await db.close(); }
});
