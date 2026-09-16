import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sql = name => readFileSync(new URL(`../../${name}`,import.meta.url),'utf8');
const migration = 'supabase/migrations/20271021000014_client_portfolio_page.sql';
// Deliberately local-only. Never run these destructive fixtures against a project.
const port = Number(process.env.PORTFOLIO_PG_PORT ?? 55487);
const database = `torque_portfolio_test_${process.pid}`;
let admin, db, dates;
const login = async (org=id(1), adminUser=true) => {
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.org',$2,false),set_config('request.jwt.claim.admin',$3,false),set_config('request.jwt.claim.member',$4,false)",[id(900),org,String(adminUser),id(901)]);
  await db.query('SET ROLE authenticated');
};
const page = async (filters={},limit=50,offset=0,org=id(1)) => (await db.query('SELECT public.client_portfolio_page($1,$2,$3,$4) AS data',[org,JSON.stringify(filters),limit,offset])).rows[0].data;
const root = () => db.query('RESET ROLE');
const lead = async (n,org=id(1),name=`Cliente ${String(n).padStart(4,'0')}`) => {
  await db.query('INSERT INTO leads(id,organization_id,name,company,created_at,sale_responsible_id) VALUES($1,$2,$3,$3,$4,$5)',[id(n),org,name,dates.now,id(901)]);
  await db.query("INSERT INTO deals VALUES($1,$2,$3,'won',null)",[id(n+10000),org,id(n)]);
};
const sale = async (n,leadId,when,value=100,org=id(1)) => db.query("INSERT INTO sale_events VALUES($1,$2,$3,'sale',$4,$5,null)",[id(n),org,id(leadId),when,value]);
before(async()=>{
  admin=new Client({host:'127.0.0.1',port,database:'postgres'}); await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  db=new Client({host:'127.0.0.1',port,database});await db.connect();
  await db.query(sql('tests/fixtures/client-portfolio-schema.sql'));
  await db.query(sql('supabase/migrations/20271018000000_lead_relacao_ganho_perdido.sql'));
  await db.query(sql('supabase/migrations/20271019000004_leads_cafe_jurere_cadastro_erp.sql'));
  const visibility=sql('supabase/migrations/20271019000006_cafe_jurere_visibility_cache.sql').match(/CREATE OR REPLACE FUNCTION public\.visivel_lista_cafe_jurere[\s\S]*?\$\$;/)?.[0];
  assert.ok(visibility);await db.query(visibility);
  await db.query(sql(migration));
  dates=(await db.query("SELECT now()::text AS now, ((now() AT TIME ZONE 'UTC')::date-33)::text AS last, ((now() AT TIME ZONE 'UTC')::date-61)::text AS previous, date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS month")).rows[0];
});
beforeEach(async()=>{
  await root();await db.query('TRUNCATE organizations,leads,deals,pipelines,pipeline_stages,pipeline_entries,sale_events,upsell_clients,upsell_orders');
  await db.query('INSERT INTO organizations(id) VALUES($1),($2)',[id(1),id(2)]);
});
after(async()=>{if(db)await db.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS ${database}`);await admin.end();}});
test('agregados e filtros cobrem clientes além da página 1',async()=>{
  for(let n=100;n<161;n++){await lead(n);await sale(n+20000,n,dates.now,n===160?900:10);}
  await db.query("INSERT INTO upsell_clients VALUES($1,$2,$3,'ouro')",[id(500),id(1),id(160)]);
  await login();const first=await page({},50);const second=await page({},50,50);
  assert.equal(first.total,61);assert.equal(first.clients.length,50);assert.equal(second.clients.length,11);
  assert.equal(first.summary.monthlyRevenue,1500);assert.deepEqual(first.summary,second.summary);
  assert.equal(new Set([...first.clients,...second.clients].map(c=>c.id)).size,61);
  const gold=await page({segment:'ouro'});assert.equal(gold.total,1);assert.equal(gold.clients[0].id,id(160));assert.equal(gold.summary.monthlyRevenue,900);
});
test('ciclo usa união de datas e total não soma CRM + Carteira; estorno não conta',async()=>{
  await lead(100);await sale(1000,100,dates.previous,100);await sale(1001,100,dates.last,200);await sale(1002,100,dates.now,999);
  await db.query("INSERT INTO sale_events VALUES($1,$2,$3,'sale_reversed',$4,-999,$5)",[id(1003),id(1),id(100),dates.now,id(1002)]);
  await db.query("INSERT INTO upsell_clients VALUES($1,$2,$3,'ouro')",[id(500),id(1),id(100)]);
  await db.query("INSERT INTO upsell_orders VALUES($1,$2,$3,'approved',$4,200),($5,$2,$3,'rejected',$6,999)",[id(600),id(1),id(500),dates.last,id(601),dates.now]);
  await login();const result=await page({reorder:'late'});const c=result.clients[0];
  assert.equal(c.cycle.compras,2);assert.equal(c.cycle.mediaDias,28);assert.equal(c.cycle.diasRestantes,-5);assert.equal(c.metrics.lifetimeValue,300);assert.equal(c.metrics.orderCount,2);assert.equal(result.summary.overdueCount,1);
  assert.equal((await page({reorder:'soon'})).total,0);
});
test('zero/uma compra não fabrica previsão e ERP mantém cliente sem venda',async()=>{
  await lead(100);await lead(101);await sale(1001,101,dates.now);
  await db.query("INSERT INTO leads(id,organization_id,name,classificacao) VALUES($1,$2,'Cadastro ERP','cliente')",[id(102),id(1)]);
  await login();let result=await page({reorder:'unknown'});assert.equal(result.total,2);assert.ok(result.clients.every(c=>c.nextPurchaseAt===null));
  result=await page({source:'erp'});assert.equal(result.total,1);assert.equal(result.clients[0].cycle.compras,0);assert.equal(result.summary.monthlyRevenue,0);
});
test('RLS isola tenant e atribuição também nos agregados',async()=>{
  await lead(100);await lead(101);await lead(102,id(2));await sale(1000,100,dates.now,10);await sale(1001,101,dates.now,500);await sale(1002,102,dates.now,9999,id(2));
  await db.query('UPDATE leads SET sale_responsible_id=$1 WHERE id=$2',[id(902),id(101)]);
  await login(id(1),false);const result=await page();assert.equal(result.total,1);assert.equal(result.summary.monthlyRevenue,10);
  const other=await page({},50,0,id(2));assert.equal(other.total,0);assert.equal(other.summary.monthlyRevenue,0);
  await login();assert.equal((await page()).total,2);
});
test('anônimo e JWT ausente não executam; filtros inválidos não passam',async()=>{
  await db.query('SET ROLE anon');await assert.rejects(page(),e=>e.code==='42501');
  await login();await db.query("SELECT set_config('request.jwt.claim.sub','',false)");await assert.rejects(page(),e=>e.code==='42501');
  await login();for(const filters of [{segment:'admin'},{sort:'name; DROP TABLE leads'},{responsible:'not-a-uuid'},{organization_id:id(2)}])await assert.rejects(page(filters),e=>e.code==='22023');
  await assert.rejects(page({},101),e=>e.code==='22023');await assert.rejects(page({},50,-1),e=>e.code==='22023');
});
test('busca literal, telefone, origem, dono e qualificação filtram antes da paginação',async()=>{
  await lead(100,id(1),'Loja 100%');await lead(101,id(1),'Loja 1000');
  await db.query("UPDATE leads SET normalized_phone='551199998877',origin='site',qualification_tier='ouro',pre_sale_responsible_id=$1 WHERE id=$2",[id(902),id(100)]);
  await login();assert.equal((await page({search:'100%'})).total,1);assert.equal((await page({search:'(11) 9999-8877'})).total,1);
  assert.equal((await page({responsible:id(902)})).total,0);assert.equal((await page({responsible:id(901),origin:'site',qualification:'ouro'})).total,1);
});
test('receita respeita fronteira mensal da organização e ignora pedido sem ledger',async()=>{
  await lead(100);const before=new Date(new Date(dates.month).getTime()-1).toISOString();const at=new Date(dates.month).toISOString();
  await sale(1000,100,before,999);await sale(1001,100,at,125);
  await db.query("INSERT INTO upsell_clients VALUES($1,$2,$3,'prata')",[id(500),id(1),id(100)]);
  await db.query("INSERT INTO upsell_orders VALUES($1,$2,$3,'approved',$4,8000)",[id(600),id(1),id(500),dates.now]);
  await login();assert.equal((await page()).summary.monthlyRevenue,125);
});
test('cadastro Café Jurerê preserva filtro de visibilidade canônico',async()=>{
  const cafe='4922638c-4909-494e-ba10-12282ec0b161';await db.query('INSERT INTO organizations(id) VALUES($1)',[cafe]);
  for(let n=100;n<103;n++)await lead(n,cafe);
  await db.query("UPDATE leads SET erp_code='ERP-'||id::text WHERE id IN ($1,$2)",[id(100),id(101)]);
  await db.query('UPDATE leads SET cafe_jurere_erp_elegivel=false WHERE id=$1',[id(101)]);
  await login(cafe);const result=await page({source:'cafe'},50,0,cafe);assert.equal(result.total,1);assert.equal(result.clients[0].id,id(100));
});
test('ganho sem posição em funil continua cliente enquanto outra negociação está aberta',async()=>{
  await lead(100);await db.query("INSERT INTO deals VALUES($1,$2,$3,'open',null)",[id(11000),id(1),id(100)]);
  await login();assert.equal((await page()).total,1);
});
test('exclui lead na lixeira e shadow',async()=>{
  await lead(100);await lead(101);await db.query('UPDATE leads SET deleted_at=now() WHERE id=$1',[id(100)]);await db.query('UPDATE leads SET is_shadow=true WHERE id=$1',[id(101)]);
  await login();assert.equal((await page()).total,0);
});
test('plano e tempo com 10 mil clientes; payload permanece paginado',async()=>{
  await db.query("INSERT INTO leads(id,organization_id,name,classificacao) SELECT md5(n::text)::uuid,$1,'Cliente '||n,'cliente' FROM generate_series(1,10000)n",[id(1)]);
  await db.query("INSERT INTO upsell_clients(id,organization_id,lead_id,segment) SELECT md5('account'||n)::uuid,$1,md5(n::text)::uuid,CASE WHEN n%2=0 THEN 'ouro' ELSE 'prata' END FROM generate_series(1,10000)n",[id(1)]);
  await db.query("INSERT INTO upsell_orders(id,organization_id,client_id,approval_status,sold_at,sale_value) SELECT md5('order'||n||'-'||k)::uuid,$1,md5('account'||n)::uuid,'approved',now()-(k*28)*interval '1 day',100 FROM generate_series(1,10000)n CROSS JOIN generate_series(1,2)k",[id(1)]);
  await db.query("INSERT INTO sale_events(id,organization_id,lead_id,event_type,sold_at,sale_value) SELECT md5('sale'||n||'-'||k)::uuid,$1,md5(n::text)::uuid,'sale',now()-(k*28)*interval '1 day',100 FROM generate_series(1,10000)n CROSS JOIN generate_series(1,2)k",[id(1)]);
  await db.query('ANALYZE');await login();const start=performance.now();const result=await page({source:'erp'});const elapsed=performance.now()-start;
  assert.equal(result.total,10000);assert.equal(result.clients.length,50);assert.equal(result.clients[0].cycle.compras,2);assert.equal(result.clients[0].metrics.lifetimeValue,200);assert.ok(elapsed<5000,`consulta levou ${elapsed}ms`);
  const relationshipStart=performance.now();const relationship=await page();const relationshipMs=performance.now()-relationshipStart;
  assert.equal(relationship.total,10000);assert.ok(relationshipMs<5000,`relação levou ${relationshipMs}ms`);
  const plan=await db.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT public.client_portfolio_page($1,'{\"source\":\"erp\"}'::jsonb,50,0)",[id(1)]);
  console.log(JSON.stringify({clients:10000,elapsedMs:Math.round(elapsed),relationshipMs:Math.round(relationshipMs),explainExecutionMs:plan.rows[0]['QUERY PLAN'][0]['Execution Time']}));
});
test('previsão hoje, próxima semana e no ciclo; planner restaurado ao sair',async()=>{
  for (const [n, days] of [[100,28],[101,25],[102,10]]) {
    await lead(n);
    const last = new Date(Date.now()-days*86400000).toISOString();
    const previous = new Date(Date.now()-(days+28)*86400000).toISOString();
    await sale(n+1000,n,last);await sale(n+2000,n,previous);
  }
  await login();
  const before=(await db.query('SHOW enable_nestloop')).rows[0].enable_nestloop;
  const soon=await page({reorder:'soon',sort:'name',direction:'asc'});
  assert.equal(soon.total,2);assert.equal(soon.summary.expectedCount,2);
  assert.deepEqual(soon.clients.map(c=>c.cycle.diasRestantes),[0,3]);
  assert.equal((await page({reorder:'on-time'})).clients[0].cycle.diasRestantes,18);
  assert.equal((await db.query('SHOW enable_nestloop')).rows[0].enable_nestloop,before);
});
test('classificação em lote coincide com relacao_negocios em ganhos, perdas, legado e exclusões',async()=>{
  for(let n=100;n<110;n++)await lead(n);
  await db.query('DELETE FROM deals');
  await db.query("INSERT INTO pipelines VALUES($1,$2,true),($3,$2,false)",[id(500),id(1),id(501)]);
  await db.query("INSERT INTO pipeline_stages VALUES($1,$2,$3,'ganho','won',true),($4,$2,$3,'perda','lost',true)",[id(510),id(1),id(500),id(511)]);
  for(const [n,outcome,deleted] of [[100,'won',false],[101,'lost',false],[102,'open',false],[103,'won',true]]) {
    await db.query('INSERT INTO deals VALUES($1,$2,$3,$4,$5)',[id(n+10000),id(1),id(n),outcome,deleted?dates.now:null]);
  }
  for(const [n,pipeline,dealId] of [[102,500,10102],[103,500,10103],[104,500,null],[105,501,null]]) {
    await db.query("INSERT INTO pipeline_entries VALUES($1,$2,$3,$4,$5,'ganho')",[id(n+20000),id(1),id(pipeline),id(n),dealId?id(dealId):null]);
  }
  await sale(30000,106,dates.now);await sale(30001,107,dates.now);
  await db.query("INSERT INTO sale_events VALUES($1,$2,$3,'sale_reversed',$4,-100,$5)",[id(30002),id(1),id(107),dates.now,id(30001)]);
  await login();
  const canonical=await db.query("SELECT id FROM leads l WHERE relacao_negocios(l)='cliente' ORDER BY id");
  assert.deepEqual((await page()).clients.map(c=>c.id).sort(),canonical.rows.map(c=>c.id));
  assert.deepEqual(canonical.rows.map(c=>c.id),[id(100),id(104),id(106)]);
});
test('rollback remove apenas a nova RPC; reaplicação funciona',async()=>{
  await root();await db.query(sql('supabase/migrations/rollback/20271021000014_client_portfolio_page.sql'));
  assert.equal((await db.query("SELECT to_regprocedure('public.client_portfolio_page(uuid,jsonb,integer,integer)') AS fn")).rows[0].fn,null);
  await db.query(sql(migration));await login();assert.equal((await page()).total,0);
});
