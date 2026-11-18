import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.REGIONAL_PGLITE ?? '@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sql = path => readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
let db;
const query = (text,args=[]) => db.query(text,args);
const asUser = async n => { await query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]); };
const metric = (measure='receita',cut='total',filters={},org=1,ref=null) => query('select fn_metric_measure($1,$2,$3,$4,$5,null,null,$6) result',[id(org),JSON.stringify(ref??{kind:'leaf',id:measure}),cut,'month','2026-11-16',JSON.stringify(filters)]).then(r=>r.rows[0].result);
before(async()=>{
 db=new PGlite(); await db.exec(sql('tests/fixtures/regional-sales-schema.sql'));
 await db.exec(`INSERT INTO organizations(id,name) VALUES('${id(1)}','JR Tex'),('${id(2)}','Other');
 INSERT INTO team_members(id,organization_id,user_id,name,role) VALUES
 ('${id(10)}','${id(1)}','${id(110)}','Karine','member'),('${id(11)}','${id(1)}','${id(111)}','Ivan','member'),('${id(12)}','${id(1)}','${id(112)}','Outro representante','member'),('${id(13)}','${id(1)}','${id(113)}','Marla','admin'),('${id(20)}','${id(2)}','${id(120)}','Outra org','admin');
 INSERT INTO whatsapp_instances VALUES('${id(30)}','${id(1)}','Principal');
 INSERT INTO pipelines VALUES('${id(40)}','${id(1)}','Vendas - JRtex'),('${id(41)}','${id(1)}','Vendas - Profit');
 INSERT INTO private.jrtex_pipeline_accounts VALUES('${id(110)}','jrtex'),('${id(111)}','jrtex'),('${id(112)}','jrtex'),('${id(113)}','profit');
 INSERT INTO leads(id,organization_id,name,origin,created_at,sale_responsible_id) VALUES('${id(50)}','${id(1)}','JR lead','meta_ads','2026-11-03','${id(11)}'),('${id(51)}','${id(1)}','Profit lead','instagram','2026-11-03','${id(13)}');
 INSERT INTO pipeline_entries(id,organization_id,pipeline_id,lead_id,entered_at) VALUES('${id(60)}','${id(1)}','${id(40)}','${id(50)}','2026-11-03'),('${id(61)}','${id(1)}','${id(41)}','${id(51)}','2026-11-03');
 INSERT INTO sale_events(id,organization_id,lead_id,pipeline_id,event_type,sold_at,sale_value,sale_responsible_id) VALUES
 ('${id(70)}','${id(1)}','${id(50)}','${id(40)}','sale','2026-11-04',150,'${id(11)}'),('${id(71)}','${id(1)}','${id(51)}','${id(41)}','sale','2026-11-04',999,'${id(13)}'),('${id(72)}','${id(1)}','${id(50)}','${id(40)}','sale','2026-11-04',700,'${id(12)}');
 INSERT INTO sale_events(id,organization_id,event_type,reversed_event_id) VALUES('${id(73)}','${id(1)}','sale_reversed','${id(72)}');`);
 await asUser(110);
 await assert.rejects(metric(),/Acesso restrito aos funis/); // original production symptom
 await db.exec(sql('supabase/migrations/20280112001000_regional_sales_reports.sql'));
 await db.exec(`INSERT INTO private.regional_sales_config(organization_id,pipeline_ids,report_user_ids,triage_member_id,instance_id) VALUES('${id(1)}',ARRAY['${id(40)}'::uuid],ARRAY['${id(110)}'::uuid],'${id(10)}','${id(30)}')`);
 await query("INSERT INTO metrics_studio_panels VALUES($1,$2,'regional-sales'),($3,$2,null)",[id(90),id(1),id(91)]);
 await db.exec(sql('supabase/migrations/20280112006000_regional_report_canonical_attribution.sql'));
});
after(async()=>{await db?.close();});
test('manager can read net sales; Profit and reversed sales are excluded',async()=>{
 await asUser(110); assert.equal((await metric()).value,150);
 assert.deepEqual((await metric('num_vendas','closer')).series,[{key:id(11),label:'Ivan',value:1}]);
 assert.deepEqual((await metric('leads_criados','origem')).series,[{key:'meta_ads',label:'meta_ads',value:1}]);
});
test('explicit unauthorized pipeline cannot broaden scope',async()=>{await asUser(110);await assert.rejects(metric('receita','total',{pipeline_id:id(41)}),/Funil fora/);});
test('representatives, other group, other organization and anonymous cannot read manager report',async()=>{
 for(const user of [111,112,113,120]){await asUser(user);await assert.rejects(metric(),/restritos|access_denied/);}
 await query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(metric(),/access_denied/);
});
test('removing manager or membership immediately revokes access',async()=>{
 await asUser(110);await db.exec(`UPDATE team_members SET is_active=false WHERE id='${id(10)}'`);
 await assert.rejects(metric(),/access_denied/);await db.exec(`UPDATE team_members SET is_active=true WHERE id='${id(10)}'`);
});
test('ratios use the same scoped, net-of-reversal sources',async()=>{await asUser(110);assert.equal((await metric(null,'total',{},1,{kind:'ratio',num:'receita',den:'num_vendas'})).value,150);});

test('lead metrics use canonical owners while sales retain their event snapshot',async()=>{
 await db.exec('BEGIN');
 try{
   await asUser(110);
   await query('UPDATE leads SET sale_responsible_id=null,pre_sale_responsible_id=null,closer_id=$1,sdr_id=$1 WHERE id=$2',[id(11),id(50)]);
   assert.deepEqual((await metric('leads_criados','closer')).series,[{key:null,label:'Não informado',value:1}]);
   assert.deepEqual((await metric('leads_criados','sdr')).series,[{key:null,label:'Não informado',value:1}]);
   assert.deepEqual((await metric('num_vendas','closer')).series,[{key:id(11),label:'Ivan',value:1}]);
 }finally{await db.exec('ROLLBACK');}
});

async function withRole(role,user,fn){
 await db.exec('BEGIN');
 try{
   await asUser(user);
   await db.exec(`SET LOCAL ROLE ${role}`);
   return await fn();
 }finally{await db.exec('ROLLBACK');}
}
test('actual authenticated role sees the management panel only for authorized Karine',async()=>{
 for(const [user,expected] of [[110,1],[111,0],[112,0],[113,0],[120,0]]){
   const found=await withRole('authenticated',user,()=>query("SELECT count(*)::int n FROM metrics_studio_panels WHERE template_key='regional-sales'"));
   assert.equal(found.rows[0].n,expected);
 }
 assert.equal((await withRole('authenticated',110,()=>metric())).value,150);
});
test('actual client roles cannot read/write the private report scope',async()=>{
 const forbidden=[
   'SELECT * FROM private.regional_sales_config',
   'UPDATE private.regional_sales_config SET report_user_ids=ARRAY[auth.uid()]',
 ];
 for(const role of ['authenticated','anon'])for(const statement of forbidden){
   await assert.rejects(withRole(role,111,()=>query(statement)),error=>error.code==='42501');
 }
 await assert.rejects(withRole('anon',111,()=>query('SELECT * FROM metrics_studio_panels')),error=>error.code==='42501');
});
