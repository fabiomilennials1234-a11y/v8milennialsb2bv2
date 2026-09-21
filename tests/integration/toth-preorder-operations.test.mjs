import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { processTothPreorder } from "../../supabase/functions/_shared/erp/toth-preorders/engine.ts";
import { createTothPreorderStore } from "../../supabase/functions/_shared/erp/toth-preorders/repository.ts";
const org="4922638c-4909-494e-ba10-12282ec0b161";
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const file=(path)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
let db;
const result=async(sql,params=[]) => (await db.query(sql,params)).rows[0]?.result;
const as=async(role="authenticated",user=id(1))=>{await db.exec("RESET ROLE");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec(`SET ROLE ${role}`);};
const owner=async(sql)=>{await db.exec("RESET ROLE");await db.exec(sql);await as();};
const ready=()=>owner("CREATE OR REPLACE FUNCTION toth_order_private.preorder_runtime_ready() RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT true $$;");
const rpc=(name,args)=>result(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) result`,args);
const workspace=()=>rpc("toth_preorder_workspace",[id(40)]);
const request=()=>rpc("toth_request_order_send",[id(40),1]);
const claim=(op)=>rpc("toth_claim_preorder_operation",[op.id]);
const sending=(op)=>rpc("toth_mark_preorder_sending",[op.id,op.lease_token]);
const reconcile=(op)=>rpc("toth_reconcile_preorder_operation",[op.id,op.lease_token]);
const release=(op)=>rpc("toth_release_preorder_operation",[op.id,op.lease_token]);
const observe=(op,patch={})=>rpc("toth_record_preorder_observation",[op.id,op.lease_token,JSON.stringify({operation_id:op.id,external_id:"PRE-001",status:"pending",source:"authoritative_lookup",source_marker:"v1",source_order:1,approved_total:null,...patch})]);
const gain=(op,patch={})=>observe(op,{status:"approved",source_marker:"v2",source_order:2,approved_total:150,...patch});
const setup=async()=>{await ready();const w=await request();await as("service_role","");return sending(await claim(w.operation));};
const business=async()=>{await db.exec("RESET ROLE");return result("select jsonb_build_object('deal',(select to_jsonb(d) from deals d where id=$1),'sales',(select coalesce(jsonb_agg(s),'[]') from sale_events s),'orders',(select coalesce(jsonb_agg(o),'[]') from upsell_orders o),'adjustments',(select coalesce(jsonb_agg(a),'[]') from deal_order_adjustments a),'items',(select coalesce(jsonb_agg(i),'[]') from deal_items i)) result",[id(40)]);};
const stage=(from,to)=>db.query("INSERT INTO pipeline_stage_events(organization_id,entry_id,pipeline_id,from_stage_key,to_stage_key,lead_id,actor) VALUES($1,$2,$3,$4,$5,$6,$7)",[org,id(41),id(42),from,to,id(30),id(1)]);
const adjust=async(value,items=null)=>rpc("ajustar_pedido_ganho",[id(40),await result("SELECT updated_at result FROM deals WHERE id=$1",[id(40)]),value,items===null?null:JSON.stringify(items),"Ajuste de composição"]);
const legacyInsert=(external="PRE-001")=>db.query("insert into upsell_orders(organization_id,client_id,product_name,product_type,sale_value,external_source,external_id,source,approval_status) values($1,$2,'Legado','unitario',150,'toth',$3,'erp','approved')",[org,id(50),external]);

before(async()=>{
  db=new PGlite();
  await db.exec(file("tests/fixtures/historical-sales-schema.sql"));
  await db.exec(`CREATE ROLE service_role BYPASSRLS;
    ALTER TABLE organizations ADD feature_flags jsonb DEFAULT '{}';
    ALTER TABLE team_members ADD name text DEFAULT 'Usuário';
    ALTER TABLE leads ADD erp_code text,ADD closer_id uuid,ADD responsible_id uuid;
    ALTER TABLE pipeline_entries ADD organization_id uuid,ADD deal_id uuid,ADD lead_id uuid,ADD pipeline_id uuid,
      ADD stage_key text,ADD metadata jsonb DEFAULT '{}',ADD closed_at timestamptz,ADD entered_at timestamptz DEFAULT now();
    CREATE UNIQUE INDEX fixture_external_order ON upsell_orders(organization_id,external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
    ALTER FUNCTION get_my_organization_ids() SET search_path=public;
    ALTER FUNCTION can_link_or_read_lead(uuid,uuid) SET search_path=public;
    ALTER FUNCTION recalc_order_fixture() SET search_path=public;
    ALTER FUNCTION assert_org_member(uuid) SET search_path=public;
    CREATE FUNCTION assert_org_access(p_org_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ BEGIN PERFORM public.assert_org_member(p_org_id); END $$;
    CREATE TABLE deal_items(id uuid PRIMARY KEY,organization_id uuid,deal_id uuid REFERENCES deals(id),product_name text,
      quantity numeric NOT NULL CHECK(quantity>0),unit_price numeric NOT NULL CHECK(unit_price>=0),discount_percent numeric NOT NULL CHECK(discount_percent BETWEEN 0 AND 100),
      total numeric GENERATED ALWAYS AS(quantity*unit_price*(1-discount_percent/100)) STORED);
    CREATE FUNCTION carteira_erp_source(uuid,uuid,text,text) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN $3 IS NOT NULL THEN 'tiny' WHEN $4 IN('omie','tiny') THEN $4 END $$;
    CREATE TYPE stage_role AS ENUM('open','won','lost');
    CREATE FUNCTION metric_stage_role(uuid,uuid,text) RETURNS stage_role LANGUAGE sql AS $$ SELECT(CASE $3 WHEN 'ganho' THEN 'won' WHEN 'perdido' THEN 'lost' ELSE 'open' END)::public.stage_role $$;
    CREATE TABLE pipeline_stage_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,entry_id uuid,pipeline_id uuid,
      from_pipeline_id uuid,from_stage_key text,to_stage_key text,lead_id uuid,actor uuid);
    CREATE OR REPLACE FUNCTION can_link_or_read_lead(p_lead_id uuid,p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.leads l JOIN public.team_members m ON m.organization_id=l.organization_id
      WHERE l.id=p_lead_id AND l.organization_id=p_org AND l.deleted_at IS NULL AND m.user_id=auth.uid() AND m.is_active
      AND (m.role='admin' OR l.sale_responsible_id=m.id)) $$;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
  `);
  // Use the actual canonical functions, not a test reimplementation. Current
  // production definitions were independently read with pg_get_functiondef.
  const outcome=file("supabase/migrations/20270904000000_desfecho_do_negocio.sql");
  const ledger=file("supabase/migrations/20270908001010_caderno_aceita_quem_decidiu.sql");
  const extract=(sql,name)=>{const match=sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$([a-zA-Z_]*)\\$([\\s\\S]*?)\\$\\1\\$\\s*;`));assert.ok(match,name);return match[0];};
  await db.exec(extract(outcome,"fn_deals_espelha_outcome"));
  await db.exec(extract(outcome,"fn_deal_outcome_para_caderno"));
  await db.exec(extract(ledger,"_registrar_desfecho_no_caderno"));
  await db.exec(file("tests/fixtures/won-order-admission.sql"));
  const itemSync=file("supabase/migrations/20260101000000_baseline_prod_schema.sql").match(/CREATE OR REPLACE FUNCTION "public"\."fn_sync_deal_value_from_items"\(\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(itemSync);await db.exec(itemSync);
  await db.exec("CREATE TRIGGER item_total AFTER INSERT OR UPDATE OR DELETE ON deal_items FOR EACH ROW EXECUTE FUNCTION fn_sync_deal_value_from_items();");
  await db.exec(`CREATE TRIGGER mirror_outcome BEFORE UPDATE OF outcome ON deals FOR EACH ROW EXECUTE FUNCTION fn_deals_espelha_outcome();
    CREATE TRIGGER capture_outcome AFTER UPDATE OF outcome ON deals FOR EACH ROW EXECUTE FUNCTION fn_deal_outcome_para_caderno();`);
  await db.exec(file("supabase/migrations/20271021000006_ajustar_pedido_ganho.sql"));
  await db.exec(extract(file("supabase/migrations/20271019000007_deal_transfer_history.sql"),"fn_capture_sale_event"));
  await db.exec("CREATE TRIGGER capture_stage AFTER INSERT ON pipeline_stage_events FOR EACH ROW EXECUTE FUNCTION fn_capture_sale_event();");
  await db.exec(file("supabase/migrations/20271021000016_toth_order_drafts.sql"));
  await db.exec(file("supabase/migrations/20271021000021_toth_preorder_operations.sql"));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec(`RESET ROLE; TRUNCATE toth_preorder_audit,toth_preorder_operations,toth_order_draft_audit,toth_order_drafts,toth_order_preparers,toth_order_catalog_items,
    deal_order_adjustments,deal_items,pipeline_stage_events,sale_events,upsell_orders,upsell_clients,pipeline_entries,deals,leads,team_members,organizations,auth.users CASCADE;
    CREATE OR REPLACE FUNCTION toth_order_private.preorder_runtime_ready() RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT false $$;
    INSERT INTO auth.users VALUES('${id(1)}'),('${id(2)}'),('${id(3)}');
    INSERT INTO organizations(id,feature_flags,carteira_emits_revenue_enabled) VALUES('${org}','{"toth_order_drafts":true}',false),('${id(20)}','{}',false);
    INSERT INTO team_members(id,user_id,organization_id,name,role) VALUES('${id(11)}','${id(1)}','${org}','Admin','admin'),('${id(12)}','${id(2)}','${org}','Member','member'),('${id(13)}','${id(3)}','${id(20)}','Other','admin');
    INSERT INTO leads(id,organization_id,name,sale_responsible_id) VALUES('${id(30)}','${org}','Cliente','${id(12)}');
    INSERT INTO deals(id,organization_id,title,value,source_lead_id,source,created_by,currency) VALUES('${id(40)}','${org}','Negócio',100,'${id(30)}','human','${id(1)}','BRL');
    INSERT INTO pipeline_entries(id,organization_id,deal_id,lead_id,pipeline_id,stage_key) VALUES('${id(41)}','${org}','${id(40)}','${id(30)}','${id(42)}','proposta');
    INSERT INTO upsell_clients(id,organization_id,lead_id,name,external_source,external_id) VALUES('${id(50)}','${org}','${id(30)}','Cliente','toth','CLIENT-01');
    INSERT INTO toth_order_catalog_items(organization_id,product_external_id,description) VALUES('${org}','CAFE-01','Café');`);
  await as();
  await rpc("toth_save_order_draft",[id(40),0,JSON.stringify([{product_external_id:"CAFE-01",quantity:2}]),"Pedido"]);
  await rpc("toth_review_order_draft",[id(40),1]);
});

