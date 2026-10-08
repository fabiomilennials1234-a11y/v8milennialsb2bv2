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
const rejects = (p, code) => assert.rejects(p, (e) => e.message.includes(code));

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
  `);
  await db.exec(sqlFile("tests/fixtures/won-order-admission.sql"));
  await db.exec(
    "CREATE TRIGGER trg_carteira_admite_venda AFTER INSERT ON sale_events FOR EACH ROW WHEN (NEW.producer='funnel' AND NEW.event_type IN ('sale','sale_reversed')) EXECUTE FUNCTION fn_carteira_admite_venda();",
  );
  await db.exec(sqlFile("supabase/migrations/20271021000006_ajustar_pedido_ganho.sql"));
  await db.exec(sqlFile("supabase/migrations/20271106000010_corrigir_venda_historica.sql"));
  await db.exec(sqlFile("supabase/migrations/20271106000020_corrigir_venda_ganha.sql"));
  // Os leitores de métrica do fim da migration dependem de funções que a
  // fixture não tem: o corpo deles é validado em prod, não aqui.
  await db.exec("SET check_function_bodies = off");
  await db.exec(sqlFile("supabase/migrations/20271109000000_corrigir_data_do_desfecho.sql"));
  await db.exec("SET check_function_bodies = on");
  await db.exec(`CREATE FUNCTION test_immutable_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sale ledger is immutable'; END $$;
    CREATE TRIGGER immutable_sale BEFORE UPDATE OR DELETE ON sale_events FOR EACH ROW EXECUTE FUNCTION test_immutable_sale();`);
});
after(async () => {
  await db?.close();
});

// Perda pelo caminho da etapa: `sale_lost` SEM deal_id, mesmo instante do desfecho.
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE deal_outcome_date_corrections,deal_sale_corrections,deal_order_adjustments,deal_items,sale_events,upsell_orders,upsell_clients,pipeline_entries,deals,leads,team_members,organizations,auth.users CASCADE;
    INSERT INTO auth.users VALUES ('${id(1)}'),('${id(2)}');
    INSERT INTO organizations(id,carteira_emits_revenue_enabled) VALUES ('${id(10)}',false),('${id(20)}',false);
    INSERT INTO team_members(id,user_id,organization_id) VALUES ('${id(11)}','${id(1)}','${id(10)}'),('${id(21)}','${id(2)}','${id(20)}');
    INSERT INTO leads(id,organization_id,name,sale_responsible_id) VALUES ('${id(3)}','${id(10)}','Cliente teste','${id(11)}');
    INSERT INTO deals(id,organization_id,title,value,source_lead_id,source,outcome,won,closed_at,outcome_at,updated_at)
      VALUES ('${id(4)}','${id(10)}','Perda teste',80,'${id(3)}','human','lost',false,'2026-10-05T18:30:00Z','2026-10-05T18:30:00Z','2026-10-05T18:30:00Z');
    INSERT INTO pipeline_entries(id,deal_id,organization_id) VALUES ('${id(5)}','${id(4)}','${id(10)}');
    INSERT INTO sale_events(id,organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,sold_at,sale_value,currency,revenue_stream,sale_responsible_id,source)
      VALUES ('${id(6)}','${id(10)}','${id(3)}',NULL,'${id(7)}','perdido','sale_lost','2026-10-05T18:30:00Z',80,'BRL','novo_negocio','${id(11)}','backfill');
    SELECT set_config('request.jwt.claim.sub','${id(1)}',false);
  `);
});

const correct = async (date = "2026-09-20", version = null, reason = "Perda foi registrada atrasada") => {
  const at = version ?? (await row("select updated_at from deals")).updated_at;
  return (await db.query("select corrigir_data_do_desfecho($1,$2,$3,$4) r", [id(4), at, date, reason])).rows[0].r;
};
// O que as métricas de perda contam: `sale_lost` sem estorno.
const liveLost = () =>
  row("select count(*)::int n, min(s.sold_at) sold_at, min(s.deal_id::text) deal_id from sale_events s where event_type='sale_lost' and not exists(select 1 from sale_events r where r.event_type='sale_reversed' and r.reversed_event_id=s.id)");

