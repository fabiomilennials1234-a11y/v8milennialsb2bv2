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
        INSERT INTO pipeline_entries VALUES
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
  } finally { await db.close(); }
});