test("sealed runtime refuses sending even with feature flag, admin and reviewed draft",async()=>{
  assert.equal((await workspace()).can_send,false);
  await assert.rejects(request(),/toth_write_contract_unverified/);
  await db.exec("RESET ROLE");
  assert.equal(await result("select count(*)::int result from toth_preorder_operations"),0);
});
test("queued operation freezes exact reviewed snapshot; duplicate request cannot create another",async()=>{
  await ready();const first=await request();const second=await request();assert.equal(first.operation.id,second.operation.id);
  await assert.rejects(rpc("toth_save_order_draft",[id(40),1,"[]","changed"]),/toth_draft_already_submitted/);
  assert.equal("request_snapshot" in first.operation,false);assert.equal("lease_token" in first.operation,false);
  await as("service_role","");const op=await claim(first.operation);
  assert.equal(op.request_snapshot.revision,1);assert.equal(op.request_snapshot.deal_value,100);assert.equal(op.request_snapshot.customer_external_id,"CLIENT-01");
  assert.deepEqual(op.request_snapshot.items,[{product_external_id:"CAFE-01",quantity:2}]);
});
test("service leases exclude concurrent workers and recovered sending never becomes queued",async()=>{
  await ready();const w=await request();await as("service_role","");const leased=await claim(w.operation);assert.equal(await claim(w.operation),null);
  await sending(leased);await db.exec("RESET ROLE");await db.query("update toth_preorder_operations set lease_expires_at=now()-interval '1 second' where id=$1",[leased.id]);
  await as("service_role","");const recovered=await claim(leased);assert.equal(recovered.delivery_state,"sending");assert.notEqual(recovered.lease_token,leased.lease_token);
  await assert.rejects(observe(leased),/toth_lease_lost/);await assert.rejects(sending(recovered),/toth_operation_already_dispatched/);
});
test("first send revalidates administrator before remote I/O",async()=>{
  await ready();const w=await request();await owner(`UPDATE team_members SET role='member' WHERE id='${id(11)}'`);await as("service_role","");
  const blocked=await sending(await claim(w.operation));assert.equal(blocked.last_error_code,"toth_sender_access_revoked");
});
test("first send is blocked when draft rollout is disabled or catalog became inactive",async()=>{
  await ready();const w=await request();await owner("UPDATE organizations SET feature_flags='{}'");await as("service_role","");
  assert.equal((await sending(await claim(w.operation))).last_error_code,"toth_sender_access_revoked");
});
test("inactive catalog after local review blocks workspace and queue",async()=>{
  await ready();await owner("UPDATE toth_order_catalog_items SET active=false");
  const w=await workspace();assert.equal(w.can_send,false);assert.ok(w.blockers.includes("catalog_item_unavailable"));
  await assert.rejects(request(),/toth_catalog_item_unavailable/);
});

