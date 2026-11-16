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
 await db.exec(sql('supabase/migrations/20280112002000_regional_sales_distribution.sql'));
 await db.exec(sql('supabase/migrations/20280112003000_regional_contact_capture_safety.sql'));
 await db.exec(sql('supabase/migrations/20280112004000_regional_capture_pipeline_scope.sql'));
 await db.exec(sql('supabase/migrations/20280112005000_regional_handoff_guards.sql'));
 await db.exec('UPDATE private.regional_sales_config SET routing_enabled=true');
 await db.exec(`INSERT INTO private.regional_sales_cities VALUES('SC','blumenau','Blumenau',4202404),('AM','manaus','Manaus',1302603);
 INSERT INTO private.regional_sales_routes(organization_id,uf,member_ids,last_member_id) VALUES('${id(1)}','SC',ARRAY['${id(11)}'::uuid,'${id(12)}'::uuid],NULL);
 INSERT INTO lead_custom_fields(id,organization_id,field_name) VALUES('${id(80)}','${id(1)}','cidade'),('${id(81)}','${id(1)}','jrtex_estado'),('${id(82)}','${id(1)}','cnpj');`);
});
after(async()=>{await db?.close();});
test('disabled routing makes the background worker a no-op',async()=>{
 await db.exec('UPDATE private.regional_sales_config SET routing_enabled=false');
 assert.deepEqual((await query('select private.process_regional_sales() result')).rows[0].result,{reviewed:0});
 await db.exec('UPDATE private.regional_sales_config SET routing_enabled=true');
});
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
test('actual client roles cannot read/write private scopes or call internal assignment',async()=>{
 const forbidden=[
   'SELECT * FROM private.regional_sales_config',
   'SELECT * FROM private.regional_sales_routes',
   'SELECT * FROM private.regional_sales_assignment_log',
   'UPDATE private.regional_sales_config SET report_user_ids=ARRAY[auth.uid()]',
   `INSERT INTO private.regional_sales_routes(organization_id,uf,member_ids) VALUES('${id(1)}','RJ','{}')`,
   `SELECT private.regional_assign('${id(50)}')`,
   'SELECT private.process_regional_sales()',
 ];
 for(const role of ['authenticated','anon'])for(const statement of forbidden){
   await assert.rejects(withRole(role,111,()=>query(statement)),error=>error.code==='42501');
 }
 await assert.rejects(withRole('anon',111,()=>query('SELECT * FROM metrics_studio_panels')),error=>error.code==='42501');
});