test("perda: negócio e caderno passam para a nova data, com estorno e auditoria", async () => {
  await db.exec("SET ROLE authenticated");
  const r = await correct();
  assert.equal(r.changed, true);
  assert.equal(r.metric_event_corrected, true);
  const lost = await liveLost();
  assert.equal(lost.n, 1);
  // Meio-dia em São Paulo = 15h UTC.
  assert.equal(lost.sold_at.toISOString(), "2026-09-20T15:00:00.000Z");
  assert.equal(lost.deal_id, id(4), "o sale_lost corrigido passa a apontar o negócio");
  const deal = await row("select * from deals");
  assert.equal(deal.outcome, "lost");
  assert.equal(deal.outcome_at.toISOString(), "2026-09-20T15:00:00.000Z");
  assert.equal(deal.closed_at.toISOString(), "2026-09-20T15:00:00.000Z");
  const rev = await row("select * from sale_events where event_type='sale_reversed'");
  assert.equal(rev.reversed_event_id, id(6));
  assert.equal(rev.sold_at.toISOString(), "2026-10-05T18:30:00.000Z", "o estorno fica no período original");
  await db.exec("RESET ROLE");
  const audit = await row("select * from deal_outcome_date_corrections");
  assert.equal(audit.actor_id, id(1));
  assert.equal(audit.original_event_id, id(6));
  assert.equal(audit.before_at.toISOString(), "2026-10-05T18:30:00.000Z");
  assert.equal(Number((await row("select count(*) n from upsell_clients")).n), 0, "estorno de perda não mexe na carteira");
});

test("perda corrigida duas vezes mantém uma perda viva", async () => {
  await correct();
  await correct("2026-09-10");
  const lost = await liveLost();
  assert.equal(lost.n, 1);
  assert.equal(lost.sold_at.toISOString(), "2026-09-10T15:00:00.000Z");
});

test("perda sem evento no caderno corrige só o negócio e avisa", async () => {
  await db.exec("TRUNCATE sale_events CASCADE");
  const r = await correct();
  assert.equal(r.metric_event_corrected, false);
  assert.equal((await row("select outcome_at from deals")).outcome_at.toISOString(), "2026-09-20T15:00:00.000Z");
  assert.equal(Number((await row("select count(*) n from sale_events")).n), 0);
});

test("não casa sale_lost de outra perda do mesmo lead fora da janela", async () => {
  await db.exec("TRUNCATE sale_events CASCADE; INSERT INTO sale_events(id,organization_id,lead_id,pipeline_id,stage_key,event_type,sold_at,currency,revenue_stream,source) VALUES ('" + id(8) + "','" + id(10) + "','" + id(3) + "','" + id(7) + "','perdido','sale_lost','2026-06-01T12:00:00Z','BRL','novo_negocio','backfill')");
  assert.equal((await correct()).metric_event_corrected, false);
  assert.equal((await liveLost()).sold_at.toISOString(), "2026-06-01T12:00:00.000Z");
});

test("mesmo dia não cria eventos", async () => {
  const r = await correct("2026-10-05");
  assert.equal(r.changed, false);
  assert.equal(Number((await row("select count(*) n from sale_events")).n), 1);
});

test("recusa versão velha, data futura, motivo vazio e negócio aberto", async () => {
  const at = (await row("select updated_at from deals")).updated_at;
  await correct();
  await rejects(correct("2026-09-01", at), "deal_state_changed");
  await rejects(correct("2999-01-01"), "invalid_outcome_date");
  await rejects(correct("2026-09-01", null, "   "), "correction_reason_required");
  await db.exec("UPDATE deals SET outcome='open'");
  await rejects(correct(), "deal_not_closed");
});

test("recusa outra org, viewer e quem não lê o lead", async () => {
  await db.exec("SELECT set_config('request.jwt.claim.sub','" + id(2) + "',false); SET ROLE authenticated");
  await rejects(correct(), "access denied");
  await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','" + id(1) + "',false); UPDATE team_members SET role='viewer' WHERE id='" + id(11) + "'");
  await rejects(correct(), "access_denied");
  await db.exec("UPDATE team_members SET role='member' WHERE id='" + id(11) + "'; UPDATE leads SET sale_responsible_id='" + id(21) + "'");
  await rejects(correct(), "access_denied");
  assert.equal((await liveLost()).sold_at.toISOString(), "2026-10-05T18:30:00.000Z");
});