test("queue refuses a missing pipeline or incompatible Carteira revenue mode",async()=>{
  await ready();await owner("DELETE FROM pipeline_entries");
  assert.ok((await workspace()).blockers.includes("local_projection_unavailable"));
  await assert.rejects(request(),/toth_local_projection_unavailable/);
  await owner(`INSERT INTO pipeline_entries(id,organization_id,deal_id,lead_id,pipeline_id,stage_key)
    VALUES('${id(41)}','${org}','${id(40)}','${id(30)}','${id(42)}','proposta');
    UPDATE organizations SET carteira_emits_revenue_enabled=true WHERE id='${org}';`);
  assert.equal((await workspace()).can_send,false);
  await assert.rejects(request(),/toth_local_projection_unavailable/);
  await db.exec("RESET ROLE");assert.equal(await result("SELECT count(*)::int result FROM toth_preorder_operations"),0);
});

for(const [condition,change] of [["missing pipeline","DELETE FROM pipeline_entries"],["Carteira revenue mode",`UPDATE organizations SET carteira_emits_revenue_enabled=true WHERE id='${org}'`]]) {
  test(`first send revalidates projection after ${condition} changes`,async()=>{
    await ready();const queued=await request();await owner(change);await as("service_role","");
    const blocked=await sending(await claim(queued.operation));
    assert.equal(blocked.delivery_state,"blocked");assert.equal(blocked.last_error_code,"toth_local_projection_unavailable");
    assert.equal((await business()).sales.length,0);
  });
}
test("deal changed after queue is blocked before first remote send",async()=>{
  await ready();const w=await request();await owner("UPDATE deals SET outcome='lost',currency='USD',value=120");await as("service_role","");
  const blocked=await sending(await claim(w.operation));assert.equal(blocked.delivery_state,"blocked");assert.equal(blocked.last_error_code,"toth_deal_changed");
});
test("malformed observations and invalid approved totals cannot grant approval",async()=>{
  const op=await setup();
  for(const patch of [{source_marker:123},{source_marker:" v1 "},{source:"authoritative_create",status:"rejected"},{source_order:1.1},{source_order:-1},{source_order:9007199254740992},{external_id:123},{status:null},{approved_total:10}]) {
    await assert.rejects(observe(op,patch),/toth_invalid_observation|toth_invalid_approved_total/);
  }
  for(const total of [0,-1,1.001,10000000000])await assert.rejects(gain(op,{approved_total:total}),/toth_invalid_approved_total/);
  assert.equal((await business()).sales.length,0);
});
test("receipt and pending analysis never create sale, gain or local ERP order",async()=>{
  const op=await setup();const got=await observe(op,{source:"authoritative_create"});assert.equal(got.delivery_state,"received");assert.equal(got.commercial_state,"pending");
  await assert.rejects(reconcile(got),/toth_approval_not_confirmed/);const b=await business();assert.equal(b.deal.outcome,"open");assert.equal(b.sales.length,0);assert.equal(b.orders.length,0);
});
test("create response cannot be mistaken for commercial approval",async()=>{
  const op=await setup();await assert.rejects(gain(op,{source:"authoritative_create"}),/toth_approval_requires_authoritative_lookup/);
  const b=await business();assert.equal(b.deal.outcome,"open");assert.equal(b.sales.length,0);
});
test("manual, stage and workflow gain cannot bypass unknown or pending ERP approval",async()=>{
  const op=await setup();
  for(const status of ["unknown","pending"]){
    if(status==="pending"){await as("service_role","");await observe(op);}
    await db.exec("RESET ROLE");
    for(const source of ["ui","stage","workflow"])await assert.rejects(db.query("UPDATE deals SET outcome='won',value=150,outcome_source=$1 WHERE id=$2",[source,id(40)]),/toth_approval_required_for_gain/);
  }
  const b=await business();assert.equal(b.deal.outcome,"open");assert.equal(b.sales.length,0);assert.equal(b.orders.length,0);
});
test("commercial rejection blocks manual gain without creating a sale",async()=>{
  const op=await setup();await observe(op,{status:"rejected"});await db.exec("RESET ROLE");
  await assert.rejects(db.exec("UPDATE deals SET outcome='won',value=150"),/toth_approval_required_for_gain/);
  assert.equal((await business()).sales.length,0);
});
test("approved owned deal requires exact total and lead for gain from any path",async()=>{
  const op=await setup();await gain(op);await db.exec("RESET ROLE");
  await assert.rejects(db.exec("UPDATE deals SET outcome='won',value=151"),/toth_approval_required_for_gain/);
  await assert.rejects(db.exec("UPDATE deals SET outcome='won',value=150,currency='USD'"),/toth_approval_required_for_gain/);
  await db.exec("UPDATE deals SET outcome='won',value=150,outcome_source='ui'");
  await as("service_role","");assert.equal((await reconcile(op)).reconciliation_state,"complete");assert.equal((await business()).sales.length,1);
});