async function contact(n,city='Blumenau',uf='SC',tax='11.222.333/0001-81'){
 await db.exec(`INSERT INTO leads(id,organization_id,name,uf,uf_source) VALUES('${id(n)}','${id(1)}','Contato teste','SC','ddd');
 INSERT INTO pipeline_entries(id,organization_id,pipeline_id,lead_id) VALUES('${id(n+1000)}','${id(1)}','${id(40)}','${id(n)}');`);
 for(const [field,value] of [[80,city],[81,uf],[82,tax]])if(value!==null)await query('INSERT INTO lead_custom_field_values(lead_id,field_id,value) VALUES($1,$2,$3)',[id(n),id(field),value]);
}
const assign=(n,redistribute=false,at='2026-11-16T17:00:00Z')=>query('select private.regional_assign($1,$2,$3) result',[id(n),redistribute,at]).then(r=>r.rows[0].result);
test('CNPJ validation accepts numeric and alphanumeric check digits, rejects empty and malformed',async()=>{
 await query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");
 for(const value of ['11.222.333/0001-81','00.000.000/E08G-12'])assert.equal((await query('select private.regional_valid_cnpj($1) ok',[value])).rows[0].ok,true);
 for(const value of ['',null,'11111111111111','11.222.333/0001-82'])assert.equal((await query('select private.regional_valid_cnpj($1) ok',[value])).rows[0].ok,false);
});
test('missing CNPJ or explicit UF blocks routing, including a direct manual handoff',async()=>{
 await contact(201,'Blumenau','SC',null);assert.equal((await assign(201)).status,'pending');
 await assert.rejects(query('UPDATE leads SET sale_responsible_id=$1 WHERE id=$2',[id(11),id(201)]),/CNPJ válido/);
 await contact(202,'Blumenau',null);assert.equal((await assign(202)).status,'pending');
});
test('qualified contacts rotate sequentially and preserve an already assigned owner',async()=>{
 await contact(203);await contact(204);
 const a=(await query('SELECT sale_responsible_id owner FROM leads WHERE id=$1',[id(203)])).rows[0].owner;
 const b=(await query('SELECT sale_responsible_id owner FROM leads WHERE id=$1',[id(204)])).rows[0].owner;
 assert.notEqual(a,b);assert.equal((await assign(203)).status,'preserved');
});
test('uncovered state goes to Karine and creates only one persistent task',async()=>{
 await contact(205,'Manaus','AM');assert.equal((await assign(205)).assigned_to,id(10));await assign(205);
 assert.equal((await query('SELECT count(*)::int n FROM follow_ups WHERE lead_id=$1',[id(205)])).rows[0].n,1);
});
test('business clock excludes lunch, nights and weekends exactly',async()=>{
 const minutes=async(a,b)=>(await query('select private.regional_work_minutes($1,$2,$3) n',[a,b,id(1)])).rows[0].n;
 assert.equal(Number(await minutes('2026-11-16T14:00:00Z','2026-11-16T18:00:00Z')),180); // 11h-15h, lunch excluded
 assert.equal(Number(await minutes('2026-11-13T20:00:00Z','2026-11-16T13:00:00Z')),180); // Fri17h-Mon10h
 assert.equal(Number(await minutes('2026-11-16T15:00:00Z','2026-11-16T16:00:00Z')),0);
});
test('three useful hours reassign atomically and remove all old ownership paths',async()=>{
 await contact(206);const old=(await query('select sale_responsible_id owner from leads where id=$1',[id(206)])).rows[0].owner;
 await query("update private.regional_sales_state set awaiting_since='2026-11-16T14:00:00Z' where lead_id=$1",[id(206)]);
 await query("insert into lead_owners(organization_id,lead_id,team_member_id,role) values($1,$2,$3,'co')",[id(1),id(206),old]);
 assert.equal((await assign(206,true,'2026-11-16T17:59:00Z')).status,'not_due');
 const routed=await assign(206,true,'2026-11-16T18:00:00Z');assert.equal(routed.status,'assigned');assert.notEqual(routed.assigned_to,old);
 const l=(await query('select pre_sale_responsible_id,sale_responsible_id,sdr_id,closer_id,responsible_id,responsible_user_id from leads where id=$1',[id(206)])).rows[0];assert.ok(Object.values(l).every(v=>v===routed.assigned_to));
 assert.equal((await query('select count(*)::int n from lead_owners where lead_id=$1 and team_member_id=$2',[id(206),old])).rows[0].n,0);
 assert.equal((await query('select assigned_to from pipeline_entries where lead_id=$1',[id(206)])).rows[0].assigned_to,routed.assigned_to);
});
test('existing purchase protects portfolio and escalates the unanswered contact',async()=>{
 await assign(50);await query("update private.regional_sales_state set awaiting_since='2026-11-16T11:00:00Z' where lead_id=$1",[id(50)]);
 assert.equal((await assign(50,true,'2026-11-16T18:00:00Z')).status,'protected');
});
test('incoming explicit city/UF/CNPJ qualifies; human phone reply clears SLA, automation does not',async()=>{
 await contact(207,null,null,null);
 await query("insert into whatsapp_messages(organization_id,lead_id,instance_id,direction,content,timestamp,status) values($1,$2,$3,'incoming','Blumenau SC, CNPJ 11.222.333/0001-81',now(),'received')",[id(1),id(207),id(30)]);
 let s=(await query('select * from private.regional_sales_state where lead_id=$1',[id(207)])).rows[0];assert.ok(s.assigned_to);assert.ok(s.awaiting_since);
 await query("insert into whatsapp_messages(organization_id,lead_id,instance_id,direction,content,timestamp,status,sent_source,sent_by_ai) values($1,$2,$3,'outgoing','Automático',now(),'sent','workflow',true)",[id(1),id(207),id(30)]);
 assert.ok((await query('select awaiting_since from private.regional_sales_state where lead_id=$1',[id(207)])).rows[0].awaiting_since);
 await query("insert into whatsapp_messages(organization_id,lead_id,instance_id,direction,content,timestamp,status,sent_source,sent_by_ai) values($1,$2,$3,'outgoing','Resposta no aparelho',now(),'sent','manual',false)",[id(1),id(207),id(30)]);
 assert.equal((await query('select awaiting_since from private.regional_sales_state where lead_id=$1',[id(207)])).rows[0].awaiting_since,null);
});

test('inactive representatives are skipped and an empty pool uses factory triage',async()=>{
 await query('update team_members set is_active=false where id=$1',[id(11)]);
 await contact(208);assert.equal((await assign(208)).assigned_to,id(12));
 await query('update team_members set is_active=false where id=$1',[id(12)]);
 await contact(209);assert.equal((await assign(209)).assigned_to,id(10));
 await query('update team_members set is_active=true where id=any($1)',[[id(11),id(12)]]);
});

test('new qualification by a member queues assignment for the trusted worker',async()=>{
 await query("select set_config('request.jwt.claim.role','authenticated',false)");await asUser(110);
 await contact(210);assert.equal((await assign(210)).status,'queued');
 assert.equal((await query('select sale_responsible_id owner from leads where id=$1',[id(210)])).rows[0].owner,null);
 await query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");
 await query('select private.process_regional_sales()');
 assert.ok([id(11),id(12)].includes((await query('select sale_responsible_id owner from leads where id=$1',[id(210)])).rows[0].owner));
});

