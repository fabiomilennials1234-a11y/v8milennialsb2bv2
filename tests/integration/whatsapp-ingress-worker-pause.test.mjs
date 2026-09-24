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

test('service-only pause fences claims, requires revision and drain, and dead letters block FIFO', async () => {
  const db = new PGlite();
  const enqueue = async (org, instance, n) => (await db.query(
    "SELECT public.enqueue_whatsapp_ingress_event($1,$2,'messages_update',$3::jsonb) AS id",
    [org, instance, JSON.stringify({ id: n, secret: 'provider-token' })],
  )).rows[0].id;
  const claim = async (...instances) => (await db.query(
    'SELECT * FROM public.claim_whatsapp_ingress_events($1::uuid[],20)', [instances],
  )).rows;
  const finish = async (row, error = null) => (await db.query(
    'SELECT public.finish_whatsapp_ingress_event($1,$2,$3) AS ok', [row.id,row.lease_token,error],
  )).rows[0].ok;
  const pause = async (org, instance, paused, revision) => (await db.query(
    'SELECT public.set_whatsapp_ingress_worker_pause($1,$2,$3,$4) AS revision',
    [org,instance,paused,revision],
  )).rows[0].revision;
  const snapshot = async (org, instance) => (await db.query(
    'SELECT * FROM public.get_whatsapp_ingress_handoff_snapshot($1,$2)', [org,instance],
  )).rows[0];
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY);
      CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
      INSERT INTO public.organizations VALUES('${orgA}'),('${orgB}');
      INSERT INTO public.whatsapp_instances VALUES('${instanceA}','${orgA}'),('${instanceB}','${orgB}'),('${instanceC}','${orgA}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;`);
    await db.exec(read('supabase/migrations/20271021000029_whatsapp_ingress_durable_inbox.sql'));
    const originalClaim=(await db.query("SELECT pg_get_functiondef('public.claim_whatsapp_ingress_events(uuid[],integer)'::regprocedure) AS body")).rows[0].body;
    await db.exec(read('supabase/migrations/20271021000032_whatsapp_ingress_worker_pause.sql'));

    for (const sig of [
      'set_whatsapp_ingress_worker_pause(uuid,uuid,boolean,bigint)',
      'get_whatsapp_ingress_handoff_snapshot(uuid,uuid)',
      'claim_whatsapp_ingress_events(uuid[],integer)',
    ]) {
      const { rows } = await db.query(
        "SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",
        [`public.${sig}`],
      );
      assert.deepEqual(rows[0], { anon:false, authenticated:false, service:true });
    }
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.whatsapp_ingress_worker_control'::regclass")).rows[0].relrowsecurity,true);
    for (const role of ['anon','authenticated']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
        assert.equal((await db.query("SELECT has_table_privilege($1,'public.whatsapp_ingress_worker_control',$2) AS allowed",[role,privilege])).rows[0].allowed,false);
      }
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM public.whatsapp_ingress_worker_control'),/permission denied/);
      await assert.rejects(snapshot(orgA,instanceA),/permission denied/);
      await assert.rejects(pause(orgA,instanceA,true,0),/permission denied/);
      await db.exec('RESET ROLE');
    }
    for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
      assert.equal((await db.query("SELECT has_table_privilege('service_role','public.whatsapp_ingress_worker_control',$1) AS allowed",[privilege])).rows[0].allowed,false);
    }
    await db.exec('SET ROLE service_role');
    assert.equal((await snapshot(orgA,instanceA)).revision,0);
    await assert.rejects(pause(orgB,instanceA,true,0),/instance organization mismatch/);
    await db.exec('RESET ROLE');
    assert.deepEqual(await snapshot(orgA,instanceA),{
      paused:false,revision:0,pending_count:0,processing_count:0,expired_count:0,dead_letter_count:0,completed_count:0,
    });
    await assert.rejects(snapshot(orgB,instanceA),/instance organization mismatch/);
    await assert.rejects(pause(orgB,instanceA,true,0),/instance organization mismatch/);
    await assert.rejects(pause(orgA,instanceA,true,null),/invalid ingress worker control/);

    const activeId = await enqueue(orgA,instanceA,'active');
    const active = (await claim(instanceA))[0];
    assert.equal(active.id,activeId);
    await db.exec('SET ROLE service_role');
    assert.equal(await pause(orgA,instanceA,true,0),1);
    await db.exec('RESET ROLE');
    await assert.rejects(pause(orgA,instanceA,false,0),/stale ingress worker control revision/);
    const queuedId = await enqueue(orgA,instanceA,'queued-while-paused');
    const otherId = await enqueue(orgB,instanceB,'other-instance');
    assert.equal((await claim(instanceA)).length,0);
    const other=(await claim(instanceA,instanceB))[0];
    assert.equal(other.id,otherId,'another instance continues while A is paused');
    assert.equal(await finish(other),true);
    assert.deepEqual(await snapshot(orgA,instanceA),{
      paused:true,revision:1,pending_count:1,processing_count:1,expired_count:0,dead_letter_count:0,completed_count:0,
    });
    await assert.rejects(pause(orgA,instanceA,false,1),/still processing/);
    await db.query("UPDATE public.whatsapp_ingress_events SET lease_until=now()-interval '1 second' WHERE id=$1",[activeId]);
    assert.equal((await snapshot(orgA,instanceA)).expired_count,1);
    await assert.rejects(pause(orgA,instanceA,false,1),/still processing/);
    assert.equal(await finish(active),true,'valid token may finish while paused, even after lease expiry');
    assert.equal((await snapshot(orgA,instanceA)).completed_count,1);
    assert.equal(await pause(orgA,instanceA,false,1),2);
    await assert.rejects(pause(orgA,instanceA,true,1),/stale ingress worker control revision/);
    const queued=(await claim(instanceA))[0];
    assert.equal(queued.id,queuedId);
    assert.equal(await finish(queued),true);

    const deadId=await enqueue(orgA,instanceA,'dead-by-finish');
    const laterId=await enqueue(orgA,instanceA,'later-blocked');
    await db.query('UPDATE public.whatsapp_ingress_events SET attempts=7 WHERE id=$1',[deadId]);
    const deadClaim=(await claim(instanceA))[0];
    assert.equal(deadClaim.id,deadId);
    assert.equal(await finish(deadClaim,'http_500'),true);
    assert.equal((await snapshot(orgA,instanceA)).dead_letter_count,1);
    assert.equal((await claim(instanceA)).length,0,'dead-letter head blocks later pending event');
    assert.equal((await db.query('SELECT status FROM public.whatsapp_ingress_events WHERE id=$1',[laterId])).rows[0].status,'pending');

    const exhaustedId=await enqueue(orgA,instanceC,'dead-by-lease');
    const behindExhaustedId=await enqueue(orgA,instanceC,'behind-exhausted');
    await db.query("UPDATE public.whatsapp_ingress_events SET attempts=8,status='processing',lease_until=now()-interval '1 second' WHERE id=$1",[exhaustedId]);
    assert.equal((await claim(instanceC)).length,0);
    assert.equal((await db.query('SELECT status FROM public.whatsapp_ingress_events WHERE id=$1',[exhaustedId])).rows[0].status,'dead_letter');
    assert.equal((await db.query('SELECT status FROM public.whatsapp_ingress_events WHERE id=$1',[behindExhaustedId])).rows[0].status,'pending');
    assert.equal((await snapshot(orgA,instanceC)).dead_letter_count,1);
    const moreOther=await enqueue(orgB,instanceB,'still-running');
    assert.equal((await claim(instanceA,instanceC,instanceB))[0].id,moreOther);
    assert.equal((await db.query("SELECT pg_get_function_result('public.get_whatsapp_ingress_handoff_snapshot(uuid,uuid)'::regprocedure) AS result")).rows[0].result.includes('payload'),false);
    assert.equal(await pause(orgA,instanceC,true,0),1);
    await db.query('UPDATE public.whatsapp_instances SET organization_id=$1 WHERE id=$2',[orgB,instanceC]);
    await assert.rejects(snapshot(orgB,instanceC),/control organization mismatch/);
    await assert.rejects(pause(orgB,instanceC,false,0),/control organization mismatch/);
    assert.deepEqual((await db.query('SELECT organization_id,paused,revision FROM public.whatsapp_ingress_worker_control WHERE instance_id=$1',[instanceC])).rows[0],{
      organization_id:orgA,paused:true,revision:1,
    });
    const rollback=read('supabase/migrations/rollback/20271021000032_whatsapp_ingress_worker_pause.sql');
    await assert.rejects(db.exec(rollback),/requires draining all noncompleted events/);
    await db.exec('ROLLBACK');
    await db.query("UPDATE public.whatsapp_ingress_events SET status='completed',completed_at=now(),lease_token=NULL,lease_until=NULL");
    await assert.rejects(db.exec(rollback),/requires clearing all control rows/);
    await db.exec('ROLLBACK');
    const retained=(await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_ingress_events')).rows[0].n;
    await db.exec('DELETE FROM public.whatsapp_ingress_worker_control');
    await db.exec(rollback);
    assert.equal((await db.query("SELECT has_function_privilege('service_role','public.set_whatsapp_ingress_worker_pause(uuid,uuid,boolean,bigint)','EXECUTE') AS allowed")).rows[0].allowed,false);
    assert.equal((await db.query("SELECT has_function_privilege('service_role','public.get_whatsapp_ingress_handoff_snapshot(uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,true);
    assert.equal((await db.query("SELECT pg_get_functiondef('public.claim_whatsapp_ingress_events(uuid[],integer)'::regprocedure) AS body")).rows[0].body,originalClaim);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_ingress_events')).rows[0].n,retained);
  } finally { await db.close(); }
});