test("approved owned deal cannot change its customer or currency after reconciliation",async()=>{
  const op=await setup();await gain(op);await reconcile(op);await db.exec("RESET ROLE");
  await db.exec(`INSERT INTO leads(id,organization_id,name) VALUES('${id(31)}','${org}','Outro cliente');`);
  const before=await business();
  await assert.rejects(db.exec("UPDATE deals SET currency='USD'"),/toth_owned_order_manual_change_blocked/);
  await assert.rejects(db.exec(`UPDATE deals SET source_lead_id='${id(31)}'`),/toth_owned_order_manual_change_blocked/);
  assert.deepEqual(await business(),before);
});

test("ordinary won deal without preorder preserves customer and currency editing",async()=>{
  await db.exec("RESET ROLE");
  await db.exec(`INSERT INTO leads(id,organization_id,name) VALUES('${id(31)}','${org}','Outro cliente');
    UPDATE deals SET outcome='won',value=150,outcome_source='ui';
    UPDATE deals SET currency='USD',source_lead_id='${id(31)}';`);
  const b=await business();
  assert.equal(b.deal.currency,"USD");assert.equal(b.deal.source_lead_id,id(31));
});

test("real stage capture cannot create a sale before approval and accepts exact approved gain",async()=>{
  const op=await setup();await db.exec("RESET ROLE");
  await assert.rejects(stage("proposta","ganho"),/toth_approval_required_for_gain/);
  assert.equal(await result("SELECT count(*)::int result FROM pipeline_stage_events"),0);
  assert.equal((await business()).sales.length,0);
  await as("service_role","");await gain(op);await db.exec("RESET ROLE");
  await db.exec("UPDATE deals SET value=150");await stage("proposta","ganho");
  assert.equal((await business()).sales.length,1);
  await as("service_role","");assert.equal((await reconcile(op)).reconciliation_state,"complete");
});

test("canonical ledger rejects conflicting pipeline currency on approved manual gain",async()=>{
  const op=await setup();await gain(op);await db.exec("RESET ROLE");
  await db.exec(`UPDATE pipeline_entries SET metadata='{"currency":"USD"}'; UPDATE deals SET value=150;`);
  const before=await business();
  await assert.rejects(stage("proposta","ganho"),/toth_approval_required_for_gain/);
  assert.deepEqual(await business(),before);
});

