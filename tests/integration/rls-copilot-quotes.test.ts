// @vitest-environment node
// Local Postgres engine; no network, credentials or production writes.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const db = new PGlite();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
    CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE copilot_agents(id uuid PRIMARY KEY, organization_id uuid);
    CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid);
    CREATE TABLE conversations(id uuid PRIMARY KEY, organization_id uuid, agent_id uuid, lead_id uuid);
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
    GRANT ALL ON storage.objects TO anon,authenticated,service_role;
    CREATE POLICY broad_existing_policy ON storage.objects FOR ALL TO anon,authenticated USING (true) WITH CHECK (true);
    GRANT USAGE ON SCHEMA public TO service_role,authenticated,anon;
    GRANT SELECT ON organizations,copilot_agents,leads,conversations TO service_role;
  `);
  await db.exec(readFileSync('supabase/migrations/20260923140413_copilot_quote_documents.sql','utf8'));
  for(let org=1;org<=2;org++) await db.exec(`
    INSERT INTO organizations VALUES('${id(org)}');
    INSERT INTO copilot_agents(id,organization_id) VALUES('${id(org+10)}','${id(org)}');
    INSERT INTO leads VALUES('${id(org+20)}','${id(org)}');
    INSERT INTO conversations VALUES('${id(org+30)}','${id(org)}','${id(org+10)}','${id(org+20)}');
    INSERT INTO copilot_quote_templates(id,organization_id,agent_id,name,file_path,sha256,fields)
    VALUES('${id(org+40)}','${id(org)}','${id(org+10)}','test.docx','${org}/test.docx',repeat('a',64),'["customer"]');
  `);
},30000);
afterAll(async()=>{await db.close();});
async function asRole(role:string,sql:string){
  await db.exec(`SET ROLE ${role}`);
  try {return await db.exec(sql);} finally {await db.exec('RESET ROLE');}
}
const insert=(n:number,org=1,agent=11,lead=21,conv=31,template=41)=>`INSERT INTO copilot_quotes(id,organization_id,agent_id,lead_id,conversation_id,template_id) VALUES('${id(n)}','${id(org)}','${id(agent)}','${id(lead)}','${id(conv)}','${id(template)}')`;
describe('private quote schema',()=>{
  it('defaults agents in every organization to disabled',async()=>{
    expect((await db.query('SELECT can_generate_order_request FROM copilot_agents')).rows).toEqual([
      {can_generate_order_request:false}, {can_generate_order_request:false},
    ]);
  });
  it.each(['anon','authenticated'])('revokes inherited function execution for %s',async role=>{
    for (const fn of ['validate_copilot_quote_scope','audit_copilot_quote']) {
      expect((await db.query(`SELECT has_function_privilege('${role}', 'public.${fn}()', 'EXECUTE') AS allowed`)).rows).toEqual([{allowed:false}]);
    }
  });
  it('allows scoped server writes and records an atomic audit snapshot',async()=>{
    await asRole('service_role',insert(100));
    expect((await db.query('SELECT revision,status FROM copilot_quote_events')).rows).toEqual([{revision:1,status:'draft'}]);
  });
  it.each(['anon','authenticated'])('denies direct reads and forged writes by %s',async role=>{
    for(const table of ['copilot_quote_templates','copilot_quotes','copilot_quote_events']) await expect(asRole(role,`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
    await expect(asRole(role,insert(101,2,12,22,32,42))).rejects.toThrow(/permission denied/);
  });
  it('blocks cross-tenant agent, lead, conversation and template even for the server',async()=>{
    for(const sql of [insert(102,1,12),insert(102,1,11,22),insert(102,1,11,21,32),insert(102,1,11,21,31,42)]) await expect(asRole('service_role',sql)).rejects.toThrow();
  });
  it('keeps old revisions, prevents concurrent open orders, permits a new completed-order successor',async()=>{
    await asRole('service_role',`UPDATE copilot_quotes SET revision=2,data='{"changed":true}' WHERE id='${id(100)}'`);
    await expect(asRole('service_role',insert(103))).rejects.toThrow(/duplicate key/);
    await asRole('service_role',`UPDATE copilot_quotes SET status='sent' WHERE id='${id(100)}'`);
    await expect(asRole('service_role',`UPDATE copilot_quotes SET data='{}' WHERE id='${id(100)}'`)).rejects.toThrow(/immutable/);
    await asRole('service_role',insert(103));
    expect((await db.query(`SELECT count(*)::int AS n FROM copilot_quote_events WHERE quote_id='${id(100)}'`)).rows).toEqual([{n:3}]);
  });
  it('enables RLS on all three tables and keeps the bucket private',async()=>{
    const rows=await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname IN ('copilot_quote_templates','copilot_quotes','copilot_quote_events')`);
    expect(rows.rows).toEqual([{relrowsecurity:true},{relrowsecurity:true},{relrowsecurity:true}]);
    expect((await db.query('SELECT public FROM storage.buckets')).rows).toEqual([{public:false}]);
  });
  it.each(['anon','authenticated'])('blocks quote storage even under broad existing policies (%s)',async role=>{
    await asRole('service_role',`INSERT INTO storage.objects VALUES('copilot-quotes','${role}/private.docx')`);
    const read=await asRole(role,"SELECT * FROM storage.objects WHERE bucket_id='copilot-quotes'");
    expect(read[0].rows).toEqual([]);
    await expect(asRole(role,"INSERT INTO storage.objects VALUES('copilot-quotes','forged.docx')")).rejects.toThrow(/row-level security/);
    await asRole(role,`INSERT INTO storage.objects VALUES('other-bucket','${role}/unchanged.docx')`);
  });
});
