import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const org = "00000000-0000-4000-8000-000000000001";
const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20271020000054_guided_product_relation.sql",
    import.meta.url,
  ),
  "utf8",
);
const original = sql.match(
  /CREATE OR REPLACE FUNCTION public.can_read_guided_execution_data\([\s\S]*?END; \$\$;/,
)[0];

test("master can read legacy executions without granting access to restricted or anonymous callers", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.master',true)='true' $$;
      CREATE FUNCTION public.can_administer_guided_workflow(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.admin',true)='true' $$;
      CREATE FUNCTION public.can_link_or_read_lead(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE TABLE workflow_guided_versions(id uuid,organization_id uuid,required_fields text[],definition jsonb);
    `);
    await db.exec(original);
    if (!process.env.TEST_ORIGINAL_HISTORY) {
      const migration = readFileSync(
        new URL(
          "../../supabase/migrations/20271021000007_master_legacy_workflow_history.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await db.exec(migration);
    }
    const visible = async (lead = null, version = null) =>
      (
        await db.query(
          "select can_read_guided_execution_data($1,$2,$3) visible",
          [org, lead, version],
        )
      ).rows[0].visible;
    await db.exec(
      `SET test.uid='${org}'; SET test.master='true'; SET test.admin='true';`,
    );
    assert.equal(
      await visible(),
      true,
      "full master sees executions without lead or guided version",
    );
    assert.equal(
      await visible(org, null),
      true,
      "legacy execution with a lead is visible to full master",
    );
    assert.equal(
      (
        await db.query(
          "select can_read_guided_execution_data(null,null,null) visible",
        )
      ).rows[0].visible,
      false,
      "organization is still required",
    );
    await db.exec("SET test.admin='false'");
    assert.equal(await visible(), false, "restricted master stays denied");
    await db.exec("SET test.master='false'; SET test.admin='true'");
    assert.equal(
      await visible(),
      false,
      "org admin does not inherit the master exception",
    );
    await db.exec("SET test.master='true'; SET test.uid=''");
    assert.equal(await visible(), false, "anonymous remains denied");
    const grants = (
      await db.query(
        "select has_function_privilege('anon','can_read_guided_execution_data(uuid,uuid,uuid)','EXECUTE') anon, has_function_privilege('authenticated','can_read_guided_execution_data(uuid,uuid,uuid)','EXECUTE') authenticated",
      )
    ).rows[0];
    assert.deepEqual(
      grants,
      { anon: false, authenticated: false },
      "helper remains private; existing RPCs are the access boundary",
    );
    await db.exec(
      readFileSync(
        new URL(
          "../../supabase/migrations/rollback/20271021000007_master_legacy_workflow_history.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      `SET test.uid='${org}'; SET test.master='true'; SET test.admin='true'`,
    );
    assert.equal(
      await visible(),
      false,
      "rollback restores the original behavior",
    );
  } finally {
    await db.close();
  }
});