test("approved owned order refuses value edits, reopening and real won-order adjustment without effects",async()=>{
  const op=await setup();await gain(op);await reconcile(op);const before=await business();
  await assert.rejects(db.exec("UPDATE deals SET value=160"),/toth_owned_order_manual_change_blocked/);
  await assert.rejects(db.exec("UPDATE deals SET outcome='open'"),/toth_owned_order_manual_change_blocked/);
  await assert.rejects(stage("ganho","proposta"),/toth_owned_order_manual_change_blocked/);
  await as();await assert.rejects(adjust(160),/toth_owned_order_manual_change_blocked/);
  assert.deepEqual(await business(),before);
});

test("real adjustment rolls back changed composition at equal approved total; pure no-op remains allowed",async()=>{
  const op=await setup();await gain(op);await reconcile(op);await db.exec("RESET ROLE");
  await db.query("INSERT INTO deal_items(id,organization_id,deal_id,product_name,quantity,unit_price,discount_percent) VALUES($1,$2,$3,'Café',1,150,0)",[id(60),org,id(40)]);
  const before=await business();await as();
  const original=[{id:id(60),quantity:1,unit_price:150,discount_percent:0}];
  assert.equal((await adjust(150,original)).changed,false);
  await assert.rejects(adjust(150,[{...original[0],quantity:2,unit_price:75}]),/toth_owned_order_manual_change_blocked/);
  assert.deepEqual(await business(),before);
});

test("canonical reversal writer cannot reverse an approved owned sale",async()=>{
  const op=await setup();await gain(op);await reconcile(op);const before=await business();
  await assert.rejects(db.query("SELECT public._registrar_desfecho_no_caderno($1,$2,$3,'proposta',NULL,$4,'won','open',$5,'ui')",[org,id(30),id(42),id(40),id(1)]),/toth_owned_order_manual_change_blocked/);
  assert.deepEqual(await business(),before);
});

test("canonical legacy writer cannot recognize an owned approval a second time",async()=>{
  const op=await setup();await gain(op);await reconcile(op);const before=await business();
  await assert.rejects(db.query("SELECT public._registrar_desfecho_no_caderno($1,$2,$3,'proposta',NULL,$4,'open','won',$5,'ui')",[org,id(30),id(42),id(40),id(1)]),/toth_existing_sale_conflict/);
  assert.deepEqual(await business(),before);
});

test("owned sale guards preserve ordinary approved sales in another organization",async()=>{
  const op=await setup();await gain(op);await reconcile(op);const before=await business();
  await db.exec(`INSERT INTO leads(id,organization_id,name) VALUES('${id(31)}','${id(20)}','Outro cliente');
    INSERT INTO upsell_clients(id,organization_id,lead_id,name) VALUES('${id(51)}','${id(20)}','${id(31)}','Outro cliente');
    INSERT INTO deals(id,organization_id,title,value,source_lead_id,source,created_by,currency)
      VALUES('${id(43)}','${id(20)}','Outro negócio',150,'${id(31)}','human','${id(3)}','BRL');
    INSERT INTO pipeline_entries(id,organization_id,deal_id,lead_id,pipeline_id,stage_key)
      VALUES('${id(44)}','${id(20)}','${id(43)}','${id(31)}','${id(45)}','proposta');
    UPDATE deals SET outcome='won',outcome_source='ui' WHERE id='${id(43)}';`);
  const after=await business();
  assert.deepEqual(after.sales.filter(s=>s.organization_id===org),before.sales);
  assert.deepEqual(after.orders.filter(o=>o.organization_id===org),before.orders);
  assert.equal(after.sales.filter(s=>s.organization_id===id(20)).length,1);
  assert.equal(after.orders.filter(o=>o.organization_id===id(20)).length,1);
});

