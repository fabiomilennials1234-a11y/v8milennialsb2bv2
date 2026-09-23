import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const migration='20271021000028_uazapi_group_source_policy.sql';
const org='10000000-0000-0000-0000-000000000001', other='10000000-0000-0000-0000-000000000002';
const one='20000000-0000-0000-0000-000000000001',two='20000000-0000-0000-0000-000000000002',three='20000000-0000-0000-0000-000000000003';

test('group policy preserves capture, scoped leases, uncertain writers and reversible deployment',async()=>{
 const db=new PGlite();
 const q=(sql,args=[])=>db.query(sql,args);
 const request=async(capture)=>q('SELECT request_uazapi_group_capture($1,$2)',[org,capture]);
 const prepare=async(id=one,enabled=true,scope=org)=>(await q('SELECT prepare_uazapi_group_webhook($1,$2,$3) value',[id,scope,enabled])).rows[0].value;
 const finish=async(id,lease,excluded)=>(await q('SELECT finish_uazapi_group_webhook($1,$2,$3,$4,$5) value',[id,org,lease.token,lease.revision,excluded])).rows[0].value;
 const capturing=async()=>(await q('SELECT capture_groups FROM organizations WHERE id=$1',[org])).rows[0].capture_groups;
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE organizations(id uuid PRIMARY KEY,capture_groups boolean);CREATE TABLE whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations(id),provider text);`);
  await q('INSERT INTO organizations VALUES($1,false),($2,true)',[org,other]);
  await q("INSERT INTO whatsapp_instances VALUES($1,$3,'uazapi'),($2,$3,'uazapi')",[one,two,org]);
  await db.exec(read(`supabase/migrations/${migration}`));
  for(const sig of ['request_uazapi_group_capture(uuid,boolean)','prepare_uazapi_group_webhook(uuid,uuid,boolean)','finish_uazapi_group_webhook(uuid,uuid,uuid,bigint,boolean)','recover_uazapi_group_webhook(uuid,uuid,uuid,boolean)']){
   assert.deepEqual((await q('SELECT has_function_privilege(\'anon\',$1,\'EXECUTE\') anon,has_function_privilege(\'authenticated\',$1,\'EXECUTE\') authenticated,has_function_privilege(\'service_role\',$1,\'EXECUTE\') service',[sig])).rows[0],{anon:false,authenticated:false,service:true});
  }
  assert.equal((await q("SELECT count(*)::int count FROM pg_class WHERE relname IN ('uazapi_group_policy','uazapi_group_webhook_state') AND relrowsecurity")).rows[0].count,2);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(q('SELECT * FROM uazapi_group_policy'),/permission denied/);
  await assert.rejects(request(false),/permission denied/);
  await db.exec('RESET ROLE');
  await q('SELECT request_uazapi_group_capture($1,false)',[other]);
  await q('SELECT request_uazapi_group_capture($1,true)',[other]);
  assert.equal((await q('SELECT capture_groups FROM organizations WHERE id=$1',[other])).rows[0].capture_groups,true);
  assert.equal(await prepare(one,false),null,'legacy off has no managed mutation');
  assert.equal(await prepare(one,true),null,'global flag cannot enroll unrelated organizations');
  await assert.rejects(prepare(one,true,other),/instance_scope_denied/);
  await request(false);
  const a=await prepare(); assert.equal(a.exclude_groups,true);
  await assert.rejects(prepare(),/in_progress_or_uncertain/);
  await q("UPDATE uazapi_group_webhook_state SET lease_started_at=now()-interval '1 day' WHERE instance_id=$1",[one]);
  await assert.rejects(prepare(),/in_progress_or_uncertain/,'lease must not be stolen after deadline');
  await assert.rejects(request(true),/in_progress_or_uncertain/);
  await assert.rejects(q('UPDATE organizations SET capture_groups=true WHERE id=$1',[org]),/use_request_uazapi_group_capture|reconcile_group_webhooks/);
  await assert.rejects(finish(one,{...a,revision:a.revision+1},true),/stale_or_unverified/);
  await assert.rejects(finish(one,{...a,token:three},true),/stale_webhook_lease/);
  assert.equal(await finish(one,a,true),false);
  await assert.rejects(finish(one,a,true),/stale_webhook_lease/,'CAS only finishes once');
  const b=await prepare(two);await finish(two,b,true);
  await assert.rejects(db.exec(read(`supabase/migrations/rollback/${migration}`)),/remove_and_verify/);
  await request(true);
  const remove=await prepare();assert.equal(remove.exclude_groups,false);
  await assert.rejects(finish(one,remove,true),/cannot_exclude/);
  assert.equal(await finish(one,remove,false),false,'second instance still excludes');
  assert.equal(await capturing(),false);
  const remove2=await prepare(two,false); assert.equal(remove2.exclude_groups,false);
  assert.equal(await finish(two,remove2,false),true);
  assert.equal(await capturing(),true);
  await assert.rejects(q('UPDATE organizations SET capture_groups=false WHERE id=$1',[org]),/use_request_uazapi_group_capture/);
  // New instance while capture is enabled cannot receive the exclusion.
  await q("INSERT INTO whatsapp_instances VALUES($1,$2,'uazapi')",[three,org]);
  const fresh=await prepare(three);assert.equal(fresh.exclude_groups,false);await finish(three,fresh,false);
  // Unknown capture must fail open, including a NULL organization preference.
  await q('UPDATE organizations SET capture_groups=NULL WHERE id=$1',[org]);
  const unknown=await prepare();assert.equal(unknown.exclude_groups,false);await finish(one,unknown,false);
  // Exceptional recovery requires exact scope, token and operational attestation.
  await request(false);const uncertain=await prepare();
  await assert.rejects(q('SELECT recover_uazapi_group_webhook($1,$2,$3,false)',[one,org,uncertain.token]),/must_be_stopped/);
  await assert.rejects(q('SELECT recover_uazapi_group_webhook($1,$2,$3,true)',[one,other,uncertain.token]),/stale_webhook/);
  await q('SELECT recover_uazapi_group_webhook($1,$2,$3,true)',[one,org,uncertain.token]);
  await assert.rejects(finish(one,uncertain,true),/stale_or_unverified/);
  const recovered=await prepare();assert.equal(recovered.exclude_groups,false);await finish(one,recovered,false);
  assert.equal(await capturing(),false,'recovery must not activate a feature the operator never requested');
  await db.exec(read(`supabase/migrations/rollback/${migration}`));
  assert.equal((await q("SELECT to_regclass('public.uazapi_group_policy') value")).rows[0].value,null);
  await db.exec(read(`supabase/migrations/${migration}`));
 } finally {await db.close();}
});

test('disposable preview harness rolls back its isolated schema',async()=>{
 const {buildGroupPolicyPreviewValidation}=await import('../../scripts/build-group-policy-preview-validation.mjs');
 const db=new PGlite();
 try {
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
  await db.exec(buildGroupPolicyPreviewValidation());
  assert.equal((await db.query("SELECT to_regnamespace('group_policy_test') value")).rows[0].value,null);
 }finally{await db.close();}
});
