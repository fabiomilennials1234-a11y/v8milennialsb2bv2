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
  // Keep previous sale rows immutable, as in production; adjustment must append.
  await db.exec(`CREATE FUNCTION test_immutable_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sale ledger is immutable'; END $$;
    CREATE TRIGGER immutable_sale BEFORE UPDATE OR DELETE ON sale_events FOR EACH ROW EXECUTE FUNCTION test_immutable_sale();`);
});
after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE deal_order_adjustments,deal_items,sale_events,upsell_orders,upsell_clients,pipeline_entries,deals,leads,team_members,organizations,auth.users CASCADE;
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

test("corrige valor manual mantendo ID do pedido, data, desfecho e uma venda líquida", async () => {
  const before = await row("select * from upsell_orders");
  await db.exec("SET ROLE authenticated");
  await adjust();
  const order = await row("select * from upsell_orders");
  assert.equal(order.id, before.id);
  assert.equal(order.sold_at.toISOString(), before.sold_at.toISOString());
  assert.equal(
    order.approved_at.toISOString(),
    before.approved_at.toISOString(),
  );
  assert.equal(Number(order.sale_value), 150);
  assert.deepEqual(
    await row("select outcome, won, closed_at, outcome_at from deals"),
    {
      outcome: "won",
      won: true,
      closed_at: new Date("2026-08-01Z"),
      outcome_at: new Date("2026-08-01Z"),
    },
  );
  const live = await row(
    "select count(*)::int n,sum(s.sale_value)::float value,min(s.sold_at) sold_at from sale_events s where event_type='sale' and not exists(select 1 from sale_events r where r.reversed_event_id=s.id)",
  );
  assert.equal(live.n, 1);
  assert.equal(live.value, 150);
  assert.equal(live.sold_at.toISOString(), "2026-08-01T15:00:00.000Z");
  assert.equal(
    Number(
      (await row("select lifetime_value from upsell_clients")).lifetime_value,
    ),
    150,
  );
  assert.equal(
    Number((await row("select count(*) n from upsell_orders")).n),
    1,
  );
  const audit = await row("select * from deal_order_adjustments");
  assert.equal(audit.actor_id, id(1));
  assert.equal(audit.reason, "Cliente aumentou quantidade");
  assert.equal(Number(audit.before_value), 100);
  assert.equal(Number(audit.after_value), 150);
});

test("quantidade altera os itens e o total na mesma transação; ignora total divergente do cliente", async () => {
  await db.exec(`INSERT INTO deal_items VALUES ('${id(8)}','${id(10)}','${id(4)}','Café',2,50,0,DEFAULT);
    UPDATE deals SET updated_at='2026-09-01T12:00:00Z';`);
  await adjust(9999, [
    { id: id(8), quantity: 3, unit_price: 50, discount_percent: 10 },
  ]);
  assert.equal(Number((await row("select value from deals")).value), 135);
  assert.equal(
    Number((await row("select quantity from deal_items")).quantity),
    3,
  );
  assert.equal(
    Number((await row("select sale_value from upsell_orders")).sale_value),
    135,
  );
});

test("duas correções sucessivas não duplicam pedido ou receita", async () => {
  const before = await row("select id from upsell_orders");
  await adjust();
  const version = (await row("select updated_at::text from deals")).updated_at;
  await adjust(200, null, "Segundo ajuste", version);
  const live = await row(
    "select count(*)::int n,sum(sale_value)::float value from sale_events s where event_type='sale' and not exists(select 1 from sale_events r where r.reversed_event_id=s.id)",
  );
  assert.deepEqual(live, { n: 1, value: 200 });
  assert.equal((await row("select id from upsell_orders")).id, before.id);
  assert.equal(
    Number((await row("select count(*) n from deal_order_adjustments")).n),
    2,
  );
});

test("recusa versão desatualizada e não sobrescreve o primeiro ajuste", async () => {
  await adjust();
  await assert.rejects(adjust(999), /order_state_changed/);
  assert.equal(Number((await row("select value from deals")).value), 150);
});

test("recusa outra organização e não expõe seu histórico", async () => {
  await adjust();
  await db.exec(
    `SELECT set_config('request.jwt.claim.sub','${id(2)}',false); SET ROLE authenticated;`,
  );
  await assert.rejects(adjust(300), /access denied/);
  assert.equal(
    (await db.query("select * from deal_order_adjustments")).rows.length,
    0,
  );
});