test("ordinary won order without an operation keeps real adjustment and reopening behavior",async()=>{
  await db.exec("RESET ROLE");await db.exec("UPDATE deals SET outcome='won',value=150,outcome_source='ui'");await as();
  assert.equal((await adjust(160)).changed,true);const changed=await business();
  assert.equal(changed.deal.value,160);assert.equal(changed.sales.length,3);assert.equal(changed.adjustments.length,1);
  await stage("ganho","proposta");assert.equal((await business()).deal.outcome,"open");
});
test("authoritative approval reconciles through canonical gain once and preserves sole Carteira identity",async()=>{
  const op=await setup();await observe(op);const approved=await gain(op);const done=await reconcile(approved);assert.equal(done.reconciliation_state,"complete");
  await reconcile(done);await gain(done);await reconcile(done);
  const b=await business();assert.equal(b.deal.outcome,"won");assert.equal(Number(b.deal.value),150);assert.equal(b.sales.length,1);assert.equal(b.sales[0].producer,"funnel");
  assert.equal(b.orders.length,1);assert.equal(b.orders[0].external_source,"funnel_sale_event");assert.equal(b.orders[0].external_id,b.sales[0].id);
  await assert.rejects(legacyInsert(),/toth_preorder_owned_external_id/);
  await as("service_role","");assert.equal((await rpc("toth_find_owned_preorder",[org,"PRE-001"])).id,op.id);
  assert.equal(await rpc("toth_find_owned_preorder",[id(20),"PRE-001"]),null);
});
test("legacy import that wins before binding is preserved and blocks reconciliation",async()=>{
  const op=await setup();await db.exec("RESET ROLE");await legacyInsert();const original=await result("select to_jsonb(o) result from upsell_orders o");
  await as("service_role","");const blocked=await gain(op);assert.equal(blocked.last_error_code,"toth_existing_erp_order_conflict");assert.equal(blocked.external_id,null);
  await db.exec("RESET ROLE");assert.deepEqual(await result("select to_jsonb(o) result from upsell_orders o"),original);
  await db.exec("update upsell_orders set product_name='Correção permitida no legado'");assert.equal((await business()).deal.outcome,"open");
});
test("unowned Toth IDs keep normal legacy behavior",async()=>{
  await db.exec("RESET ROLE");await legacyInsert("HISTORY");await db.exec("update upsell_orders set product_name='Normal'");
  assert.equal(await result("select count(*)::int result from upsell_orders"),1);
});
test("lost response remains awaiting confirmation; lease recovery cannot resend",async()=>{
  const op=await setup();const uncertain=await rpc("toth_mark_preorder_uncertain",[op.id,op.lease_token,"toth_timeout"]);
  assert.equal(uncertain.delivery_state,"awaiting_confirmation");await release(uncertain);const recovered=await claim(uncertain);
  await assert.rejects(sending(recovered),/toth_operation_already_dispatched/);await observe(recovered);assert.equal((await business()).sales.length,0);
});
test("older observations ignored, conflicting same version blocks without overwriting business state",async()=>{
  const op=await setup();await gain(op);const older=await observe(op);assert.equal(older.commercial_state,"approved");
  const conflict=await gain(op,{source_marker:"different"});assert.equal(conflict.reconciliation_state,"blocked");assert.equal(conflict.last_error_code,"toth_observation_version_conflict");
  assert.equal((await business()).sales.length,0);
});
test("later status or total divergence blocks after gain without reversing or duplicating sale",async()=>{
  const op=await setup();await gain(op);await reconcile(op);const before=await business();await as("service_role","");
  const changed=await gain(op,{source_order:3,source_marker:"v3",approved_total:160});assert.equal(changed.last_error_code,"toth_approved_order_changed");assert.equal(changed.approved_total,150);
  assert.deepEqual(await business(),before);
});
test("received lookup errors preserve confirmed state and continue after send flag disabled",async()=>{
  const op=await setup();await gain(op);await reconcile(op);await owner("UPDATE organizations SET feature_flags='{}'");await as("service_role","");
  const uncertain=await rpc("toth_mark_preorder_uncertain",[op.id,op.lease_token,"toth_timeout"]);
  assert.equal(uncertain.delivery_state,"received");assert.equal(uncertain.commercial_state,"approved");assert.equal(uncertain.reconciliation_state,"complete");
  await release(uncertain);assert.equal((await claim(uncertain)).reconciliation_state,"complete");
});
test("commercial rejection and unknown never change deal outcome",async()=>{
  const op=await setup();const rejected=await observe(op,{status:"rejected"});assert.equal(rejected.commercial_state,"rejected");
  await assert.rejects(reconcile(rejected),/toth_approval_not_confirmed/);assert.equal((await business()).deal.outcome,"open");
});
test("failed local projection rolls back gain but retains approval for local-only retry",async()=>{
  const op=await setup();await gain(op);await db.exec("RESET ROLE");
  await db.exec("CREATE FUNCTION fixture_fail_gain() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fixture_fail_gain BEFORE INSERT ON sale_events FOR EACH ROW EXECUTE FUNCTION fixture_fail_gain();");
  await as("service_role","");const pending=await reconcile(op);assert.equal(pending.reconciliation_state,"pending");assert.equal(pending.commercial_state,"approved");
  assert.equal((await business()).deal.outcome,"open");await db.exec("DROP TRIGGER fixture_fail_gain ON sale_events; DROP FUNCTION fixture_fail_gain();");
  await as("service_role","");assert.equal((await reconcile(op)).reconciliation_state,"complete");assert.equal((await business()).sales.length,1);
});
test("already-won matching sale is reused; diverging totals never overwrite historical gain",async()=>{
  await db.exec("RESET ROLE");await db.exec("UPDATE deals SET outcome='won',value=150,outcome_source='ui'");await as();const op=await setup();await gain(op);const done=await reconcile(op);
  assert.equal(done.reconciliation_state,"complete");assert.equal((await business()).sales.length,1);
});

test("missing canonical Carteira projection cannot be reported as reconciled",async()=>{
  const op=await setup();await db.exec("RESET ROLE; DELETE FROM pipeline_entries;");
  await as("service_role","");await gain(op);
  const reconciled=await reconcile(op);
  assert.notEqual(reconciled.reconciliation_state,"complete");
  const b=await business();assert.equal(b.deal.outcome,"open");assert.equal(b.sales.length,0);assert.equal(b.orders.length,0);
});

test("Carteira mode changed after send cannot complete a gain without its order",async()=>{
  const op=await setup();await owner(`UPDATE organizations SET carteira_emits_revenue_enabled=true WHERE id='${org}'`);
  await as("service_role","");await gain(op);const reconciled=await reconcile(op);
  assert.equal(reconciled.reconciliation_state,"pending");
  const b=await business();assert.equal(b.deal.outcome,"open");assert.equal(b.sales.length,0);assert.equal(b.orders.length,0);
});

