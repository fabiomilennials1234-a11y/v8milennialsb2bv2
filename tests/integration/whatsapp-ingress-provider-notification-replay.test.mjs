import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const org='10000000-0000-0000-0000-000000000001';
const otherOrg='10000000-0000-0000-0000-000000000002';
const instance='20000000-0000-0000-0000-000000000001';
const payload = (changes={}) => ({EventType:'messages_update',type:'FileDownloadedMessage',
  state:'FileDownloaded',event:{Type:'FileDownloaded',
  IsFromMe:true,MessageIDs:['ABC'],chatid:'123@s.whatsapp.net',Chat:'123@s.whatsapp.net',
  FileURL:'https://cdn.example.com/media/a.ogg',...changes}});

test('FileDownloaded notification completes only under lease; dead letter replays once with audit',async()=>{
  const db=new PGlite();
  const enqueue=async body=>(await db.query(
    "SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id",
    [org,instance,JSON.stringify(body)])).rows[0].id;
  const claim=async()=>(await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],1)',[[instance]])).rows[0];
  const finish=async(row,error=null,outcome='processed',count=0)=>(await db.query(
    'SELECT public.finish_whatsapp_ingress_event_with_outcome($1,$2,$3,$4,$5) AS ok',
    [row.id,row.lease_token,error,outcome,count])).rows[0].ok;
  const requeue=async(id,attempts=8,error='operation_unavailable')=>(await db.query(
    'SELECT public.requeue_whatsapp_ingress_file_download($1,$2,$3,$4,$5) AS ok',
    [org,instance,id,attempts,error])).rows[0].ok;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY);
      CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
      INSERT INTO public.organizations VALUES('${org}'),('${otherOrg}');
      INSERT INTO public.whatsapp_instances VALUES('${instance}','${org}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
    for(const f of ['29_whatsapp_ingress_durable_inbox','32_whatsapp_ingress_worker_pause',
      '33_whatsapp_edge_execution_gate','34_whatsapp_ingress_completion_outcome',
      '36_whatsapp_ingress_provider_notification_replay'])
      await db.exec(read(`supabase/migrations/202710210000${f}.sql`));
    const requeueSig='public.requeue_whatsapp_ingress_file_download(uuid,uuid,uuid,integer,text)';
    assert.deepEqual((await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",[requeueSig])).rows[0],
      {anon:false,authenticated:false,service:true});
    assert.deepEqual((await db.query('SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure',[requeueSig])).rows[0].proconfig,['search_path=""']);
    const audit='public.whatsapp_ingress_dead_letter_replays';
    assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[audit])).rows[0].relrowsecurity,true);
    for(const role of ['anon','authenticated','service_role']) {
      for(const privilege of ['INSERT','UPDATE','DELETE'])
        assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,audit,privilege])).rows[0].allowed,false);
      assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,audit])).rows[0].allowed,role==='service_role');
    }
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(requeue(org),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'inline',0)",[org,instance]);
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'queued',1)",[org,instance]);
    const goodId=await enqueue(payload());
    const good=await claim();assert.equal(good.id,goodId);
    assert.equal(await finish({...good,lease_token:org},null,'provider_notification'),false,'stale lease fenced');
    await assert.rejects(finish(good,null,'provider_notification',1),/invalid ingress completion/);
    await assert.rejects(finish(good,'operation_unavailable','provider_notification'),/invalid ingress completion/);
    assert.equal(await finish(good,null,'provider_notification'),true);
    assert.deepEqual((await db.query('SELECT status,completion_outcome,unmatched_receipt_count FROM public.whatsapp_ingress_events WHERE id=$1',[goodId])).rows[0],
      {status:'completed',completion_outcome:'provider_notification',unmatched_receipt_count:0});
    const malformed=[payload({edited:true}),payload({Status:'read'}),payload({MessageIDs:['ABC','DEF']}),
      payload({MessageIDs:[' ABC']}),payload({chatid:' 123@s.whatsapp.net'}),
      payload({Chat:'different'}),payload({FileURL:'http://cdn.example.com/a.ogg'}),
      payload({FileURL:'https://cdn.example.com:65536/a.ogg'}),
      payload({action:'send'}),payload({protocolMessage:{type:'revoke'}}),
      {...payload(),data:{id:'ABC',status:'read'}},
      {...payload(),EventType:'messages'},
      {...payload(),type:'Read'},
      {...payload(),state:'Read'},
      {...payload(),unknownRoot:true}];
    for(const body of malformed) {
      const id=await enqueue(body),row=await claim();assert.equal(row.id,id);
      await assert.rejects(finish(row,null,'provider_notification'),/payload unavailable/);
      assert.equal(await finish(row,null,'processed'),true);
    }
    const deadId=await enqueue(payload());
    let last;
    for(let i=1;i<=8;i++) {
      last=await claim();assert.equal(last.id,deadId);
      assert.equal(await finish(last,'operation_unavailable'),true);
      if(i<8) {
        await db.exec('RESET ROLE');
        await db.query("UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[deadId]);
        await db.exec('SET ROLE service_role');
      }
    }
    assert.deepEqual((await db.query('SELECT status,attempts,last_error_code FROM public.whatsapp_ingress_events WHERE id=$1',[deadId])).rows[0],
      {status:'dead_letter',attempts:8,last_error_code:'operation_unavailable'});
    await assert.rejects(requeue(deadId),/gate unavailable/,'worker must be paused');
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,true,0)',[org,instance]);
    await assert.rejects(requeue(deadId,7),/state changed/);
    await assert.rejects(db.query('SELECT public.requeue_whatsapp_ingress_file_download($1,$2,$3,8,$4)',
      [otherOrg,instance,deadId,'operation_unavailable']),/organization mismatch/);
    await db.exec('RESET ROLE');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='dead_letter',attempts=8,last_error_code='operation_unavailable' WHERE id=$1",[goodId]);
    await db.exec('SET ROLE service_role');
    await assert.rejects(requeue(deadId),/not head/);
    await db.exec('RESET ROLE');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',last_error_code=NULL WHERE id=$1",[goodId]);
    await db.query('INSERT INTO public.whatsapp_edge_execution_tickets(organization_id,instance_id) VALUES($1,$2)',[org,instance]);
    await db.exec('SET ROLE service_role');
    await assert.rejects(requeue(deadId),/gate unavailable/);
    await db.exec('RESET ROLE');
    await db.query('DELETE FROM public.whatsapp_edge_execution_tickets WHERE instance_id=$1',[instance]);
    await db.exec('SET ROLE service_role');
    assert.equal(await requeue(deadId),true);
    assert.equal(await requeue(deadId),false,'ambiguous retry never resets work twice');
    assert.deepEqual((await db.query('SELECT previous_attempts,previous_error_code FROM public.whatsapp_ingress_dead_letter_replays WHERE event_id=$1',[deadId])).rows[0],
      {previous_attempts:8,previous_error_code:'operation_unavailable'});
    assert.deepEqual((await db.query('SELECT status,attempts,last_error_code,payload FROM public.whatsapp_ingress_events WHERE id=$1',[deadId])).rows[0],
      {status:'pending',attempts:0,last_error_code:null,payload:payload()},'payload retained');
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,false,1)',[org,instance]);
    const replay=await claim();assert.equal(replay.id,deadId);
    assert.equal(await finish(replay,null,'provider_notification'),true);
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,true,2)',[org,instance]);
    const ineligible=await enqueue(payload({action:'send'}));
    await db.exec('RESET ROLE');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='dead_letter',attempts=8,last_error_code='operation_unavailable' WHERE id=$1",[ineligible]);
    await db.exec('SET ROLE service_role');
    await assert.rejects(requeue(ineligible),/event ineligible/);
    await db.exec('RESET ROLE');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',last_error_code=NULL,completed_at=now() WHERE id=$1",[ineligible]);
    await db.exec(read('supabase/migrations/rollback/20271021000036_whatsapp_ingress_provider_notification_replay.sql'));
    assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS allowed",[requeueSig])).rows[0].allowed,false);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.whatsapp_ingress_dead_letter_replays')).rows[0].count,1,'audit retained');
    assert.equal((await db.query('SELECT completion_outcome FROM public.whatsapp_ingress_events WHERE id=$1',[deadId])).rows[0].completion_outcome,'provider_notification');
  } finally {await db.close();}
});
