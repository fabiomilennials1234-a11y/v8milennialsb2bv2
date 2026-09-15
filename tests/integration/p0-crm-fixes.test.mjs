import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const org = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const member = "00000000-0000-4000-8000-000000000003";
const lead = "00000000-0000-4000-8000-000000000004";
const entry = "00000000-0000-4000-8000-000000000005";
const pipeline = "00000000-0000-4000-8000-000000000006";
const sql = (name) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );

test("lote histórico autorizado executa duas vezes sem duplicar e aborta divergência", async () => {
  const db = await fixture();
  try {
    const batch = readFileSync(
      new URL(
        "../../supabase/ops/p0-milennials-commission-reconciliation.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const tenant = "6030520a-2ca7-477d-be89-55758e2cd808";
    const rows = [
      ...batch.matchAll(
        /\('([0-9a-f-]+)'::uuid, ([\d.]+), '([0-9a-f-]+)'::uuid, ([\d.]+), 'mrr'::public.product_type\)/g,
      ),
    ];
    assert.equal(rows.length, 22);
    await db.query("insert into organizations values($1,'America/Sao_Paulo')", [
      tenant,
    ]);
    await db.exec(`SET test.org='${tenant}'`);
    for (const [, event, value, owner] of rows) {
      await db.query(
        "insert into team_members(id,organization_id,user_id) values($1,$2,$1) on conflict do nothing",
        [owner, tenant],
      );
      await db.query(
        "insert into sale_events(id,organization_id,lead_id,sale_responsible_id,sale_value,sold_at,source) values($1,$2,$3,$4,$5,'2026-09-10','backfill')",
        [event, tenant, lead, owner, value],
      );
    }
    await db.exec(batch);
    await db.exec(batch);
    assert.deepEqual(
      (
        await db.query(
          "select count(*)::int n,sum(amount)::text total from commissions where organization_id=$1",
          [tenant],
        )
      ).rows[0],
      { n: 22, total: "953.70" },
    );
    await db.query("update sale_events set sale_value=1 where id=$1", [
      rows[0][1],
    ]);
    await assert.rejects(db.exec(batch), /Lote divergente/);
    await db.exec("ROLLBACK");
    assert.equal(
      (await db.query("select count(*)::int n from commissions")).rows[0].n,
      22,
    );
  } finally {
    await db.close();
  }
});

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION assert_org_access(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF $1::text IS DISTINCT FROM current_setting('test.org',true) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
    END $$;
    CREATE FUNCTION can_link_or_read_lead(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $2::text=current_setting('test.org',true) $$;
    CREATE FUNCTION has_feature_permission(text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.admin',true)='true' $$;
    CREATE FUNCTION is_master_user() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION get_my_admin_organization_ids() RETURNS SETOF uuid LANGUAGE sql AS $$ SELECT current_setting('test.org',true)::uuid WHERE current_setting('test.admin',true)='true' $$;
    CREATE FUNCTION metric_period_bounds(uuid,text,date,date,date) RETURNS tstzrange LANGUAGE sql AS $$
      SELECT tstzrange($3::timestamp AT TIME ZONE 'America/Sao_Paulo',($3+interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo','[)') $$;
    CREATE TYPE product_type AS ENUM('mrr','projeto');
    CREATE TABLE organizations(id uuid PRIMARY KEY, timezone text);
    CREATE TABLE master_users(user_id uuid,is_active boolean,permissions jsonb);
    CREATE TABLE team_members(id uuid PRIMARY KEY,organization_id uuid,user_id uuid,is_active boolean DEFAULT true,commission_mrr_percent numeric,commission_projeto_percent numeric);
    CREATE TABLE leads(id uuid PRIMARY KEY,organization_id uuid,name text,deleted_at timestamptz);
    CREATE TABLE pipelines(id uuid PRIMARY KEY,organization_id uuid,slug text);
    CREATE TABLE pipeline_stages(pipeline_id uuid,organization_id uuid,stage_key text,is_final_positive boolean,is_final_negative boolean);
    CREATE TABLE deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,title text,value numeric,source_lead_id uuid,owner_id uuid,source text,outcome text DEFAULT 'open',closed_at timestamptz,deleted_at timestamptz,updated_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE pipeline_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,pipeline_id uuid,stage_key text,deal_id uuid,assigned_to uuid,metadata jsonb DEFAULT '{}');
    CREATE TABLE pipeline_stage_events(id uuid PRIMARY KEY,entry_id uuid);
    CREATE TABLE deal_items(id uuid DEFAULT gen_random_uuid(),deal_id uuid,organization_id uuid,total numeric);
    CREATE TABLE lead_history(organization_id uuid,lead_id uuid,action text,description text,created_by uuid,metadata jsonb,source text,entity_type text,entity_id uuid);
    CREATE TABLE api_idempotency_keys(organization_id uuid,endpoint text,idempotency_key text,resource_id uuid,UNIQUE(organization_id,endpoint,idempotency_key));
    CREATE TABLE sale_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,producer text DEFAULT 'funnel',source text DEFAULT 'ui',event_type text DEFAULT 'sale',sale_responsible_id uuid,pre_sale_responsible_id uuid,sale_value numeric,sold_at timestamptz,stage_event_id uuid,deal_id uuid,reversed_event_id uuid,adjusts_sale_id uuid);
    CREATE TABLE commissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,team_member_id uuid,pipe_proposta_id uuid,amount numeric,type product_type,month integer,year integer,paid boolean DEFAULT false,created_at timestamptz DEFAULT now(),sale_event_id uuid UNIQUE,source text DEFAULT 'manual',rate_percent numeric);
    CREATE FUNCTION fn_resolver_funil(uuid,text) RETURNS pipelines LANGUAGE sql AS $$ SELECT p FROM pipelines p WHERE p.organization_id=$1 AND p.slug=$2 $$;
    CREATE FUNCTION abrir_negocio(uuid,text,text,uuid,numeric,text,text,text,text) RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE d uuid; o uuid; p uuid;
      BEGIN SELECT organization_id INTO o FROM leads WHERE id=$1; SELECT id INTO p FROM pipelines WHERE organization_id=o AND slug=$2;
        INSERT INTO deals(organization_id,source_lead_id,title,value,source) VALUES(o,$1,$8,$5,$9) RETURNING id INTO d;
        INSERT INTO pipeline_entries(organization_id,lead_id,pipeline_id,stage_key,deal_id) VALUES(o,$1,p,$3,d); RETURN d;
      END $$;
    INSERT INTO organizations VALUES('${org}','America/Sao_Paulo'),('${other}','America/Sao_Paulo');
    INSERT INTO team_members VALUES('${member}','${org}','${member}',true,1,0.5);
    INSERT INTO leads VALUES('${lead}','${org}','Cliente',NULL);
    INSERT INTO pipelines VALUES('${pipeline}','${org}','propostas');
    INSERT INTO pipeline_entries(id,organization_id,lead_id,pipeline_id,stage_key) VALUES('${entry}','${org}','${lead}','${pipeline}','aberto');
    SET test.uid='${member}'; SET test.org='${org}'; SET test.admin='true';
  `);
  for (const name of [
    "20271021000008_p0_commission_projection.sql",
    "20271021000009_p0_deal_idempotency.sql",
    "20271021000010_p0_proposal_value.sql",
  ])
    await db.exec(sql(name));
  return db;
}

test("proposta: valor, auditoria, concorrência, itens e desfecho", async () => {
  const db = await fixture();
  try {
    const save = (value, expected = null) =>
      db.query("select editar_valor_proposta($1,$2,$3) id", [
        entry,
        value,
        expected,
      ]);
    const id = (await save(1234.56)).rows[0].id;
    assert.equal(
      (await db.query("select value from deals where id=$1", [id])).rows[0]
        .value,
      "1234.56",
    );
    assert.equal(
      (await db.query("select count(*)::int n from sale_events")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from lead_history")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select garantir_negocio_da_entrada($1) id", [entry]))
        .rows[0].id,
      id,
    );
    await assert.rejects(save(800), /Atualize a ficha/);
    let stamp = (
      await db.query("select updated_at::text stamp from deals where id=$1", [
        id,
      ])
    ).rows[0].stamp;
    await save(0, stamp);
    await assert.rejects(save(500, stamp), /negócio mudou/);
    await assert.rejects(save(-1, stamp), /valor válido/);
    await assert.rejects(save("NaN", stamp), /valor válido/);
    stamp = (
      await db.query("select updated_at::text stamp from deals where id=$1", [
        id,
      ])
    ).rows[0].stamp;
    await db.query(
      "insert into deal_items(deal_id,organization_id,total) values($1,$2,100)",
      [id, org],
    );
    await assert.rejects(save(900, stamp), /Edite os produtos/);
    await db.query("update deals set outcome='won' where id=$1", [id]);
    await assert.rejects(save(900, stamp), /Somente propostas abertas/);
    await db.exec(`SET test.org='${other}'`);
    await assert.rejects(save(900, stamp), /access_denied/);
    await db.exec("SET test.uid=''");
    await assert.rejects(save(900, stamp), /Acesso negado/);
  } finally {
    await db.close();
  }
});

test("API: replay, conflito e nova venda legítima", async () => {
  const db = await fixture();
  try {
    const create = (key, value = 100, tenant = org) =>
      db.query(
        "select api_create_deal($1,$2,'propostas','aberto',null,$3,null,null,'api',$4) r",
        [tenant, lead, value, key],
      );
    await db.exec("BEGIN");
    const first = (await create("external-1")).rows[0].r;
    assert.ok(
      (
        await db.query(
          "select count(*)::int n from pg_locks where locktype='advisory' and granted",
        )
      ).rows[0].n > 0,
      "a reserva da chave permanece até o fim da transação",
    );
    await db.exec("COMMIT");
    const again = (await create("external-1")).rows[0].r;
    assert.equal(again.status, "replayed");
    assert.equal(first.deal.id, again.deal.id);
    await assert.rejects(create("external-1", 200), /idempotency_key_conflict/);
    await assert.rejects(create("external-1", 100, other), /não encontrado/);
    await assert.rejects(create(" "), /invalid_idempotency_key/);
    assert.notEqual(
      (await create("external-2")).rows[0].r.deal.id,
      first.deal.id,
    );
    await db.query("update deals set deleted_at=now() where id=$1", [
      first.deal.id,
    ]);
    await assert.rejects(
      create("external-1"),
      /idempotent_resource_unavailable/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from deals")).rows[0].n,
      2,
    );
    const grants = (
      await db.query(
        "select has_function_privilege('authenticated','api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text)','EXECUTE') authenticated,has_function_privilege('anon','editar_valor_proposta(uuid,numeric,timestamptz)','EXECUTE') anon",
      )
    ).rows[0];
    assert.deepEqual(grants, { authenticated: false, anon: false });
  } finally {
    await db.close();
  }
});

test("comissões: snapshot, ajuste, estorno, histórico pendente e isolamento", async () => {
  const db = await fixture();
  try {
    const sale = async (value, source = "ui", adjusts = null) =>
      (
        await db.query(
          "insert into sale_events(organization_id,sale_responsible_id,sale_value,sold_at,source,adjusts_sale_id) values($1,$2,$3,'2026-09-10T12:00Z',$4,$5) returning id",
          [org, member, value, source, adjusts],
        )
      ).rows[0].id;
    const ledger = async () =>
      (
        await db.query(
          "select get_commission_ledger($1,'month','2026-09-01',null,null,$2) r",
          [org, member],
        )
      ).rows[0].r;
    const first = await sale(1000);
    assert.equal((await ledger()).commission_total, 10);
    await db.exec("update team_members set commission_mrr_percent=20");
    assert.equal(
      (await ledger()).commission_total,
      10,
      "taxa posterior não reescreve histórico",
    );
    await db.query(
      "insert into sale_events(organization_id,event_type,reversed_event_id) values($1,'sale_reversed',$2)",
      [org, first],
    );
    assert.equal((await ledger()).sale_count_total, 0);
    await sale(1500, "ui", first);
    assert.equal(
      (await ledger()).commission_total,
      15,
      "ajuste preserva taxa original",
    );
    const historical = await sale(14380, "backfill");
    const pending = await ledger();
    assert.equal(pending.projection_status, "pending");
    assert.equal(pending.pending_count, 1);
    assert.equal(pending.base_revenue_total, 15880);
    assert.equal(pending.by_member[0].pending_revenue, 14380);
    await db.query(
      "insert into sale_events(organization_id,producer,sale_responsible_id,sale_value,sold_at) values($1,'carteira',$2,50000,'2026-09-10')",
      [org, member],
    );
    assert.equal(
      (await ledger()).base_revenue_total,
      15880,
      "carteira não comissiona por inferência",
    );
    const reconcile = () =>
      db.query(
        "select reconciliar_comissao_historica($1,1,'mrr','Percentual histórico confirmado pelo CTO') id",
        [historical],
      );
    const reconciled = (await reconcile()).rows[0].id;
    assert.equal(
      (await reconcile()).rows[0].id,
      reconciled,
      "reprocessamento não duplica comissão",
    );
    assert.equal((await ledger()).projection_status, "ready");
    assert.equal((await ledger()).commission_total, 158.8);
    await assert.rejects(
      db.query(
        "select reconciliar_comissao_historica($1,20,'mrr','Percentual diferente não pode sobrescrever')",
        [historical],
      ),
      /already_reconciled/,
    );
    await assert.rejects(
      db.exec("update commissions set amount=999"),
      /imutável/,
    );
    await db.exec(`SET test.org='${other}'`);
    await assert.rejects(ledger(), /access_denied/);
    await db.exec(
      `SET test.org='${org}'; SET test.admin='false'; SET test.uid='${other}'`,
    );
    await assert.rejects(ledger(), /access_denied/);
    await db.exec(`SET test.uid='${member}'`);
    assert.equal(
      (await ledger()).commission_total,
      158.8,
      "membro consulta seu próprio resumo",
    );
    await assert.rejects(reconcile(), /access_denied/);
    await db.exec(
      `SET test.uid='${other}'; INSERT INTO master_users VALUES('${other}',true,'{"all":false}')`,
    );
    await assert.rejects(ledger(), /access_denied/);
    await assert.rejects(reconcile(), /access_denied/);
    await db.exec("UPDATE master_users SET permissions='{\"all\":true}'");
    assert.equal(
      (await ledger()).commission_total,
      158.8,
      "master completo sem vínculo no time pode ler",
    );
    assert.equal(
      (await reconcile()).rows[0].id,
      reconciled,
      "master completo pode reconciliar",
    );
    await db.exec(
      "GRANT USAGE ON SCHEMA public TO authenticated; GRANT INSERT ON commissions TO authenticated; SET ROLE authenticated",
    );
    await assert.rejects(
      db.exec(
        "INSERT INTO commissions(source) VALUES('sale_event_projection')",
      ),
      /requires_server/,
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