test('active negotiation protects ownership and shared-pipeline records require review',async()=>{
 await contact(211);
 await query("insert into pipeline_stages(id,pipeline_id,name,stage_role) values($1,$2,'Negociando Quente','open')",[id(301),id(40)]);
 await query('insert into deals(id,organization_id,source_lead_id) values($1,$2,$3)',[id(302),id(1),id(211)]);
 await query('update pipeline_entries set deal_id=$1,stage_id=$2 where lead_id=$3',[id(302),id(301),id(211)]);
 await query("update private.regional_sales_state set awaiting_since='2026-11-16T11:00:00Z' where lead_id=$1",[id(211)]);
 assert.equal((await assign(211,true,'2026-11-16T18:00:00Z')).status,'protected');
 await contact(212);
 await query('insert into pipeline_entries(id,organization_id,pipeline_id,lead_id) values($1,$2,$3,$4)',[id(3212),id(1),id(41),id(212)]);
 await query("update private.regional_sales_state set awaiting_since='2026-11-16T11:00:00Z' where lead_id=$1",[id(212)]);
 assert.equal((await assign(212,true,'2026-11-16T18:00:00Z')).status,'shared_portfolio');
 assert.equal((await query('select awaiting_since from private.regional_sales_state where lead_id=$1',[id(212)])).rows[0].awaiting_since,null);
});

test('historical messages and unsent replies do not change the response clock',async()=>{
 await contact(213);
 const msg=(direction,at,status,source='manual')=>query('insert into whatsapp_messages(organization_id,lead_id,instance_id,direction,timestamp,status,sent_source) values($1,$2,$3,$4,$5,$6,$7)',[id(1),id(213),id(30),direction,at,status,source]);
 await msg('incoming','2026-01-01','received');
 assert.equal((await query('select awaiting_since from private.regional_sales_state where lead_id=$1',[id(213)])).rows[0].awaiting_since,null);
 await msg('incoming',new Date().toISOString(),'received');
 await msg('outgoing',new Date().toISOString(),'failed');
 assert.ok((await query('select awaiting_since from private.regional_sales_state where lead_id=$1',[id(213)])).rows[0].awaiting_since);
});

test('city, UF and CNPJ can arrive separately; ordinary Portuguese words do not overwrite UF',async()=>{
 await contact(214,null,null,null);
 const receive=text=>query("insert into whatsapp_messages(organization_id,lead_id,instance_id,direction,content,timestamp,status) values($1,$2,$3,'incoming',$4,now(),'received')",[id(1),id(214),id(30),text]);
 await receive('Blumenau');await receive('sc');
 assert.equal((await assign(214)).status,'pending');
 await receive('11.222.333/0001-81');
 assert.ok([id(11),id(12)].includes((await assign(214)).assigned_to));
 await receive('Me avise se precisar de algo');
 assert.equal((await query('select private.regional_contact_data($1) d',[id(214)])).rows[0].d.uf,'SC');
});

test('capture leaves leads outside the configured commercial pipelines untouched',async()=>{
 await query("insert into whatsapp_messages(organization_id,lead_id,instance_id,direction,content,timestamp,status) values($1,$2,$3,'incoming','Blumenau SC 11.222.333/0001-81',now(),'received')",[id(1),id(51),id(30)]);
 assert.equal((await query('select count(*)::int n from lead_custom_field_values where lead_id=$1',[id(51)])).rows[0].n,0);
 assert.equal((await query('select count(*)::int n from private.regional_sales_state where lead_id=$1',[id(51)])).rows[0].n,0);
});

test('qualification cannot be bypassed through a secondary owner, card or co-owner',async()=>{
 await contact(215,null,null,null);
 for(const field of ['pre_sale_responsible_id','sale_responsible_id','sdr_id','closer_id','responsible_id','responsible_user_id'])await assert.rejects(query(`UPDATE leads SET ${field}=$1 WHERE id=$2`,[id(11),id(215)]),/CNPJ válido/);
 await assert.rejects(query('UPDATE pipeline_entries SET assigned_to=$1 WHERE lead_id=$2',[id(11),id(215)]),/CNPJ válido/);
 await assert.rejects(query("UPDATE pipeline_entries SET metadata=jsonb_build_object('closer_id',$1::text) WHERE lead_id=$2",[id(11),id(215)]),/CNPJ válido/);
 await assert.rejects(query("INSERT INTO lead_owners(organization_id,lead_id,team_member_id,role) VALUES($1,$2,$3,'co')",[id(1),id(215),id(11)]),/CNPJ válido/);
});

test('manual owner change resets an already-running response clock',async()=>{
 await contact(216);const old=(await query('SELECT sale_responsible_id owner FROM leads WHERE id=$1',[id(216)])).rows[0].owner;
 const next=old===id(11)?id(12):id(11);
 await query("UPDATE private.regional_sales_state SET awaiting_since=now()-interval '7 days' WHERE lead_id=$1",[id(216)]);
 await query('SELECT private.regional_set_owner($1,$2,$3,now())',[id(1),id(216),next]);
 const s=(await query('SELECT assigned_to,awaiting_since>now()-interval \'1 minute\' fresh FROM private.regional_sales_state WHERE lead_id=$1',[id(216)])).rows[0];
 assert.equal(s.assigned_to,next);assert.equal(s.fresh,true);
 assert.equal((await query('SELECT private.regional_assign($1,true,now()) r',[id(216)])).rows[0].r.status,'not_due');
});