for(const [condition,change] of [["missing","DELETE FROM upsell_orders"],["different amount","UPDATE upsell_orders SET sale_value=99"]]) {
  test(`already-won sale with ${condition} Carteira projection is preserved and not reconciled`,async()=>{
    await owner("UPDATE deals SET outcome='won',value=150,outcome_source='ui'");
    await owner(change);const before=await business();await as();
    const op=await setup();await gain(op);const pending=await reconcile(op);
    assert.equal(pending.reconciliation_state,"pending");assert.equal(pending.last_error_code,"toth_local_projection_failed");
    assert.deepEqual(await business(),before);
  });
}
test("already-won different total becomes conflict without another sale",async()=>{
  await db.exec("RESET ROLE");await db.exec("UPDATE deals SET outcome='won',value=100,outcome_source='ui'");await as();const op=await setup();await gain(op);
  assert.equal((await reconcile(op)).last_error_code,"toth_existing_sale_conflict");const b=await business();assert.equal(Number(b.deal.value),100);assert.equal(b.sales.length,1);
});
test("editing the CRM deal while approval is pending blocks overwrite",async()=>{
  const op=await setup();await gain(op);await owner("UPDATE deals SET value=120");await as("service_role","");
  const blocked=await reconcile(op);assert.equal(blocked.last_error_code,"toth_deal_changed");assert.equal(blocked.reconciliation_state,"blocked");
  const b=await business();assert.equal(Number(b.deal.value),120);assert.equal(b.deal.outcome,"open");assert.equal(b.sales.length,0);
});
test("browser cannot claim, record approval, reconcile or directly alter operation origin",async()=>{
  const op=await setup();await as();
  for(const [name,args] of [["toth_claim_preorder_operation",[op.id]],["toth_mark_preorder_sending",[op.id,op.lease_token]],["toth_record_preorder_observation",[op.id,op.lease_token,"{}"]],
    ["toth_reconcile_preorder_operation",[op.id,op.lease_token]],["toth_find_owned_preorder",[org,"PRE-001"]]])await assert.rejects(rpc(name,args),/permission denied/);
  for(const role of ["authenticated","service_role"]){await as(role);for(const table of ["toth_preorder_operations","toth_preorder_audit"]){
    await assert.rejects(db.exec(`SELECT * FROM ${table}`),/permission denied/);await assert.rejects(db.exec(`UPDATE ${table} SET organization_id='${org}'`),/permission denied/);}}
  await db.exec("RESET ROLE");await assert.rejects(db.exec("UPDATE toth_preorder_operations SET request_snapshot='{}'"),/toth_operation_origin_immutable/);
});
test("cross-tenant browser and changed lead cannot read operation payload",async()=>{
  const op=await setup();await as("authenticated",id(3));await assert.rejects(workspace(),/toth_access_denied/);
  await owner(`INSERT INTO leads(id,organization_id,name,sale_responsible_id) VALUES('${id(31)}','${org}','Novo','${id(12)}');UPDATE deals SET source_lead_id='${id(31)}' WHERE id='${id(40)}';`);
  const w=await workspace();assert.equal(w.operation,null);assert.ok(w.blockers.includes("client_link_changed"));
  assert.equal(await rpc("toth_preorder_can_read",[op.id]),false);
});

// The production repository and decoder consume actual migration RPC output.
// Only the transport is replaced: all arguments still enter the real SQL RPCs.
const engineStore = () => createTothPreorderStore({
  async rpc(name, args) {
    const parameterNames = {
      toth_claim_preorder_operation: ["p_operation_id"],
      toth_mark_preorder_sending: ["p_operation_id", "p_lease_token"],
      toth_record_preorder_observation: ["p_operation_id", "p_lease_token", "p_observation"],
      toth_mark_preorder_uncertain: ["p_operation_id", "p_lease_token", "p_error_code"],
      toth_block_preorder_operation: ["p_operation_id", "p_lease_token", "p_error_code"],
      toth_reconcile_preorder_operation: ["p_operation_id", "p_lease_token"],
      toth_release_preorder_operation: ["p_operation_id", "p_lease_token"],
    }[name];
    assert.ok(parameterNames, `Unexpected service RPC: ${name}`);
    assert.deepEqual(Object.keys(args).sort(), [...parameterNames].sort());
    const values = parameterNames.map((key) => typeof args[key] === "object"
      ? JSON.stringify(args[key]) : args[key]);
    return { data: await rpc(name, values), error: null };
  },
});

const engineObservation = (operation, source, approved = false) => ({
  operation_id: operation.id,
  external_id: "ENGINE-PRE-001",
  status: approved ? "approved" : "pending",
  source,
  source_marker: approved ? "supplier-version-2" : "supplier-version-1",
  source_order: approved ? 2 : 1,
  approved_total: approved ? 150 : null,
});

