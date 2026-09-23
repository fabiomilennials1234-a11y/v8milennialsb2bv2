import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = '20271021000029_whatsapp_ingress_durable_inbox.sql';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const orgA = '10000000-0000-0000-0000-000000000001';
const orgB = '20000000-0000-0000-0000-000000000002';
const instanceA = 'a0000000-0000-0000-0000-000000000001';
const instanceB = 'b0000000-0000-0000-0000-000000000002';

test('durable inbox commits deliveries, scoped leases, retry recovery, dead letters, retention and service-only access', async () => {
  const db = new PGlite();
  const enqueue = async (org, instance, payload) => (await db.query(
    "SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id", [org,instance,JSON.stringify(payload)],
  )).rows[0].id;
  const claim = async () => (await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],1)', [[instanceA]])).rows;
  const finish = async (id, token, error = null) => (await db.query('SELECT public.finish_whatsapp_ingress_event($1,$2,$3) AS finished',[id,token,error])).rows[0].finished;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY);
      CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
      INSERT INTO public.organizations VALUES('${orgA}'),('${orgB}');
      INSERT INTO public.whatsapp_instances VALUES('${instanceA}','${orgA}'),('${instanceB}','${orgB}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;`);
    await db.exec(read(`supabase/migrations/${migration}`));
    const signatures = ['enqueue_whatsapp_ingress_event(uuid,uuid,text,jsonb,text)', 'claim_whatsapp_ingress_events(uuid[],integer)',
      'finish_whatsapp_ingress_event(uuid,uuid,text)', 'cleanup_whatsapp_ingress_events(uuid[],integer)'];
    for (const sig of signatures) {
      const { rows } = await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service", [`public.${sig}`]);
      assert.deepEqual(rows[0], { anon:false,authenticated:false,service:true });
    }
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM public.whatsapp_ingress_events'), /permission denied/);
      await assert.rejects(enqueue(orgA,instanceA,{}), /permission denied/);
      await db.exec('RESET ROLE');
    }
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.whatsapp_ingress_events'::regclass")).rows[0].relrowsecurity,true);
    for (const table of ['whatsapp_ingress_events','whatsapp_ingress_budget']) {
      for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
        assert.equal((await db.query("SELECT has_table_privilege('service_role',$1,$2) AS allowed",[`public.${table}`,privilege])).rows[0].allowed,false);
      }
    }
    await assert.rejects(enqueue(orgB,instanceA,{}), /instance organization mismatch/);
    await assert.rejects(db.query("SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages','{}')",[orgA,instanceA]),/invalid ingress event/);
    const id = await enqueue(orgA,instanceA,{id:'receipt',status:'read'});
    const duplicate = await enqueue(orgA,instanceA,{status:'read',id:'receipt'});
    assert.notEqual(duplicate,id,'without a provider event ID every delivery remains durable');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',completed_at=now() WHERE id=$1",[duplicate]);
    const other = await enqueue(orgB,instanceB,{id:'receipt',status:'read'});
    const first = await claim(); assert.equal(first.length,1); assert.equal(first[0].id,id);
    assert.equal((await claim()).length,0,'active lease and other instance cannot be claimed');
    assert.equal(await finish(id,'00000000-0000-0000-0000-000000000000'),false);
    assert.equal(await finish(id,first[0].lease_token,'http_503'),true);
    assert.equal((await claim()).length,0,'backoff must hold retries');
    await db.query("UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[id]);
    const second=(await claim())[0]; assert.equal(second.attempts,2);
    // Simulate process loss after claim. A different process recovers the same
    // committed event with a new fencing token; old completion cannot win.
    await db.query("UPDATE public.whatsapp_ingress_events SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
    const recovered=(await claim())[0]; assert.equal(recovered.id,id); assert.notEqual(recovered.lease_token,second.lease_token);
    assert.equal(await finish(id,second.lease_token),false);
    assert.equal(await finish(id,recovered.lease_token),true);
    const repeated = await enqueue(orgA,instanceA,{id:'receipt',status:'read'});
    assert.notEqual(repeated,id);
    const repeatedClaim=(await claim())[0]; await finish(repeated,repeatedClaim.lease_token);
    assert.equal((await claim()).length,0);
    const poisoned=await enqueue(orgA,instanceA,{id:'missing-target'});
    await db.query('UPDATE public.whatsapp_ingress_events SET attempts=7 WHERE id=$1',[poisoned]);
    const final=(await claim())[0]; assert.equal(final.attempts,8);
    assert.equal(await finish(poisoned,final.lease_token,'http_500'),true);
    assert.equal((await db.query('SELECT status FROM public.whatsapp_ingress_events WHERE id=$1',[poisoned])).rows[0].status,'dead_letter');
    const crashed=await enqueue(orgA,instanceA,{id:'crash-final-attempt'});
    await db.query("UPDATE public.whatsapp_ingress_events SET attempts=8,status='processing',lease_until=now()-interval '1 second' WHERE id=$1",[crashed]);
    assert.equal((await claim()).length,0);
    assert.equal((await db.query('SELECT status FROM public.whatsapp_ingress_events WHERE id=$1',[crashed])).rows[0].status,'dead_letter');
    await db.query("UPDATE public.whatsapp_ingress_events SET completed_at=now()-interval '3 days' WHERE id=$1",[id]);
    assert.equal((await db.query('SELECT public.cleanup_whatsapp_ingress_events($1::uuid[],1) AS n',[[instanceA]])).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_ingress_events')).rows[0].n,5,'dead letters and other tenant remain');
    await assert.rejects(db.exec(read(`supabase/migrations/rollback/${migration}`)), /requires draining/);
    assert.equal((await db.query('SELECT status FROM public.whatsapp_ingress_events WHERE id=$1',[other])).rows[0].status,'pending');
    await assert.rejects(db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],NULL)',[[instanceA]]),/invalid ingress claim scope/);
    await assert.rejects(db.query('SELECT public.cleanup_whatsapp_ingress_events($1::uuid[],NULL)',[[instanceA]]),/invalid ingress cleanup scope/);
    const originalB=(await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],1)',[[instanceB]])).rows[0];
    await finish(originalB.id,originalB.lease_token);
    const transitions=[];
    for (const pinned of [true,false,true]) transitions.push(await enqueue(orgB,instanceB,{id:'same-message',pinned}));
    assert.equal(new Set(transitions).size,3,'pin/unpin/pin must remain three events even with identical first/last payload');
    for (const eventId of transitions) {
      const claimed=(await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],10)',[[instanceB]])).rows;
      assert.equal(claimed.length,1,'only one active lease per instance');
      assert.equal(claimed[0].id,eventId,'FIFO preserves transitions');
      assert.equal((await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],10)',[[instanceB]])).rows.length,0);
      await finish(eventId,claimed[0].lease_token);
    }
    await db.query('DELETE FROM public.whatsapp_instances WHERE id=$1',[instanceB]);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_ingress_events WHERE instance_id=$1',[instanceB])).rows[0].n,0);
    const counter=(await db.query('SELECT row_count::integer AS n,payload_bytes::integer AS bytes FROM public.whatsapp_ingress_budget')).rows[0];
    assert.deepEqual(counter,(await db.query('SELECT count(*)::integer AS n,coalesce(sum(payload_bytes),0)::integer AS bytes FROM public.whatsapp_ingress_events')).rows[0]);
    await db.query(`INSERT INTO public.whatsapp_ingress_events(organization_id,instance_id,event_key,event_name,payload,status,completed_at)
      SELECT $1,$2,'capacity-'||n,'messages_update','{}','completed',now()-interval '3 days'
      FROM generate_series(1,20000-(SELECT count(*)::integer FROM public.whatsapp_ingress_events)) n`,[orgA,instanceA]);
    await assert.rejects(enqueue(orgA,instanceA,{id:'overflow'}),/ingress capacity exhausted/);
    assert.equal((await db.query('SELECT public.cleanup_whatsapp_ingress_events($1::uuid[],1) AS n',[[instanceA]])).rows[0].n,1);
    assert.ok(await enqueue(orgA,instanceA,{id:'capacity-recovered'}));
    // Rollback disables new admission without destroying completed evidence.
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',completed_at=now(),lease_token=NULL,lease_until=NULL");
    const retained = (await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_ingress_events')).rows[0].n;
    await db.exec(read(`supabase/migrations/rollback/${migration}`));
    assert.equal((await db.query("SELECT has_function_privilege('service_role','public.enqueue_whatsapp_ingress_event(uuid,uuid,text,jsonb,text)','EXECUTE') AS allowed")).rows[0].allowed,false);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_ingress_events')).rows[0].n,retained);
    assert.equal((await db.query("SELECT has_function_privilege('service_role','public.claim_whatsapp_ingress_events(uuid[],integer)','EXECUTE') AS allowed")).rows[0].allowed,true);
  } finally { await db.close(); }
});