test("recusa usuário sem autenticação e chamada anônima", async () => {
  await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(adjust(), /access_denied/);
  await db.exec("SET ROLE anon");
  await assert.rejects(adjust(), /permission denied/);
});

test("recusa pedidos do ERP pelo vínculo exato", async () => {
  await db.exec(
    `UPDATE pipeline_entries SET metadata='{"external_source":"toth"}';`,
  );
  await assert.rejects(adjust(), /order_erp_linked/);
  assert.equal(Number((await row("select value from deals")).value), 100);
});

test("não corrige venda ambígua, negócio aberto ou valor inválido", async () => {
  await assert.rejects(adjust(0), /invalid_sale_value/);
  await assert.rejects(adjust(150, null, ""), /adjustment_reason_required/);
  await db.exec("UPDATE deals SET outcome='open'");
  await assert.rejects(adjust(), /order_not_won/);
  await db.exec(`UPDATE deals SET outcome='won'; INSERT INTO sale_events(id,organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,sale_value,revenue_stream,source)
    VALUES ('${id(9)}','${id(10)}','${id(3)}','${id(4)}','${id(7)}','ganho','sale',100,'novo_negocio','backfill');`);
  await assert.rejects(adjust(), /sale_link_ambiguous/);
});

test("itens inválidos revertem tudo e nenhum evento é acrescentado", async () => {
  await db.exec(
    `INSERT INTO deal_items VALUES ('${id(8)}','${id(10)}','${id(4)}','Café',2,50,0,DEFAULT); UPDATE deals SET updated_at='2026-09-01T12:00:00Z';`,
  );
  await assert.rejects(
    adjust(150, [
      { id: id(8), quantity: 0, unit_price: 50, discount_percent: 0 },
    ]),
    /invalid_items/,
  );
  await assert.rejects(
    adjust(150, [
      { id: id(99), quantity: 3, unit_price: 50, discount_percent: 0 },
    ]),
    /invalid_items/,
  );
  await assert.rejects(
    adjust(150, [
      { id: id(8), quantity: 3, unit_price: 0, discount_percent: 0 },
    ]),
    /invalid_sale_value/,
  );
  assert.equal(
    Number((await row("select quantity from deal_items")).quantity),
    2,
  );
  assert.equal(Number((await row("select count(*) n from sale_events")).n), 1);
  assert.equal(
    Number((await row("select count(*) n from deal_order_adjustments")).n),
    0,
  );
});

test("quantidade e preço podem mudar mantendo o total; audita sem nova venda", async () => {
  await db.exec(
    `INSERT INTO deal_items VALUES ('${id(8)}','${id(10)}','${id(4)}','Café',2,50,0,DEFAULT); UPDATE deals SET updated_at='2026-09-01T12:00:00Z';`,
  );
  await adjust(100, [
    { id: id(8), quantity: 4, unit_price: 25, discount_percent: 0 },
  ]);
  assert.equal(Number((await row("select count(*) n from sale_events")).n), 1);
  const audit = await row("select * from deal_order_adjustments");
  assert.equal(audit.before_items[0].quantity, 2);
  assert.equal(audit.after_items[0].quantity, 4);
  assert.equal(audit.replacement_sale_id, null);
});

test("motivo sem mudança não cria ajuste nem altera a revisão", async () => {
  const before = await row("select updated_at from deals");
  await adjust(100);
  assert.deepEqual(await row("select updated_at from deals"), before);
  assert.equal(
    Number((await row("select count(*) n from deal_order_adjustments")).n),
    0,
  );
});

test("mesma organização sem acesso ao cliente não pode ajustar; histórico não é editável", async () => {
  await adjust();
  await db.exec("SET ROLE authenticated");
  await assert.rejects(
    db.exec("UPDATE deal_order_adjustments SET reason='apagar rastro'"),
    /permission denied/,
  );
  await db.exec(`RESET ROLE; UPDATE team_members SET organization_id='${id(10)}' WHERE user_id='${id(2)}';
    SELECT set_config('request.jwt.claim.sub','${id(2)}',false); SET ROLE authenticated;`);
  const version = (await row("select updated_at::text from deals")).updated_at;
  await assert.rejects(
    adjust(200, null, "Sem acesso", version),
    /access_denied/,
  );
  assert.equal(
    (await db.query("select * from deal_order_adjustments")).rows.length,
    0,
  );
});
