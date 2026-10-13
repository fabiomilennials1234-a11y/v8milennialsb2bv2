import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("card merging enforces caller visibility and preserves dependent data", async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
        SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION is_master_user() RETURNS boolean LANGUAGE sql AS $$
        SELECT coalesce(current_setting('test.master',true),'false')='true' $$;
      CREATE FUNCTION get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql AS $$
        SELECT nullif(current_setting('test.org',true),'')::uuid $$;
      CREATE FUNCTION private.strict_lead_member_orgs() RETURNS uuid[] LANGUAGE sql AS $$
        SELECT CASE WHEN is_master_user() OR current_setting('test.admin',true)='true'
          THEN ARRAY[]::uuid[] ELSE ARRAY['${id(100)}'::uuid] END $$;
      CREATE FUNCTION private.strict_lead_is_owned(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$
        SELECT coalesce(current_setting('test.owner',true),'false')='true' $$;
      CREATE TABLE pipeline_entries(id uuid PRIMARY KEY, organization_id uuid,lead_id uuid,
        deal_id uuid,closed_at timestamptz,pipeline_id uuid);
      CREATE TABLE lead_comments(id uuid PRIMARY KEY,pipeline_entry_id uuid REFERENCES pipeline_entries ON DELETE SET NULL,attachments jsonb DEFAULT '[]');
      CREATE TABLE meetings(id uuid PRIMARY KEY,pipeline_entry_id uuid REFERENCES pipeline_entries ON DELETE SET NULL,lead_id uuid,event_type text,pipeline_id uuid);
      CREATE TABLE follow_ups(id uuid PRIMARY KEY,pipeline_entry_id uuid REFERENCES pipeline_entries ON DELETE SET NULL);
      CREATE TABLE workflow_executions(id uuid PRIMARY KEY,pipeline_entry_id uuid REFERENCES pipeline_entries ON DELETE SET NULL);
      CREATE TABLE acoes_do_dia(id uuid PRIMARY KEY,pipeline_entry_id uuid,proposta_id uuid,confirmacao_id uuid);
      CREATE TABLE pipe_proposta_items(id uuid PRIMARY KEY,pipe_proposta_id uuid REFERENCES pipeline_entries ON DELETE CASCADE);
      CREATE TABLE commissions(id uuid PRIMARY KEY,pipe_proposta_id uuid REFERENCES pipeline_entries ON DELETE SET NULL,source text);
      CREATE TABLE checklists(id uuid PRIMARY KEY,pipeline_entry_id uuid REFERENCES pipeline_entries ON DELETE CASCADE,source_template_id uuid,
        UNIQUE(pipeline_entry_id,source_template_id));
      CREATE TABLE checklist_items(id uuid PRIMARY KEY,checklist_id uuid REFERENCES checklists ON DELETE CASCADE,completed boolean);
      CREATE TABLE upsell_orders(id uuid PRIMARY KEY,pipe_proposta_id uuid UNIQUE REFERENCES pipeline_entries ON DELETE SET NULL);
      CREATE TABLE tinyerp_order_mappings(id uuid PRIMARY KEY,pipe_proposta_id uuid UNIQUE REFERENCES pipeline_entries ON DELETE CASCADE);
      GRANT USAGE ON SCHEMA public,auth,private TO authenticated,service_role;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    `);
    await db.exec(read("./fixtures/card-merge-production-20261013.sql"));
    if (!process.env.CARD_MERGE_BASELINE) {
      await db.exec(read("../../supabase/migrations/20271119000001_harden_card_merge_access_and_dependents.sql"));
    }
    const merge = () => db.exec(`SELECT _repontar_dependentes_do_card('${id(1)}','${id(2)}')`);
    const reset = async () => {
      await db.exec(`
        RESET ROLE;
        TRUNCATE pipeline_entries CASCADE;
        TRUNCATE acoes_do_dia;
        SET test.uid='${id(900)}'; SET test.org='${id(100)}';
        SET test.master='false'; SET test.admin='false'; SET test.owner='true';
        INSERT INTO pipeline_entries(id,organization_id,lead_id,deal_id,closed_at,pipeline_id) VALUES
          ('${id(1)}','${id(100)}','${id(200)}',NULL,NULL,'${id(300)}'),
          ('${id(2)}','${id(100)}','${id(200)}',NULL,NULL,'${id(301)}');
        INSERT INTO lead_comments(id,pipeline_entry_id) VALUES('${id(10)}','${id(1)}');
        INSERT INTO follow_ups VALUES('${id(11)}','${id(1)}');
        INSERT INTO workflow_executions VALUES('${id(12)}','${id(1)}');
        INSERT INTO checklists VALUES('${id(20)}','${id(1)}','${id(500)}');
        INSERT INTO checklist_items VALUES('${id(21)}','${id(20)}',true);
        SET ROLE authenticated;
      `);
    };
    const commentSource = async () => (await db.query(`SELECT pipeline_entry_id FROM lead_comments WHERE id='${id(10)}'`)).rows[0].pipeline_entry_id;

    await t.test("same-org hidden-card member cannot call the definer directly", async () => {
      await reset(); await db.exec("SET test.owner='false'");
      await assert.rejects(merge(), /Sem acesso/);
      assert.equal(await commentSource(),id(1));
    });
    await t.test("authenticated caller without identity is rejected", async () => {
      await reset(); await db.exec("SET test.uid=''");
      await assert.rejects(merge(), /Sem acesso/);
      assert.equal(await commentSource(),id(1));
    });
    await t.test("a different organization's member is rejected", async () => {
      await reset(); await db.exec(`SET test.org='${id(999)}'`);
      await assert.rejects(merge(), /Sem acesso/);
    });
    await t.test("owner can merge and all non-conflicting checklist answers survive deletion", async () => {
      await reset(); await merge();
      assert.equal(await commentSource(),id(2));
      await db.exec(`RESET ROLE; DELETE FROM pipeline_entries WHERE id='${id(1)}'`);
      assert.deepEqual((await db.query("SELECT completed FROM checklist_items")).rows,[{completed:true}]);
      assert.equal((await db.query("SELECT pipeline_entry_id FROM checklists")).rows[0].pipeline_entry_id,id(2));
      assert.equal((await db.query("SELECT pipeline_entry_id FROM workflow_executions")).rows[0].pipeline_entry_id,id(2));
    });
    for (const role of ["admin","master"]) {
      await t.test(`${role} retains access to non-owned cards`, async () => {
        await reset(); await db.exec(`SET test.owner='false'; SET test.${role}='true'`);
        await merge(); assert.equal(await commentSource(),id(2));
      });
    }
    await t.test("same-template checklists abort atomically instead of losing answers", async () => {
      await reset();
      await db.exec(`RESET ROLE;
        INSERT INTO checklists VALUES('${id(22)}','${id(2)}','${id(500)}');
        INSERT INTO checklist_items VALUES('${id(23)}','${id(22)}',false);
        SET ROLE authenticated`);
      await assert.rejects(merge(), /checklists ou pedidos distintos/);
      assert.equal(await commentSource(),id(1));
      assert.deepEqual((await db.query("SELECT completed FROM checklist_items ORDER BY id")).rows,[{completed:true},{completed:false}]);
    });
    for (const table of ["upsell_orders","tinyerp_order_mappings"]) {
      await t.test(`conflicting ${table} are never dropped`, async () => {
        await reset();
        await db.exec(`RESET ROLE; INSERT INTO ${table} VALUES('${id(30)}','${id(1)}'),('${id(31)}','${id(2)}'); SET ROLE authenticated`);
        await assert.rejects(merge(), /checklists ou pedidos distintos/);
        assert.equal(await commentSource(),id(1));
        assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,2);
      });
    }
    for (const change of ["lead_id=NULL","closed_at=now()","deal_id='"+id(888)+"'"]) {
      await t.test(`invalid source ${change} cannot merge`, async () => {
        await reset(); await db.exec(`RESET ROLE; UPDATE pipeline_entries SET ${change} WHERE id='${id(1)}'; SET ROLE authenticated`);
        await assert.rejects(merge(), /Só se funde/);
      });
    }
    await t.test("preserves production exceptions for documents, historical meetings and projected commissions", async () => {
      await reset();
      await db.exec(`RESET ROLE;
        UPDATE lead_comments SET attachments='[{"path":"document"}]';
        INSERT INTO meetings VALUES('${id(40)}','${id(1)}','${id(200)}','meeting','${id(300)}');
        INSERT INTO commissions VALUES('${id(41)}','${id(1)}','sale_event_projection');
        SET ROLE authenticated`);
      await merge();
      assert.equal(await commentSource(),id(1));
      await db.exec(`RESET ROLE; DELETE FROM pipeline_entries WHERE id='${id(1)}'`);
      for (const table of ["lead_comments","meetings","commissions"]) {
        assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,1);
      }
    });
    await t.test("anonymous role cannot invoke helper; backend role can", async () => {
      await reset();
      await db.exec("RESET ROLE; SET test.uid=''; SET ROLE anon");
      await assert.rejects(merge(), /permission denied/);
      await db.exec("RESET ROLE; SET ROLE service_role");
      await merge();
      await db.exec("RESET ROLE");
      assert.equal(await commentSource(),id(2));
    });

    // Exercise the real caller and closing trigger together: the origin-stage
    // UPDATE can change closed_at before the caller decides whether to merge.
    await db.exec(`RESET ROLE;
      ALTER TABLE pipeline_entries ADD COLUMN stage_key text DEFAULT 'entrada', ADD COLUMN assigned_to uuid;
      CREATE TABLE pipelines(id uuid PRIMARY KEY,organization_id uuid,type text);
      CREATE TABLE pipeline_stages(id uuid PRIMARY KEY,pipeline_id uuid,organization_id uuid,stage_key text);
      INSERT INTO pipelines VALUES
        ('${id(300)}','${id(100)}','custom'),('${id(301)}','${id(100)}','custom');
      INSERT INTO pipeline_stages VALUES
        ('${id(401)}','${id(300)}','${id(100)}','vendido'),
        ('${id(402)}','${id(300)}','${id(100)}','qualificado'),
        ('${id(403)}','${id(301)}','${id(100)}','novo');
      GRANT SELECT ON pipelines,pipeline_stages TO authenticated;
      GRANT UPDATE,DELETE ON pipeline_entries TO authenticated;
      ALTER TABLE pipeline_entries ENABLE ROW LEVEL SECURITY;
      CREATE POLICY member_entries ON pipeline_entries TO authenticated USING (
        organization_id IN (SELECT get_my_organization_ids())
        AND (NOT(organization_id=ANY(private.strict_lead_member_orgs()))
             OR private.strict_lead_is_owned(organization_id,lead_id))
      );
    `);
    const baselineSchema = read("../../supabase/migrations/20260101000000_baseline_prod_schema.sql");
    const closingTrigger = baselineSchema.match(/CREATE OR REPLACE FUNCTION "public"\."enforce_closed_at_on_final_stage"\(\)[\s\S]*?\$\$;/);
    assert.ok(closingTrigger, "canonical closing trigger must be present");
    await db.exec(closingTrigger[0]);
    await db.exec(`CREATE TRIGGER close_final_stage BEFORE INSERT OR UPDATE OF stage_key ON pipeline_entries
      FOR EACH ROW EXECUTE FUNCTION enforce_closed_at_on_final_stage()`);
    const prerequisite = read("../../supabase/migrations/20271119000000_um_card_sem_negocio_por_lead_no_funil.sql");
    await db.exec(prerequisite.slice(prerequisite.indexOf("CREATE OR REPLACE FUNCTION public.mover_negocio("),
      prerequisite.indexOf("-- ── 5. bulk_move")));
    if (!process.env.CARD_FORWARDING_BASELINE) {
      await db.exec(read("../../supabase/migrations/20271119000002_preserve_closed_card_on_forwarding.sql"));
    }
    const forward = (stage = "vendido") => db.query(`SELECT mover_negocio(
      '${id(1)}','${id(301)}','novo','${stage}','${id(901)}') AS survivor`);
    await t.test("a final-stage forward adopts the destination and preserves the newly closed source history", async () => {
      await reset();
      assert.equal((await forward()).rows[0].survivor,id(2));
      const source=(await db.query(`SELECT * FROM pipeline_entries WHERE id='${id(1)}'`)).rows[0];
      assert.ok(source.closed_at);
      assert.equal(source.pipeline_id,id(300));
      assert.equal(source.stage_key,"vendido");
      assert.equal(await commentSource(),id(1));
      assert.equal((await db.query("SELECT pipeline_entry_id FROM checklists")).rows[0].pipeline_entry_id,id(1));
      assert.equal((await db.query("SELECT completed FROM checklist_items")).rows[0].completed,true);
      assert.equal((await db.query("SELECT pipeline_entry_id FROM follow_ups")).rows[0].pipeline_entry_id,id(1));
      const target=(await db.query(`SELECT * FROM pipeline_entries WHERE id='${id(2)}'`)).rows[0];
      assert.equal(target.assigned_to,id(901));
      assert.equal(target.closed_at,null);
      assert.equal(target.stage_key,"entrada");
      await assert.rejects(merge(),/Só se funde/);
    });
    await t.test("ordinary open-card forwarding still merges dependents and removes only the redundant card", async () => {
      await reset();
      assert.equal((await forward("qualificado")).rows[0].survivor,id(2));
      assert.equal((await db.query("SELECT count(*)::int n FROM pipeline_entries")).rows[0].n,1);
      assert.equal(await commentSource(),id(2));
      assert.equal((await db.query("SELECT pipeline_entry_id FROM checklists")).rows[0].pipeline_entry_id,id(2));
    });
    await t.test("a closed-source forward preserves conflicting checklists on both cards", async () => {
      await reset();
      await db.exec(`RESET ROLE;
        INSERT INTO checklists VALUES('${id(22)}','${id(2)}','${id(500)}');
        INSERT INTO checklist_items VALUES('${id(23)}','${id(22)}',false);
        SET ROLE authenticated`);
      assert.equal((await forward()).rows[0].survivor,id(2));
      assert.deepEqual((await db.query("SELECT completed FROM checklist_items ORDER BY id")).rows,[{completed:true},{completed:false}]);
      assert.equal((await db.query("SELECT count(*)::int n FROM pipeline_entries")).rows[0].n,2);
    });
    await t.test("caller forwarding still obeys RLS for a member without lead access", async () => {
      await reset(); await db.exec("SET test.owner='false'");
      await assert.rejects(forward(),/não encontrado/);
      await db.exec("RESET ROLE");
      assert.equal((await db.query(`SELECT stage_key FROM pipeline_entries WHERE id='${id(1)}'`)).rows[0].stage_key,"entrada");
      assert.equal(await commentSource(),id(1));
    });
  } finally { await db.close(); }
});
