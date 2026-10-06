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
const row = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;

const as = (user) =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE authenticated;`);
const version = async (deal) =>
  (await row("select updated_at from deals where id=$1", [deal])).updated_at;
const correct = async (deal, { value = 175, date = "2025-02-15", reason = "Faturada em outra data", at } = {}) =>
  (
    await db.query("select public.corrigir_venda_historica($1,$2,$3,$4,$5) as r", [
      deal,
      at ?? (await version(deal)),
      value,
      date,
      reason,
    ])
  ).rows[0].r;
const rejects = (promise, code) => assert.rejects(promise, (e) => e.message.includes(code));

before(async () => {
  db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(sqlFile("tests/fixtures/historical-sales-schema.sql"));
  const adjust = sqlFile("supabase/migrations/20271021000006_ajustar_pedido_ganho.sql");
  const forceSoldAt = adjust.match(
    /CREATE OR REPLACE FUNCTION public\.fn_sale_events_force_sold_at\(\)[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(forceSoldAt, "production sold_at normalizer must exist");
  // Mesmo contrato de produção: colunas de ajuste, chave de idempotência e caderno imutável.
  await db.exec(`
    ALTER TABLE sale_events ADD COLUMN adjusts_sale_id uuid REFERENCES sale_events(id) ON DELETE CASCADE;
    ALTER TABLE sale_events ADD CONSTRAINT sale_adjustment_kind CHECK (
      adjusts_sale_id IS NULL OR (event_type IN ('sale', 'sale_reversed') AND deal_id IS NOT NULL));
    CREATE UNIQUE INDEX uq_sale_events_producer_origin_event ON sale_events(producer, origin_record_id, event_type)
      WHERE origin_record_id IS NOT NULL;
    ALTER TABLE sale_events ADD CONSTRAINT sale_events_reversal_coherence
      CHECK ((event_type = 'sale_reversed') = (reversed_event_id IS NOT NULL));
    ALTER FUNCTION assert_org_member(uuid) SET search_path = public;
    ALTER FUNCTION get_my_organization_ids() SET search_path = public;
    ALTER FUNCTION can_link_or_read_lead(uuid,uuid) SET search_path = public;
  `);
  await db.exec(forceSoldAt);
  await db.exec(sqlFile("supabase/migrations/20271018000002_registrar_vendas_historicas.sql"));
  await db.exec(`CREATE FUNCTION test_immutable_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sale ledger is immutable'; END $$;
    CREATE TRIGGER immutable_sale BEFORE UPDATE OR DELETE ON sale_events FOR EACH ROW EXECUTE FUNCTION test_immutable_sale();`);
  await db.exec(sqlFile("supabase/migrations/20271106000010_corrigir_venda_historica.sql"));
  await db.exec(sqlFile("supabase/migrations/20271106000020_corrigir_venda_ganha.sql"));
});
test("a porta unificada também corrige vendas históricas", async () => {
  const at = await version(deals[1]);
  await db.query("select corrigir_venda_ganha($1,$2,$3,$4,$5)", [deals[1],at,180,"2025-02-18","Correção pela interface clássica"]);
  assert.equal((await live()).find(s => s.deal_id === deals[1]).v,180);
});

after(async () => {
  await db?.close();
});

let deals;
beforeEach(async () => {
  await db.exec(`RESET ROLE;
    TRUNCATE deal_sale_corrections,historical_sale_corrections,historical_sale_batches,sale_events,upsell_orders,upsell_clients,deals,leads,team_members,organizations,auth.users CASCADE;
    INSERT INTO auth.users VALUES ('${id(1)}'),('${id(2)}'),('${id(3)}');
    INSERT INTO organizations(id) VALUES ('${id(10)}'),('${id(20)}');
    INSERT INTO team_members(id,user_id,organization_id,role) VALUES
      ('${id(11)}','${id(1)}','${id(10)}','member'),('${id(21)}','${id(2)}','${id(20)}','member'),('${id(12)}','${id(3)}','${id(10)}','viewer');
    INSERT INTO leads(id,organization_id,name) VALUES ('${id(30)}','${id(10)}','Cliente');`);
  await as(id(1));
  const { r } = await row(
    "select public.registrar_vendas_historicas($1,$2,$3::jsonb) as r",
    [id(30), id(40), JSON.stringify([{ value: 100, date: "2025-01-01" }, { value: 150, date: "2025-01-31" }])],
  );
  deals = r;
});

const live = () =>
  rows(`select s.deal_id, s.sale_value::float v, s.sold_at, s.revenue_stream from sale_events s
    where s.event_type='sale' and not exists(select 1 from sale_events r where r.reversed_event_id=s.id)
    order by s.sold_at`);

test("corrige data e valor nos três registros, sem apagar o caderno", async () => {
  const result = await correct(deals[1]);
  assert.equal(result.changed, true);
  await db.exec("RESET ROLE");
  const deal = await row("select title,value::float v,closed_at,outcome_at from deals where id=$1", [deals[1]]);
  assert.equal(deal.v, 175);
  assert.equal(deal.title, "Venda registrada em 15/02/2025");
  assert.equal(deal.closed_at.toISOString(), "2025-02-15T15:00:00.000Z");
  assert.equal(deal.outcome_at.toISOString(), "2025-02-15T15:00:00.000Z");
  const order = await row("select sale_value::float v, sold_at from upsell_orders where id=(select metadata->>'order_id' from deals where id=$1)::uuid", [deals[1]]);
  assert.equal(order.v, 175);
  assert.equal(order.sold_at.toISOString(), "2025-02-15T15:00:00.000Z");
  const ledger = await live();
  assert.deepEqual(ledger.map((s) => [s.v, s.sold_at.toISOString().slice(0, 10)]), [
    [100, "2025-01-01"],
    [175, "2025-02-15"],
  ]);
  const events = await rows("select event_type, sold_at from sale_events where deal_id=$1 order by created_at,event_type", [deals[1]]);
  assert.equal(events.length, 3, "venda original + estorno + venda nova");
  const reversal = events.find((e) => e.event_type === "sale_reversed");
  assert.equal(reversal.sold_at.toISOString(), "2025-01-31T15:00:00.000Z", "estorno cai no período original");
  const audit = await row("select before_value::float b, after_value::float a, reason from historical_sale_corrections");
  assert.deepEqual(audit, { b: 150, a: 175, reason: "Faturada em outra data" });
});

test("a edição solta do pedido histórico continua barrada depois da correção", async () => {
  await correct(deals[1]);
  await db.exec("RESET ROLE");
  await rejects(
    db.query("update upsell_orders set sold_at = now() where source='historical'"),
    "order_historical_readonly",
  );
  await rejects(
    db.query("update upsell_orders set sale_value = 1 where source='historical'"),
    "order_historical_readonly",
  );
});

test("mover a venda para antes das outras reordena aquisição e recompra", async () => {
  await correct(deals[1], { value: 150, date: "2024-12-01" });
  await db.exec("RESET ROLE");
  const ledger = await live();
  assert.equal(ledger[0].v, 150);
  assert.equal(ledger[0].revenue_stream, "novo_negocio");
  const client = await row("select first_sale_at from upsell_clients");
  assert.equal(client.first_sale_at.toISOString().slice(0, 10), "2024-12-01");
});

test("duas correções seguidas não colidem na chave de idempotência", async () => {
  await correct(deals[1], { value: 160, date: "2025-02-01" });
  await correct(deals[1], { value: 170, date: "2025-02-10", reason: "Segunda conferência" });
  await db.exec("RESET ROLE");
  const ledger = await live();
  assert.equal(ledger.filter((s) => s.deal_id === deals[1]).length, 1);
  assert.equal(ledger.find((s) => s.deal_id === deals[1]).v, 170);
  assert.equal((await row("select count(*)::int n from historical_sale_corrections")).n, 2);
});

test("sem mudança real não grava nada", async () => {
  const result = await correct(deals[1], { value: 150, date: "2025-01-31" });
  assert.equal(result.changed, false);
  await db.exec("RESET ROLE");
  assert.equal((await row("select count(*)::int n from sale_events")).n, 2);
  assert.equal((await row("select count(*)::int n from historical_sale_corrections")).n, 0);
});

test("recusa versão velha, dado inválido e data futura", async () => {
  const stale = await version(deals[1]);
  await correct(deals[1]);
  await rejects(correct(deals[1], { at: stale, value: 1 }), "sale_state_changed");
  await rejects(correct(deals[1], { value: 0 }), "invalid_sale_value");
  await rejects(correct(deals[1], { value: 10.123 }), "invalid_sale_value");
  await rejects(correct(deals[1], { date: "2999-01-01" }), "invalid_sale_date");
  await rejects(correct(deals[1], { reason: "  " }), "correction_reason_required");
});

test("recusa outra organização, perfil sem permissão e negócio que não é venda histórica", async () => {
  await as(id(2));
  await rejects(correct(deals[1]), "access denied");
  await as(id(3));
  await rejects(correct(deals[1]), "access_denied");
  await db.exec("RESET ROLE");
  await db.exec(`INSERT INTO deals(id,organization_id,title,value,source_lead_id,source,outcome,won,closed_at,outcome_at)
    VALUES ('${id(50)}','${id(10)}','Normal',10,'${id(30)}','human','won',true,now(),now())`);
  await as(id(1));
  await rejects(correct(id(50), { value: 10 }), "not_historical_sale");
});
