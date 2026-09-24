import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = p => readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const org='10000000-0000-0000-0000-000000000001',instance='20000000-0000-0000-0000-000000000001';
test('completion audit commits with fenced lease, preserves errors and enforces grace and access',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE public.organizations(id uuid PRIMARY KEY);
   CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
   INSERT INTO public.organizations VALUES('${org}'); INSERT INTO public.whatsapp_instances VALUES('${instance}','${org}');
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
  for(const f of ['20271021000029_whatsapp_ingress_durable_inbox.sql','20271021000032_whatsapp_ingress_worker_pause.sql','20271021000033_whatsapp_edge_execution_gate.sql','20271021000034_whatsapp_ingress_completion_outcome.sql']) await db.exec(read('supabase/migrations/'+f));
  const sig='public.finish_whatsapp_ingress_event_with_outcome(uuid,uuid,text,text,integer)';
  assert.deepEqual((await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",[sig])).rows[0],{anon:false,authenticated:false,service:true});
  assert.deepEqual((await db.query('SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure',[sig])).rows[0].proconfig,['search_path=""']);
  const enqueue=async()=> (await db.query("SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id",[org,instance,JSON.stringify({data:{id:'old-external',status:'read'}})])).rows[0].id;
  const claim=async()=> (await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],1)',[[instance]])).rows[0];
  const finish=async(row,error=null,outcome='processed',count=0)=> (await db.query('SELECT public.finish_whatsapp_ingress_event_with_outcome($1,$2,$3,$4,$5) AS ok',[row.id,row.lease_token,error,outcome,count])).rows[0].ok;
  for(const role of ['anon','authenticated']) {
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(db.query('SELECT public.finish_whatsapp_ingress_event_with_outcome($1,$2)',[org,instance]),/permission denied/);
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  const id=await enqueue(),row=await claim();assert.equal(row.id,id);
  await assert.rejects(finish(row,null,'unmatched_receipt',1),/grace has not elapsed/);
  await assert.rejects(finish(row,null,'unknown',1),/invalid ingress completion/);
  await assert.rejects(finish(row,null,'unmatched_receipt',0),/invalid ingress completion/);
  await assert.rejects(finish(row,'http_500','unmatched_receipt',1),/invalid ingress completion/);
  assert.equal(await finish({...row,lease_token:org}),false);
  assert.equal(await finish(row,'http_500'),true);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT status,completion_outcome,unmatched_receipt_count FROM public.whatsapp_ingress_events WHERE id=$1',[id])).rows[0],{status:'pending',completion_outcome:null,unmatched_receipt_count:0});
  const rollback=read('supabase/migrations/rollback/20271021000034_whatsapp_ingress_completion_outcome.sql');
  await assert.rejects(db.exec(rollback),/requires drained inbox/);await db.exec('ROLLBACK');
  await db.query("UPDATE public.whatsapp_ingress_events SET created_at=now()-interval '6 minutes',next_attempt_at=now() WHERE id=$1",[id]);
  await db.exec('SET ROLE service_role');
  const retried=await claim();assert.notEqual(retried.lease_token,row.lease_token);
  assert.equal(await finish(row,null,'unmatched_receipt',1),false,'old owner cannot annotate new lease');
  assert.equal(await finish(retried,null,'unmatched_receipt',1),true);
  assert.equal(await finish(retried,null,'processed',0),false,'completed audit cannot be rewritten');
  const knownId=await enqueue();const known=await claim();assert.equal(await finish(known),true);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT status,completion_outcome,unmatched_receipt_count,payload FROM public.whatsapp_ingress_events WHERE id=$1',[id])).rows[0],{status:'completed',completion_outcome:'unmatched_receipt',unmatched_receipt_count:1,payload:{data:{id:'old-external',status:'read'}}});
  assert.equal((await db.query('SELECT completion_outcome FROM public.whatsapp_ingress_events WHERE id=$1',[knownId])).rows[0].completion_outcome,'processed');
  await db.exec(rollback);
  assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS allowed",[sig])).rows[0].allowed,false);
  assert.equal((await db.query('SELECT unmatched_receipt_count FROM public.whatsapp_ingress_events WHERE id=$1',[id])).rows[0].unmatched_receipt_count,1,'rollback retains audit');
 }finally{await db.close();}
});
