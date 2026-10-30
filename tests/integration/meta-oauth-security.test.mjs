import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const org='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002', user='00000000-0000-4000-8000-000000000003', nonce='00000000-0000-4000-8000-000000000004';
test('OAuth storage: permissions, one-time nonce, current authority, atomic app/tenant bindings', async () => {
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE public.organizations(id uuid PRIMARY KEY);
   CREATE TABLE public.team_members(user_id uuid,organization_id uuid,is_active boolean,role text);
   CREATE TABLE public.master_users(user_id uuid,is_active boolean);
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
  const baseline=readFileSync('supabase/migrations/20260101000000_baseline_prod_schema.sql','utf8');
  await db.exec(`CREATE TYPE public.channel_type AS ENUM ('whatsapp','messenger','instagram','email','sms');
   CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,name text NOT NULL,origin text,meta_lead_id text,deleted_at timestamptz,email text,phone text,company text,segment text,urgency text,faturamento text,notes text,utm_campaign text,utm_source text,utm_medium text,utm_content text,utm_term text,meta_campaign_id text,meta_adset_id text,meta_ad_id text);`);
  for(const table of ['meta_connections','meta_pages','channel_messages']) {
   const block=baseline.match(new RegExp('CREATE TABLE IF NOT EXISTS "public"\\."'+table+'" \\([\\s\\S]*?\\n\\);'))?.[0]; assert.ok(block); await db.exec(block);
  }
  await db.exec(`ALTER TABLE public.meta_connections ADD PRIMARY KEY(id); ALTER TABLE public.meta_connections ADD CONSTRAINT meta_connections_org_fbuser_type_key UNIQUE(organization_id,facebook_user_id,connection_type);
    ALTER TABLE public.meta_pages ADD PRIMARY KEY(id); ALTER TABLE public.channel_messages ADD CONSTRAINT channel_messages_external UNIQUE(external_id,channel,organization_id); ALTER TABLE public.meta_pages ADD CONSTRAINT meta_pages_org_page_key UNIQUE(organization_id,page_id);`);
  await db.exec(`GRANT SELECT(access_token) ON meta_connections TO authenticated; GRANT SELECT(page_access_token) ON meta_pages TO authenticated;`);
  const conversations=readFileSync('supabase/migrations/20270728000000_meta_conversations.sql','utf8').match(/CREATE TABLE public.meta_conversations[\s\S]*?\n\);/)[0];
  await db.exec(conversations);
  await db.exec(readFileSync('supabase/migrations/20270728000003_upsert_meta_conversation_rpc.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20271215010000_meta_oauth_security.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20271215040000_meta_lead_schema_compatibility.sql','utf8'));
  for(const role of ['anon','authenticated']) {
   assert.equal((await db.query(`SELECT has_column_privilege($1,'meta_connections','access_token','SELECT') value`,[role])).rows[0].value,false);
   assert.equal((await db.query(`SELECT has_column_privilege($1,'meta_pages','page_access_token','SELECT') value`,[role])).rows[0].value,false);
   for(const fn of ['meta_consume_oauth_nonce(uuid,uuid,uuid,text,text)','meta_save_business_connection(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb)','meta_claim_webhooks(text)','meta_disconnect_connection(uuid,uuid)','meta_record_message(uuid,uuid,text,jsonb)','meta_record_lead(uuid,uuid,text,text,jsonb,uuid)']) assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') value',[role,fn])).rows[0].value,false);
  }
  assert.equal((await db.query(`SELECT has_column_privilege('authenticated','meta_pages','page_name','SELECT') value`)).rows[0].value,true);
  await db.exec(`INSERT INTO auth.users VALUES('${user}'); INSERT INTO organizations VALUES('${org}'),('${other}'); INSERT INTO team_members VALUES('${user}','${org}',true,'admin');`);
  const insertNonce=()=>db.exec(`INSERT INTO meta_oauth_nonces VALUES('${nonce}','${user}','${org}','123','facebook',now()+interval '10 minutes')`);
  const consume=(o=org,a='123')=>db.query(`SELECT meta_consume_oauth_nonce('${nonce}','${user}',$1,$2,'facebook') ok`,[o,a]);
  await insertNonce(); assert.equal((await consume(other)).rows[0].ok,false);assert.equal((await consume(org,'999')).rows[0].ok,false);assert.equal((await consume()).rows[0].ok,true);assert.equal((await consume()).rows[0].ok,false);
  await insertNonce(); await db.exec(`UPDATE team_members SET role='member'`); assert.equal((await consume()).rows[0].ok,false); await db.exec(`UPDATE team_members SET role='admin',is_active=false`); assert.equal((await consume()).rows[0].ok,false); await db.exec('UPDATE team_members SET is_active=true');
  const save=(app='123',pages=[{id:'42',name:'Test',access_token:'crm1.abcdefghijklmnop.ciphertext'}])=>db.query(`SELECT meta_save_business_connection('${user}','${org}',$1,'789','System','facebook','crm1.abcdefghijklmnop.ciphertext',NULL,$2::jsonb) id`,[app,JSON.stringify(pages)]);
  const id=(await save()).rows[0].id; assert.ok(id);
  await db.exec("UPDATE team_members SET role='member'");await assert.rejects(save(),/authority_revoked/);await db.exec("UPDATE team_members SET role='admin'");
  await assert.rejects(save('999'),/rebind/); assert.equal((await db.query(`SELECT count(*)::int n FROM meta_connections`)).rows[0].n,1);
  assert.equal((await db.query(`SELECT token_expires_at FROM meta_connections`)).rows[0].token_expires_at,null);
  await db.exec(`SET ROLE authenticated`); await assert.rejects(db.query('SELECT access_token FROM meta_connections'),/permission denied/);await assert.rejects(db.query(`UPDATE meta_pages SET page_access_token='forged'`),/permission denied/);await db.exec('RESET ROLE');
  const pageId=(await db.query('SELECT id FROM meta_pages')).rows[0].id;
  const message={channel:'messenger',external_id:'mid-test',sender_id:'human',direction:'incoming',message_type:'text',content:'test',status:'received',timestamp:new Date().toISOString(),raw_payload:{}};
  for(let i=0;i<2;i++) await db.query(`SELECT meta_record_message($1,$2,'123',$3)`,[org,pageId,JSON.stringify(message)]);
  assert.equal((await db.query('SELECT unread_count FROM meta_conversations')).rows[0].unread_count,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM channel_messages')).rows[0].n,1);
  await assert.rejects(db.query(`SELECT meta_record_message($1,$2,'999',$3)`,[org,pageId,JSON.stringify(message)]),/inactive/);
  const recordLead=(tenant=org,fields={name:'Test',email:'test@example.invalid',metadata:{leadgen_id:'111'}})=>db.query(`SELECT meta_record_lead($1,$2,'123','111',$3,NULL) id`,[tenant,pageId,JSON.stringify(fields)]);
  const first=(await recordLead(org,{name:'Test',email:'test@example.invalid',metadata:{leadgen_id:'111'},meta_lead_id:'forged',organization_id:other,responsible_id:other})).rows[0].id;
  assert.equal((await db.query('SELECT organization_id FROM leads')).rows[0].organization_id,org); assert.equal((await recordLead()).rows[0].id,first);
  assert.equal((await db.query('SELECT count(*)::int n FROM leads')).rows[0].n,1);
  assert.equal((await db.query('SELECT meta_lead_id FROM leads')).rows[0].meta_lead_id,'111');
  await assert.rejects(recordLead(other),/inactive/);
  await db.query("UPDATE leads SET deleted_at=now() WHERE id=$1",[first]);assert.equal((await recordLead()).rows[0].id,null);
  await db.query("DELETE FROM leads WHERE id=$1",[first]);assert.equal((await recordLead()).rows[0].id,null);assert.equal((await db.query("SELECT count(*)::int n FROM leads")).rows[0].n,0);
  await assert.rejects(db.query(`SELECT meta_record_lead($1,$2,'123','222',$3,NULL)`,[org,pageId,JSON.stringify({email:'no-name'})]),/not-null/);
  assert.equal((await db.query("SELECT count(*)::int n FROM meta_leadgen_deliveries WHERE leadgen_id='222'")).rows[0].n,0);
  await db.query(`SELECT meta_disconnect_connection('${org}',$1)`,[id]);assert.equal((await db.query('SELECT access_token,status FROM meta_connections')).rows[0].access_token,'');assert.equal((await db.query('SELECT is_active,page_access_token FROM meta_pages')).rows[0].is_active,false);
  const replacement=(await save('999')).rows[0].id;assert.notEqual(replacement,id);assert.equal((await db.query('SELECT meta_connection_id FROM meta_pages')).rows[0].meta_connection_id,replacement);
  await db.exec(`INSERT INTO meta_webhook_receipts(id,app_id,payload) VALUES('${'a'.repeat(64)}','123','{}')`);
  assert.equal((await db.query(`SELECT * FROM meta_claim_webhooks('999')`)).rows.length,0);assert.equal((await db.query(`SELECT * FROM meta_claim_webhooks('123')`)).rows.length,1);assert.equal((await db.query(`SELECT * FROM meta_claim_webhooks('123')`)).rows.length,0);
 } finally {await db.close();}
});
