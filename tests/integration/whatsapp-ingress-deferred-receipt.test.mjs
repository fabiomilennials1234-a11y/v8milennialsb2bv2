import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const orgA='10000000-0000-0000-0000-000000000001';
const orgB='20000000-0000-0000-0000-000000000002';
const instanceA='a0000000-0000-0000-0000-000000000001';
const instanceB='b0000000-0000-0000-0000-000000000002';

test('deferred receipt lane lets later regular work run without losing lease fencing or audit', async () => {
  const db=new PGlite();
  const enqueue=async (org,instance,id) => (await db.query(
    "SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id",
    [org,instance,JSON.stringify({id})],
  )).rows[0].id;
  const claim=async (...ids) => (await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],20)',[ids])).rows;
  const finish=async (row,outcome='processed',count=0,error=null) => (await db.query(
    'SELECT public.finish_whatsapp_ingress_event_with_outcome($1,$2,$3,$4,$5) AS ok',
    [row.id,row.lease_token,error,outcome,count],
  )).rows[0].ok;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY);
      CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
      INSERT INTO public.organizations VALUES('${orgA}'),('${orgB}');
      INSERT INTO public.whatsapp_instances VALUES('${instanceA}','${orgA}'),('${instanceB}','${orgB}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
    for (const name of ['20271021000029_whatsapp_ingress_durable_inbox.sql',
      '20271021000032_whatsapp_ingress_worker_pause.sql',
      '20271021000033_whatsapp_edge_execution_gate.sql']) {
      await db.exec(read(`supabase/migrations/${name}`));
    }
    const sql33Claim=(await db.query("SELECT pg_get_functiondef('public.claim_whatsapp_ingress_events(uuid[],integer)'::regprocedure) AS body")).rows[0].body;
    await db.exec(read('supabase/migrations/20271021000034_whatsapp_ingress_completion_outcome.sql'));
    // Registered gate must be queued before this worker can claim.
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'inline',0)",[orgA,instanceA]);
    const receipt=await enqueue(orgA,instanceA,'missing-pure-receipt');
    assert.equal((await claim(instanceA)).length,0);
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'queued',1)",[orgA,instanceA]);
    const pin=await enqueue(orgA,instanceA,'later-pin');
    const other=await enqueue(orgB,instanceB,'other-instance');
    await db.exec('SET ROLE service_role');
    const first=(await claim(instanceA))[0]; assert.equal(first.id,receipt);
    assert.equal(await finish(first,'deferred_receipt',1),true);
    assert.equal(await finish(first,'deferred_receipt',1),false,'stale lease cannot repeat deferral');
    await assert.rejects(finish(first,'deferred_receipt',0),/invalid ingress completion outcome/);
    const deferred=(await db.query('SELECT status,receipt_deferred,deferral_count,attempts,lease_token,lease_until,completion_outcome,unmatched_receipt_count,next_attempt_at>now() AS later FROM public.whatsapp_ingress_events WHERE id=$1',[receipt])).rows[0];
    assert.deepEqual(deferred,{status:'pending',receipt_deferred:true,deferral_count:1,attempts:0,lease_token:null,lease_until:null,completion_outcome:null,unmatched_receipt_count:0,later:true});
    const second=(await claim(instanceA))[0]; assert.equal(second.id,pin,'later regular event runs immediately');
    assert.equal((await claim(instanceA)).length,0,'active regular lease fences deferred lane');
    assert.equal((await claim(instanceB))[0].id,other,'other instance proceeds independently');
    await db.exec('RESET ROLE');
    await db.query('SELECT public.finish_whatsapp_ingress_event_with_outcome($1,$2)',[second.id,second.lease_token]);
    assert.equal((await claim(instanceA)).length,0,'10-second deferral is not ready');
    await db.query("UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[receipt]);
    const retried=(await claim(instanceA))[0]; assert.equal(retried.id,receipt);
    assert.equal(retried.attempts,1,'waiting did not spend retry budget');
    assert.equal(await finish(retried),true);
    assert.deepEqual((await db.query('SELECT status,receipt_deferred,deferral_count,completion_outcome FROM public.whatsapp_ingress_events WHERE id=$1',[receipt])).rows[0],{
      status:'completed',receipt_deferred:true,deferral_count:1,completion_outcome:'processed',
    });
    const deferredAhead=await enqueue(orgA,instanceA,'deferred-ahead-of-backoff');
    const aheadClaim=(await claim(instanceA))[0]; assert.equal(aheadClaim.id,deferredAhead);
    assert.equal(await finish(aheadClaim,'deferred_receipt',1),true);
    const regularBackoff=await enqueue(orgA,instanceA,'regular-backoff');
    await db.query("UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()+interval '1 minute' WHERE id=$1",[regularBackoff]);
    await db.query("UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[deferredAhead]);
    const aheadRetry=(await claim(instanceA))[0]; assert.equal(aheadRetry.id,deferredAhead,'due receipt bypasses regular backoff');
    assert.equal((await claim(instanceA)).length,0,'active deferred lease fences regular lane');
    assert.equal(await finish(aheadRetry),true);
    assert.equal((await claim(instanceA)).length,0,'regular backoff remains in force');
    await db.query("UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[regularBackoff]);
    const regularRetry=(await claim(instanceA))[0]; assert.equal(regularRetry.id,regularBackoff);
    assert.equal(await finish(regularRetry),true);
    const terminal=await enqueue(orgA,instanceA,'old-missing');
    await db.query("UPDATE public.whatsapp_ingress_events SET created_at=now()-interval '6 minutes' WHERE id=$1",[terminal]);
    const terminalClaim=(await claim(instanceA))[0]; assert.equal(terminalClaim.id,terminal);
    await assert.rejects(finish(terminalClaim,'deferred_receipt',1),/deferral window exhausted/);
    assert.equal(await finish(terminalClaim,'unmatched_receipt',1),true);
    assert.equal((await db.query('SELECT completion_outcome,unmatched_receipt_count FROM public.whatsapp_ingress_events WHERE id=$1',[terminal])).rows[0].completion_outcome,'unmatched_receipt');
    const capped=await enqueue(orgA,instanceA,'cap');
    const cappedClaim=(await claim(instanceA))[0]; assert.equal(cappedClaim.id,capped);
    await db.query('UPDATE public.whatsapp_ingress_events SET receipt_deferred=true,deferral_count=60 WHERE id=$1',[capped]);
    await assert.rejects(finish(cappedClaim,'deferred_receipt',1),/deferral window exhausted/);
    await db.query("UPDATE public.whatsapp_ingress_events SET status='dead_letter',lease_token=NULL,lease_until=NULL WHERE id=$1",[capped]);
    const afterDeferredDead=await enqueue(orgA,instanceA,'regular-after-deferred-dead');
    const following=(await claim(instanceA))[0]; assert.equal(following.id,afterDeferredDead,'deferred dead letter never blocks regular lane');
    await db.query('SELECT public.finish_whatsapp_ingress_event_with_outcome($1,$2)',[following.id,following.lease_token]);
    const regularDead=await enqueue(orgA,instanceA,'regular-dead');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='dead_letter' WHERE id=$1",[regularDead]);
    const blocked=await enqueue(orgA,instanceA,'blocked-after-dead');
    assert.equal((await claim(instanceA)).length,0,'regular dead letter is an instance barrier');
    assert.equal((await db.query('SELECT status FROM public.whatsapp_ingress_events WHERE id=$1',[blocked])).rows[0].status,'pending');
    const rollback=read('supabase/migrations/rollback/20271021000034_whatsapp_ingress_completion_outcome.sql');
    await assert.rejects(db.exec(rollback),/requires drained inbox/); await db.exec('ROLLBACK');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE status<>'completed'");
    await db.exec(rollback);
    assert.equal((await db.query("SELECT pg_get_functiondef('public.claim_whatsapp_ingress_events(uuid[],integer)'::regprocedure) AS body")).rows[0].body,sql33Claim);
    assert.equal((await db.query('SELECT deferral_count FROM public.whatsapp_ingress_events WHERE id=$1',[receipt])).rows[0].deferral_count,1,'rollback retains evidence');
  } finally { await db.close(); }
});
