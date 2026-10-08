import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const org='10000000-0000-0000-0000-000000000001';
const instance='20000000-0000-0000-0000-000000000001';
const rowId='30000000-0000-0000-0000-000000000001';
const event = (fromMe=false, changes={}) => ({
  EventType:'messages_update',type:'FileDownloadedMessage',state:'FileDownloaded',
  event:{Type:'FileDownloaded',IsFromMe:fromMe,MessageIDs:['5511999999999:ABC'],
    Chat:'5511@s.whatsapp.net',chatid:'5511@s.whatsapp.net',
    FileURL:'https://media.example.com/audio.ogg',MimeType:'audio/ogg',...changes},
});

test('SQL37 accepts incoming FileDownloaded only with boolean provenance and retains one-shot replay audit',async()=>{
  const db=new PGlite();
  const check=async payload => (await db.query('SELECT public.is_whatsapp_file_download_notification($1::jsonb) AS ok',
    [JSON.stringify(payload)])).rows[0].ok;
  const enqueue=async payload => (await db.query(
    "SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id",
    [org,instance,JSON.stringify(payload)])).rows[0].id;
  const claim=async()=>(await db.query('SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],1)',[[instance]])).rows[0];
  const finish=async(row,error=null,outcome='processed')=>(await db.query(
    'SELECT public.finish_whatsapp_ingress_event_with_outcome($1,$2,$3,$4,0) AS ok',
    [row.id,row.lease_token,error,outcome])).rows[0].ok;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY);
      CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
      CREATE TABLE public.whatsapp_messages(id uuid PRIMARY KEY,organization_id uuid NOT NULL,
        instance_id uuid NOT NULL,message_id text NOT NULL,remote_jid text NOT NULL,
        direction text NOT NULL,status text NOT NULL,media_url text);
      INSERT INTO public.organizations VALUES('${org}');
      INSERT INTO public.whatsapp_instances VALUES('${instance}','${org}');
      INSERT INTO public.whatsapp_messages VALUES('${rowId}','${org}','${instance}',
        '5511999999999:ABC','5511@s.whatsapp.net','incoming','received','https://media.example.com/original.ogg');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
    for(const f of ['29_whatsapp_ingress_durable_inbox','32_whatsapp_ingress_worker_pause',
      '33_whatsapp_edge_execution_gate','34_whatsapp_ingress_completion_outcome',
      '36_whatsapp_ingress_provider_notification_replay'])
      await db.exec(read(`supabase/migrations/202710210000${f}.sql`));
    assert.equal(await check(event(false)),false,'SQL36 remains unchanged');
    await db.exec(read('supabase/migrations/20271021000037_whatsapp_file_download_incoming_notification.sql'));
    assert.equal(await check(event(true)),true);
    assert.equal(await check(event(false)),true);
    for(const value of ['false',null,undefined]) {
      const payload=event(false,{IsFromMe:value});
      assert.equal(await check(payload),false,`invalid IsFromMe ${String(value)}`);
    }
    const missing=event();delete missing.event.IsFromMe;
    assert.equal(await check(missing),false);
    assert.equal(await check(event(false,{Chat:123,chatid:'123'})),false,'Chat must be a JSON string');
    const sig='public.is_whatsapp_file_download_notification(jsonb)';
    assert.deepEqual((await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",[sig])).rows[0],
      {anon:false,authenticated:false,service:true});
    await db.exec('SET ROLE service_role');
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'inline',0)",[org,instance]);
    await db.query("SELECT public.set_whatsapp_edge_execution_mode($1,$2,'queued',1)",[org,instance]);
    const acceptedId=await enqueue(event(false));
    const accepted=await claim();assert.equal(accepted.id,acceptedId);
    assert.equal(await finish(accepted,null,'provider_notification'),true);
    assert.deepEqual((await db.query('SELECT status,completion_outcome FROM public.whatsapp_ingress_events WHERE id=$1',[acceptedId])).rows[0],
      {status:'completed',completion_outcome:'provider_notification'});
    const deadId=await enqueue(event(false));
    for(let attempt=1;attempt<=8;attempt++) {
      const leased=await claim();assert.equal(leased.id,deadId);
      assert.equal(await finish(leased,'operation_unavailable'),true);
      if(attempt<8) {
        await db.exec('RESET ROLE');
        await db.query("UPDATE public.whatsapp_ingress_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[deadId]);
        await db.exec('SET ROLE service_role');
      }
    }
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,true,0)',[org,instance]);
    await db.exec('RESET ROLE');
    const rollback=read('supabase/migrations/rollback/20271021000037_whatsapp_file_download_incoming_notification.sql');
    await assert.rejects(db.exec(rollback),/requires drained inbox/);
    await db.exec('ROLLBACK');
    await db.exec('SET ROLE service_role');
    assert.equal((await db.query('SELECT public.requeue_whatsapp_ingress_file_download($1,$2,$3,8,$4) AS ok',
      [org,instance,deadId,'operation_unavailable'])).rows[0].ok,true);
    assert.equal((await db.query('SELECT previous_attempts FROM public.whatsapp_ingress_dead_letter_replays WHERE event_id=$1',[deadId])).rows[0].previous_attempts,8);
    await db.query('SELECT public.set_whatsapp_ingress_worker_pause($1,$2,false,1)',[org,instance]);
    const replay=await claim();assert.equal(replay.id,deadId);
    assert.equal(await finish(replay,null,'provider_notification'),true);
    await db.exec('RESET ROLE');
    assert.deepEqual((await db.query('SELECT message_id,direction,status,media_url FROM public.whatsapp_messages WHERE id=$1',[rowId])).rows[0],
      {message_id:'5511999999999:ABC',direction:'incoming',status:'received',media_url:'https://media.example.com/original.ogg'},
      'notification/replay never mutates incoming message or media');
    await db.exec(rollback);
    assert.equal(await check(event(false)),false,'rollback restores SQL36 predicate');
    assert.equal((await db.query('SELECT completion_outcome FROM public.whatsapp_ingress_events WHERE id=$1',[deadId])).rows[0].completion_outcome,
      'provider_notification','completed audit retained');
    assert.equal((await db.query('SELECT previous_attempts FROM public.whatsapp_ingress_dead_letter_replays WHERE event_id=$1',[deadId])).rows[0].previous_attempts,8,
      'replay audit retained');
  }finally{await db.close();}
});
