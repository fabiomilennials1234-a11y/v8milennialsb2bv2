import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(
  process.env.WON_ORDER_PGLITE ?? "@electric-sql/pglite"
);
const sqlFile = (name) =>
  readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db;
const row = async (sql) => (await db.query(sql)).rows[0];
const adjust = async (
  value = 150,
  items = null,
  reason = "Cliente aumentou quantidade",
  version = "2026-09-01T12:00:00Z",
) =>
  db.query("select public.ajustar_pedido_ganho($1,$2,$3,$4,$5) as result", [
    id(4),
    version,
    value,
    items === null ? null : JSON.stringify(items),
    reason,
  ]);
before(async () => {
  db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(sqlFile("tests/fixtures/historical-sales-schema.sql"));
  await db.exec(`
    ALTER TABLE leads ADD closer_id uuid, ADD responsible_id uuid;
    ALTER TABLE pipeline_entries ADD deal_id uuid, ADD organization_id uuid, ADD metadata jsonb DEFAULT '{}';
    CREATE FUNCTION assert_org_access(p_org_id uuid) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$ BEGIN PERFORM public.assert_org_member(p_org_id); END $$;
    ALTER FUNCTION assert_org_member(uuid) SET search_path = public;
    ALTER FUNCTION get_my_organization_ids() SET search_path = public;
    ALTER FUNCTION can_link_or_read_lead(uuid,uuid) SET search_path = public;
    ALTER FUNCTION recalc_order_fixture() SET search_path = public;
    CREATE TABLE deal_items (id uuid PRIMARY KEY, organization_id uuid, deal_id uuid REFERENCES deals(id), product_name text,
      quantity numeric NOT NULL CHECK(quantity>0), unit_price numeric NOT NULL CHECK(unit_price>=0), discount_percent numeric NOT NULL CHECK(discount_percent BETWEEN 0 AND 100),
      total numeric GENERATED ALWAYS AS (quantity*unit_price*(1-discount_percent/100)) STORED);
    CREATE FUNCTION carteira_erp_source(uuid,uuid,text,text) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN $3 IS NOT NULL THEN 'tiny' WHEN $4 IN ('omie','tiny') THEN $4 END $$;
    CREATE UNIQUE INDEX uq_upsell_client ON upsell_clients(organization_id,lead_id);
    CREATE UNIQUE INDEX uq_upsell_order_external ON upsell_orders(organization_id,external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
    CREATE TRIGGER recalc_order_update AFTER UPDATE ON upsell_orders FOR EACH ROW EXECUTE FUNCTION recalc_order_fixture();
  `);
  // Real item-total trigger, extracted from the immutable production baseline.
  const baseline = sqlFile(
    "supabase/migrations/20260101000000_baseline_prod_schema.sql",
  );
  const sync = baseline.match(
    /CREATE OR REPLACE FUNCTION "public"\."fn_sync_deal_value_from_items"\(\)[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(sync, "production item-total trigger must exist");
  await db.exec(sync);
  await db.exec(
    "CREATE TRIGGER item_total AFTER INSERT OR UPDATE OR DELETE ON deal_items FOR EACH ROW EXECUTE FUNCTION fn_sync_deal_value_from_items();",
  );
  await db.exec(sqlFile("tests/fixtures/won-order-admission.sql"));
  await db.exec(
    "CREATE TRIGGER trg_carteira_admite_venda AFTER INSERT ON sale_events FOR EACH ROW WHEN (NEW.producer='funnel' AND NEW.event_type IN ('sale','sale_reversed')) EXECUTE FUNCTION fn_carteira_admite_venda();",
  );
  await db.exec(
    sqlFile("supabase/migrations/20271021000006_ajustar_pedido_ganho.sql"),
  );
  await db.exec(sqlFile("supabase/migrations/20271106000010_corrigir_venda_historica.sql"));
  await db.exec(sqlFile("supabase/migrations/20271106000020_corrigir_venda_ganha.sql"));
  // Keep previous sale rows immutable, as in production; adjustment must append.
  await db.exec(`CREATE FUNCTION test_immutable_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sale ledger is immutable'; END $$;
    CREATE TRIGGER immutable_sale BEFORE UPDATE OR DELETE ON sale_events FOR EACH ROW EXECUTE FUNCTION test_immutable_sale();`);
});
after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE deal_sale_corrections,deal_order_adjustments,deal_items,sale_events,upsell_orders,upsell_clients,pipeline_entries,deals,leads,team_members,organizations,auth.users CASCADE;
    INSERT INTO auth.users VALUES ('${id(1)}'),('${id(2)}');
    INSERT INTO organizations(id,carteira_emits_revenue_enabled) VALUES ('${id(10)}',false),('${id(20)}',false);
    INSERT INTO team_members(id,user_id,organization_id) VALUES ('${id(11)}','${id(1)}','${id(10)}'),('${id(21)}','${id(2)}','${id(20)}');
    INSERT INTO leads(id,organization_id,name,sale_responsible_id) VALUES ('${id(3)}','${id(10)}','Cliente teste','${id(11)}');
    INSERT INTO deals(id,organization_id,title,value,source_lead_id,source,outcome,won,closed_at,outcome_at,updated_at)
      VALUES ('${id(4)}','${id(10)}','Pedido teste',100,'${id(3)}','human','won',true,'2026-08-01','2026-08-01','2026-09-01T12:00:00Z');
    INSERT INTO pipeline_entries(id,deal_id,organization_id) VALUES ('${id(5)}','${id(4)}','${id(10)}');
    INSERT INTO sale_events(id,organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,sold_at,sale_value,currency,revenue_stream,sale_responsible_id,source)
      VALUES ('${id(6)}','${id(10)}','${id(3)}','${id(4)}','${id(7)}','ganho','sale','2026-08-01T15:00:00Z',100,'BRL','novo_negocio','${id(11)}','backfill');
    SELECT set_config('request.jwt.claim.sub','${id(1)}',false);
  `);
});


const correct = async (value=150,date="2026-10-01",version=null,reason="Faturada em outro dia") => {
  const at=version ?? (await row("select updated_at from deals")).updated_at;
  return (await db.query("select corrigir_venda_ganha($1,$2,$3,$4,$5) r",[id(4),at,value,date,reason])).rows[0].r;
};
const rejects=(p,code)=>assert.rejects(p,e=>e.message.includes(code));
const live=()=>row("select count(*)::int n,sum(s.sale_value)::float value,min(s.sold_at) sold_at from sale_events s where event_type='sale' and not exists(select 1 from sale_events r where r.reversed_event_id=s.id)");
test("corrige data e valor do funil atomicamente, preserva o pedido e o período do estorno",async()=>{
  const original=await row("select * from upsell_orders");
  await db.exec("SET ROLE authenticated");const result=await correct();assert.equal(result.changed,true);
  const sale=await live();assert.equal(sale.n,1);assert.equal(sale.value,150);assert.equal(sale.sold_at.toISOString(),"2026-10-01T15:00:00.000Z");
  const order=await row("select * from upsell_orders");assert.equal(order.id,original.id);assert.equal(order.approved_at.toISOString(),original.approved_at.toISOString());assert.equal(Number(order.sale_value),150);assert.equal(order.sold_at.toISOString(),sale.sold_at.toISOString());
  const deal=await row("select * from deals");assert.equal(deal.outcome,"won");assert.equal(deal.closed_at.toISOString(),sale.sold_at.toISOString());assert.equal(deal.outcome_at.toISOString(),sale.sold_at.toISOString());
  assert.equal((await row("select sold_at from sale_events where event_type='sale_reversed'")).sold_at.toISOString(),"2026-08-01T15:00:00.000Z");
  assert.equal(Number((await row("select lifetime_value from upsell_clients")).lifetime_value),150);
  assert.equal((await row("select metadata from pipeline_entries")).metadata.sale_value,150);
  const audit=await row("select * from deal_sale_corrections");assert.equal(audit.actor_id,id(1));assert.equal(audit.reason,"Faturada em outro dia");
});
test("duas correções e ajuste de produtos posterior não duplicam receita nem pedido",async()=>{
  await correct();await correct(175,"2026-10-02");
  const at=(await row("select updated_at from deals")).updated_at;await adjust(200,null,"Ajuste posterior",at);
  const sale=await live();assert.equal(sale.n,1);assert.equal(sale.value,200);assert.equal(sale.sold_at.toISOString(),"2026-10-02T15:00:00.000Z");
  assert.equal(Number((await row("select count(*) n from upsell_orders")).n),1);
  assert.equal(Number((await row("select count(*) n from deal_sale_corrections")).n),2);
});
test("valor isolado conserva a hora; sem mudança não cria eventos",async()=>{
  await correct(150,"2026-08-01");assert.equal((await live()).sold_at.toISOString(),"2026-08-01T15:00:00.000Z");
  const events=await row("select count(*)::int n from sale_events");assert.equal((await correct(150,"2026-08-01")).changed,false);assert.deepEqual(await row("select count(*)::int n from sale_events"),events);
});
test("recusa dados inválidos e versão da ficha desatualizada",async()=>{
  const at=(await row("select updated_at from deals")).updated_at;await correct();
  await rejects(correct(175,"2026-10-01",at),"sale_state_changed");
  for(const value of [0,-1,10.123,1e10,NaN])await rejects(correct(value),"invalid_sale_value");
  await rejects(correct(150,"2999-01-01"),"invalid_sale_date");await rejects(correct(150,"2026-10-01",null,"  "),"correction_reason_required");
});
test("recusa outra org, usuário sem acesso ao lead e viewer",async()=>{
  await db.exec("SELECT set_config('request.jwt.claim.sub','"+id(2)+"',false); SET ROLE authenticated");await rejects(correct(),"access denied");
  await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','"+id(1)+"',false); UPDATE team_members SET role='viewer' WHERE id='"+id(11)+"'");await rejects(correct(),"access_denied");
  await db.exec("UPDATE team_members SET role='member' WHERE id='"+id(11)+"'; UPDATE leads SET sale_responsible_id='"+id(21)+"'");await rejects(correct(),"access_denied");
});
test("recusa ERP sem alterar os três registros",async()=>{
  await db.exec("UPDATE pipeline_entries SET metadata='{\"external_source\":\"toth\"}'");await rejects(correct(),"order_erp_linked");
  assert.equal((await live()).value,100);assert.equal(Number((await row("select sale_value from upsell_orders")).sale_value),100);assert.equal(Number((await row("select value from deals")).value),100);
});
test("produtos mantêm total coerente e permitem corrigir a data",async()=>{
  await db.exec("INSERT INTO deal_items VALUES ('"+id(8)+"','"+id(10)+"','"+id(4)+"','Café',2,50,0,DEFAULT)");
  await rejects(correct(150),"sale_value_from_items");await correct(100);assert.equal((await live()).value,100);assert.equal((await live()).sold_at.toISOString(),"2026-10-01T15:00:00.000Z");
});
test("negócio fechado sem pedido espelhado também é corrigido",async()=>{
  await db.exec("DELETE FROM upsell_orders");await correct();assert.equal((await live()).value,150);assert.equal(Number((await row("select count(*) n from upsell_orders")).n),0);
});
test("recusa vínculos ambíguos e negócio aberto",async()=>{
  await db.exec("UPDATE deals SET outcome='open'");await rejects(correct(),"sale_not_won");await db.exec("UPDATE deals SET outcome='won'; INSERT INTO sale_events SELECT gen_random_uuid(),organization_id,lead_id,pipeline_id,stage_key,NULL,event_type,reversed_event_id,sold_at,sale_value,currency,revenue_stream,sale_responsible_id,pre_sale_responsible_id,actor,source,created_at,producer,origin_record_id,deal_id,adjusts_sale_id FROM sale_events");await rejects(correct(),"sale_link_ambiguous");
});
test("uma falha ao atualizar o pedido reverte o par de eventos e o negócio",async()=>{
  await db.exec("CREATE FUNCTION fail_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test order failure'; END $$; CREATE TRIGGER fail_order BEFORE UPDATE ON upsell_orders FOR EACH ROW EXECUTE FUNCTION fail_order()");
  await rejects(correct(),"test order failure");assert.equal((await live()).value,100);assert.equal(Number((await row("select value from deals")).value),100);assert.equal(Number((await row("select count(*) n from deal_sale_corrections")).n),0);
  await db.exec("DROP TRIGGER fail_order ON upsell_orders; DROP FUNCTION fail_order()");
});