test("trigger recusa ajuste de perda com outro tipo ou outro negócio", async () => {
  const ins = (type, deal) =>
    db.query(`insert into sale_events(organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,currency,revenue_stream,source,adjusts_sale_id)
      values ('${id(10)}','${id(3)}',${deal},'${id(7)}','perdido','${type}','BRL','novo_negocio','ui','${id(6)}')`);
  await rejects(ins("sale", `'${id(4)}'`), "invalid_sale_adjustment");
  await db.exec(`INSERT INTO deals(id,organization_id,title,source_lead_id,source,outcome) VALUES ('${id(9)}','${id(10)}','Outro','${id(3)}','human','lost')`);
  // Original com negócio: trocar o negócio no ajuste é recusado.
  await db.exec(`INSERT INTO sale_events(id,organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,currency,revenue_stream,source) VALUES ('${id(12)}','${id(10)}','${id(3)}','${id(4)}','${id(7)}','perdido','sale_lost','BRL','novo_negocio','backfill')`);
  await rejects(
    db.query(`insert into sale_events(organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,currency,revenue_stream,source,adjusts_sale_id)
      values ('${id(10)}','${id(3)}','${id(9)}','${id(7)}','perdido','sale_lost','BRL','novo_negocio','ui','${id(12)}')`),
    "invalid_sale_adjustment",
  );
});

test("ganho delega para corrigir_venda_ganha com o valor que o negócio já tem", async () => {
  await db.exec(`TRUNCATE sale_events CASCADE;
    UPDATE deals SET outcome='won', won=true, value=100, closed_at='2026-08-01T15:00:00Z', outcome_at='2026-08-01T15:00:00Z';
    INSERT INTO sale_events(id,organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,sold_at,sale_value,currency,revenue_stream,sale_responsible_id,source)
      VALUES ('${id(6)}','${id(10)}','${id(3)}','${id(4)}','${id(7)}','ganho','sale','2026-08-01T15:00:00Z',100,'BRL','novo_negocio','${id(11)}','backfill');`);
  const r = await correct("2026-08-15");
  assert.equal(r.changed, true);
  const sale = await row("select count(*)::int n, min(sold_at) sold_at, min(sale_value)::float v from sale_events s where event_type='sale' and not exists(select 1 from sale_events r where r.reversed_event_id=s.id)");
  assert.equal(sale.n, 1);
  assert.equal(sale.v, 100);
  assert.equal(sale.sold_at.toISOString(), "2026-08-15T15:00:00.000Z");
  assert.equal(Number((await row("select count(*) n from deal_sale_corrections")).n), 1);
});

test("ganho com produtos usa o total dos produtos, não o valor divergente do negócio", async () => {
  await db.exec(`TRUNCATE sale_events CASCADE;
    UPDATE deals SET outcome='won', won=true, value=100, closed_at='2026-08-01T15:00:00Z', outcome_at='2026-08-01T15:00:00Z';
    INSERT INTO sale_events(id,organization_id,lead_id,deal_id,pipeline_id,stage_key,event_type,sold_at,sale_value,currency,revenue_stream,sale_responsible_id,source)
      VALUES ('${id(6)}','${id(10)}','${id(3)}','${id(4)}','${id(7)}','ganho','sale','2026-08-01T15:00:00Z',120,'BRL','novo_negocio','${id(11)}','backfill');
    INSERT INTO deal_items VALUES ('${id(8)}','${id(10)}','${id(4)}','Café',2,60,0,DEFAULT);`);
  await correct("2026-08-15");
  const sale = await row("select min(sale_value)::float v, min(sold_at) sold_at from sale_events s where event_type='sale' and not exists(select 1 from sale_events r where r.reversed_event_id=s.id)");
  assert.equal(sale.v, 120);
  assert.equal(sale.sold_at.toISOString(), "2026-08-15T15:00:00.000Z");
});