test("SQL and real engine preserve Unicode identifier and notes boundaries without normalization", async () => {
  const customer = `\u00a0${"😀".repeat(126)}\u00a0`;
  const product = "😀".repeat(128);
  const notes = "😀".repeat(1000);
  const marker = "😀".repeat(256);
  await db.exec("RESET ROLE; TRUNCATE toth_order_draft_audit,toth_order_drafts CASCADE;");
  await db.query("UPDATE upsell_clients SET external_id=$1", [customer]);
  await db.query("UPDATE toth_order_catalog_items SET product_external_id=$1", [product]);
  await as();
  await rpc("toth_save_order_draft", [id(40), 0, JSON.stringify([{product_external_id:product,quantity:1}]), notes]);
  await rpc("toth_review_order_draft", [id(40), 1]);
  await ready();
  const queued = await request();
  await as("service_role", "");
  let creates = 0;
  const outcome = await processTothPreorder(queued.operation.id, {
    store: engineStore(), send_enabled: true,
    adapter: {
      can_create: true, can_lookup: true,
      async create(operation) {
        creates++;
        assert.equal(operation.request_snapshot.customer_external_id, customer);
        assert.equal(operation.request_snapshot.notes, notes);
        assert.deepEqual(operation.request_snapshot.items, [{product_external_id:product,quantity:1}]);
        return {...engineObservation(operation,"authoritative_create"), external_id:product, source_marker:marker};
      },
      async lookup() { throw new Error("A first submission must create once"); },
    },
  });
  assert.equal(outcome.disposition,"received");
  assert.equal(creates,1);
  await as();
  assert.equal((await workspace()).operation.external_id,product);
});

test("real engine and repository accept SQL snapshot; only authoritative lookup creates one canonical sale", async () => {
  await ready();
  const queued = await request();
  await as("service_role", "");
  const store = engineStore();
  let creates = 0;
  let lookups = 0;
  const adapter = {
    can_create: true,
    can_lookup: true,
    async create(operation) {
      creates++;
      assert.equal(operation.delivery_state, "sending");
      assert.equal(operation.id, queued.operation.id);
      assert.equal(operation.request_snapshot.schema_version, 1);
      assert.equal(operation.request_snapshot.deal_id, id(40));
      assert.equal(operation.request_snapshot.revision, 1);
      assert.equal(operation.request_snapshot.customer_external_id, "CLIENT-01");
      assert.deepEqual(operation.request_snapshot.items, [{ product_external_id: "CAFE-01", quantity: 2 }]);
      assert.equal(operation.request_snapshot.notes, "Pedido");
      return engineObservation(operation, "authoritative_create");
    },
    async lookup(operation) {
      lookups++;
      assert.equal(operation.external_id, "ENGINE-PRE-001");
      return engineObservation(operation, "authoritative_lookup", true);
    },
  };
  assert.equal((await processTothPreorder(queued.operation.id, { store, adapter, send_enabled: true })).disposition, "received");
  const pending = await business();
  assert.equal(pending.deal.outcome, "open");
  assert.equal(pending.sales.length, 0);
  assert.equal(pending.orders.length, 0);

  await as("service_role", "");
  assert.equal((await processTothPreorder(queued.operation.id, { store, adapter, send_enabled: false })).disposition, "reconciled");
  const approved = await business();
  assert.equal(approved.deal.outcome, "won");
  assert.equal(Number(approved.deal.value), 150);
  assert.equal(approved.sales.length, 1);
  assert.equal(approved.sales[0].producer, "funnel");
  assert.equal(approved.orders.length, 1);
  assert.equal(approved.orders[0].external_source, "funnel_sale_event");
  assert.equal(approved.orders[0].external_id, approved.sales[0].id);

  await as("service_role", "");
  assert.equal((await processTothPreorder(queued.operation.id, { store, adapter, send_enabled: false })).disposition, "received");
  assert.deepEqual(await business(), approved);
  assert.equal(creates, 1);
  assert.equal(lookups, 2);
});

test("real engine persists timeout and recovers through SQL plus lookup without another create", async () => {
  await ready();
  const queued = await request();
  await as("service_role", "");
  const store = engineStore();
  let creates = 0;
  let lookups = 0;
  const adapter = {
    can_create: true,
    can_lookup: true,
    async create() {
      creates++;
      throw new Error("Simulated response lost after supplier accepted the request");
    },
    async lookup(operation) {
      lookups++;
      assert.equal(operation.delivery_state, "awaiting_confirmation");
      assert.equal(operation.external_id, null);
      return engineObservation(operation, "authoritative_lookup", true);
    },
  };
  assert.deepEqual(await processTothPreorder(queued.operation.id, { store, adapter, send_enabled: true }), {
    operation_id: queued.operation.id,
    disposition: "awaiting_confirmation",
    reason_code: "create_result_uncertain",
  });
  await as();
  assert.equal((await workspace()).operation.delivery_state, "awaiting_confirmation");
  assert.equal((await business()).sales.length, 0);

  await as("service_role", "");
  assert.equal((await processTothPreorder(queued.operation.id, { store, adapter, send_enabled: false })).disposition, "reconciled");
  const approved = await business();
  assert.equal(approved.deal.outcome, "won");
  assert.equal(Number(approved.deal.value), 150);
  assert.equal(approved.sales.length, 1);
  assert.equal(approved.orders.length, 1);
  assert.equal(creates, 1);
  assert.equal(lookups, 1);
});
