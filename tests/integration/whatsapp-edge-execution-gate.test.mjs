import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const orgA = '10000000-0000-0000-0000-000000000001';
const orgB = '20000000-0000-0000-0000-000000000002';
const instanceA = 'a0000000-0000-0000-0000-000000000001';
const instanceB = 'b0000000-0000-0000-0000-000000000002';
const instanceC = 'c0000000-0000-0000-0000-000000000003';

test('Edge gate fences inline, queued, worker, tenant and revision transitions', async () => {
  const db = new PGlite();
  const mode = async (org, instance, value, revision) => (await db.query(
    'SELECT public.set_whatsapp_edge_execution_mode($1,$2,$3,$4) AS revision',
    [org, instance, value, revision],
  )).rows[0].revision;
  const begin = async (org, instance, payload = {}, path = null) => (await db.query(
    'SELECT public.begin_whatsapp_edge_execution($1,$2,$3::jsonb,$4) AS result',
    [org, instance, JSON.stringify(payload), path],
  )).rows[0].result;
  const complete = async (org, instance, ticket) => (await db.query(
    'SELECT public.complete_whatsapp_edge_execution($1,$2,$3) AS ok',
    [org, instance, ticket],
  )).rows[0].ok;
  const claim = async (...instances) => (await db.query(
    'SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],20)', [instances],
  )).rows;
  const enqueue = async (org, instance, id) => (await db.query(
    "SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id",
    [org, instance, JSON.stringify({id})],
  )).rows[0].id;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY);
      CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
      INSERT INTO public.organizations VALUES('${orgA}'),('${orgB}');
      INSERT INTO public.whatsapp_instances VALUES('${instanceA}','${orgA}'),('${instanceB}','${orgB}'),('${instanceC}','${orgA}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;`);
    for (const name of ['20271021000029_whatsapp_ingress_durable_inbox.sql',
      '20271021000032_whatsapp_ingress_worker_pause.sql']) {
      await db.exec(read(`supabase/migrations/${name}`));
    }
    const originalClaim=(await db.query("SELECT pg_get_functiondef('public.claim_whatsapp_ingress_events(uuid[],integer)'::regprocedure) AS body")).rows[0].body;
    await db.exec(read('supabase/migrations/20271021000033_whatsapp_edge_execution_gate.sql'));
    for (const sig of ['begin_whatsapp_edge_execution(uuid,uuid,jsonb,text)',
      'complete_whatsapp_edge_execution(uuid,uuid,uuid)',
      'set_whatsapp_edge_execution_mode(uuid,uuid,text,bigint)',
      'claim_whatsapp_ingress_events(uuid[],integer)']) {
      assert.deepEqual((await db.query(
        "SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",
        [`public.${sig}`],
      )).rows[0], {anon:false,authenticated:false,service:true});
      assert.equal((await db.query('SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure',[`public.${sig}`])).rows[0].proconfig[0], 'search_path=""');
    }
    for (const table of ['whatsapp_edge_execution_gate','whatsapp_edge_execution_tickets']) {
      assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[`public.${table}`])).rows[0].relrowsecurity,true);
      for (const role of ['anon','authenticated','service_role']) {
        for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
          assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,`public.${table}`,privilege])).rows[0].allowed,false);
        }
        assert.equal((await db.query('SELECT has_table_privilege($1,$2,\'SELECT\') AS allowed',[role,`public.${table}`])).rows[0].allowed,role==='service_role');
      }
    }
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(begin(orgA,instanceA),/permission denied/);
      await assert.rejects(mode(orgA,instanceA,'inline',0),/permission denied/);
      await assert.rejects(db.query('SELECT * FROM public.whatsapp_edge_execution_tickets'),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await assert.rejects(begin(orgA,instanceA),/uninitialized/);
    await assert.rejects(mode(orgA,instanceA,'queued',0),/initialize inline/);
    await assert.rejects(mode(orgB,instanceA,'inline',0),/instance organization mismatch/);
    await assert.rejects(begin(orgB,instanceA),/instance organization mismatch/);
    await assert.rejects(begin(orgA,instanceA,[]),/invalid edge execution admission/);
    await assert.rejects(begin(orgA,instanceA,{id:'large',data:'x'.repeat(2097152)}),/invalid edge execution admission/);
    await assert.rejects(begin(orgA,instanceA,{},'x'.repeat(201)),/invalid edge execution admission/);
    assert.equal(await mode(orgA,instanceA,'inline',0),1);
    assert.equal(await mode(orgB,instanceB,'inline',0),1);
    await db.exec('SET ROLE service_role');
    const serviceTicket=await begin(orgB,instanceB,{id:'service-inline'});
    assert.equal(serviceTicket.mode,'inline');
    await assert.rejects(begin(orgA,instanceB),/instance organization mismatch/);
    assert.equal(await mode(orgB,instanceB,'queued',1),2);
    const serviceEvent=await begin(orgB,instanceB,{id:'service-queued'});
    assert.equal(serviceEvent.mode,'queued');
    assert.equal((await claim(instanceB)).length,0,'service worker cannot pass live inline ticket');
    assert.equal(await complete(orgB,instanceB,serviceTicket.ticket_id),true);
    assert.equal(await complete(orgB,instanceB,serviceTicket.ticket_id),false);
    const serviceClaim=(await claim(instanceB))[0];
    assert.equal(serviceClaim.id,serviceEvent.event_id);
    assert.equal((await db.query('SELECT public.finish_whatsapp_ingress_event($1,$2) AS ok',[serviceClaim.id,serviceClaim.lease_token])).rows[0].ok,true);
    assert.equal(await mode(orgB,instanceB,'inline',2),3);
    await db.exec('RESET ROLE');
    await assert.rejects(mode(orgA,instanceA,'queued',0),/stale edge execution gate revision/);
    const inline=await begin(orgA,instanceA,{id:'inline'});
    assert.deepEqual(Object.keys(inline).sort(),['mode','ticket_id']);
    assert.equal(inline.mode,'inline');
    await assert.rejects(complete(orgA,instanceA,null),/invalid edge execution completion/);
    await assert.rejects(complete(orgB,instanceB,inline.ticket_id),/ticket scope mismatch/);
    assert.equal(await mode(orgA,instanceA,'queued',1),2,'close inline admission while ticket exists');
    const queued=await begin(orgA,instanceA,{id:'queued'},'path');
    assert.deepEqual(Object.keys(queued).sort(),['event_id','mode']);
    assert.equal(queued.mode,'queued');
    assert.equal((await db.query('SELECT event_name,path_instance_id FROM public.whatsapp_ingress_events WHERE id=$1',[queued.event_id])).rows[0].event_name,'messages_update');
    assert.equal((await claim(instanceA)).length,0,'ticket fences queued worker');
    await assert.rejects(mode(orgA,instanceA,'inline',2),/requires drained work/);
    assert.equal(await complete(orgA,instanceA,inline.ticket_id),true);
    assert.equal(await complete(orgA,instanceA,inline.ticket_id),false,'completion is idempotent');
    const leased=(await claim(instanceA))[0]; assert.equal(leased.id,queued.event_id);
    await db.query("UPDATE public.whatsapp_ingress_events SET lease_until=now()-interval '1 second' WHERE id=$1",[leased.id]);
    await assert.rejects(mode(orgA,instanceA,'inline',2),/requires drained work/);
    await db.query('SELECT public.finish_whatsapp_ingress_event($1,$2)',[leased.id,leased.lease_token]);
    assert.equal(await mode(orgA,instanceA,'inline',2),3);
    const old=await enqueue(orgA,instanceA,'unresolved');
    await assert.rejects(begin(orgA,instanceA),/blocked by inbox/);
    await assert.rejects(mode(orgA,instanceA,'inline',3),/requires drained work/);
    await db.query("UPDATE public.whatsapp_ingress_events SET status='dead_letter' WHERE id=$1",[old]);
    await assert.rejects(begin(orgA,instanceA),/blocked by inbox/);
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',completed_at=now() WHERE id=$1",[old]);
    assert.equal(await mode(orgA,instanceA,'queued',3),4);
    const pending=await begin(orgA,instanceA,{id:'paused'});
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,true,0)',[orgA,instanceA]);
    assert.equal((await claim(instanceA)).length,0,'SQL32 pause still applies');
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,false,1)',[orgA,instanceA]);
    const pausedClaim=(await claim(instanceA))[0]; assert.equal(pausedClaim.id,pending.event_id);
    await db.query('SELECT public.finish_whatsapp_ingress_event($1,$2)',[pausedClaim.id,pausedClaim.lease_token]);
    assert.equal(await mode(orgA,instanceA,'inline',4),5);
    // Unregistered legacy instance retains SQL32 claim behavior.
    const legacy=await enqueue(orgA,instanceC,'legacy');
    assert.equal((await claim(instanceC))[0].id,legacy);
    const ticket=await begin(orgA,instanceA,{id:'retained'});
    assert.equal(await mode(orgA,instanceA,'queued',5),6);
    await db.query("UPDATE public.whatsapp_edge_execution_tickets SET created_at=now()-interval '30 days' WHERE id=$1",[ticket.ticket_id]);
    assert.equal((await claim(instanceA)).length,0,'aged ticket still fences worker');
    await assert.rejects(mode(orgA,instanceA,'inline',6),/requires drained work/);
    assert.equal(await complete(orgA,instanceA,ticket.ticket_id),true);
    assert.equal(await mode(orgA,instanceA,'inline',6),7);
    for (let n=0;n<64;n++) await begin(orgA,instanceA,{id:n});
    await assert.rejects(begin(orgA,instanceA,{id:'overflow'}),/ticket capacity exhausted/);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_edge_execution_tickets WHERE instance_id=$1',[instanceA])).rows[0].n,64);
    const rollback=read('supabase/migrations/rollback/20271021000033_whatsapp_edge_execution_gate.sql');
    await assert.rejects(db.exec(rollback),/requires clearing all gates and tickets/);
    await db.exec('ROLLBACK');
    await db.exec('DELETE FROM public.whatsapp_edge_execution_tickets');
    await db.exec('DELETE FROM public.whatsapp_edge_execution_gate');
    await db.exec(rollback);
    assert.equal((await db.query("SELECT pg_get_functiondef('public.claim_whatsapp_ingress_events(uuid[],integer)'::regprocedure) AS body")).rows[0].body,originalClaim);
  } finally { await db.close(); }
});
