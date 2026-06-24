import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildAppliedMigrationsQuery, diffMigrations, migrationDiffTool } from "./migration.ts";

Deno.test("diffMigrations — repo and db identical → in_sync, three arrays empty", () => {
  const versions = ["20261222000000", "20261223000000", "20261224000000"];
  const diff = diffMigrations(versions, versions);
  assertEquals(diff.repo_not_applied, []);
  assertEquals(diff.applied_not_in_repo, []);
  assertEquals(diff.repo_collisions, []);
  assertEquals(diff.in_sync, true);
});

Deno.test("diffMigrations — repo has 2 extra → repo_not_applied, sorted asc, rest empty", () => {
  const repo = ["20261224000000", "20261222000000", "20261223000000", "20261225000000"];
  const db = ["20261222000000", "20261223000000"];
  const diff = diffMigrations(repo, db);
  assertEquals(diff.repo_not_applied, ["20261224000000", "20261225000000"]);
  assertEquals(diff.applied_not_in_repo, []);
  assertEquals(diff.repo_collisions, []);
  assertEquals(diff.in_sync, false);
});

Deno.test("diffMigrations — db has an out-of-band version absent from repo → applied_not_in_repo", () => {
  const repo = ["20261222000000", "20261223000000"];
  const db = ["20261222000000", "20261223000000", "20260601120000"];
  const diff = diffMigrations(repo, db);
  assertEquals(diff.repo_not_applied, []);
  assertEquals(diff.applied_not_in_repo, ["20260601120000"]);
  assertEquals(diff.repo_collisions, []);
  assertEquals(diff.in_sync, false);
});

Deno.test("diffMigrations — duplicate repo prefix → collision with count; still classified", () => {
  // 20261118000000 appears twice in the repo and is NOT in the DB.
  const repo = ["20261118000000", "20261118000000", "20261222000000"];
  const db = ["20261222000000"];
  const diff = diffMigrations(repo, db);
  assertEquals(diff.repo_collisions, [{ version: "20261118000000", count: 2 }]);
  // still classified once (deduped) in repo_not_applied
  assertEquals(diff.repo_not_applied, ["20261118000000"]);
  assertEquals(diff.applied_not_in_repo, []);
  assertEquals(diff.in_sync, false);
});

Deno.test("diffMigrations — normalizes full paths / _name.sql suffix; drops non-14-digit garbage", () => {
  const repo = [
    "supabase/migrations/20261222000000_foo.sql",
    "20261223000000_some_fix_v2.sql",
    "not-a-version",
    "1234", // <14 digits → dropped
    "",
  ];
  const db = ["20261222000000", "20261223000000"];
  const diff = diffMigrations(repo, db);
  assertEquals(diff.repo_not_applied, []);
  assertEquals(diff.applied_not_in_repo, []);
  assertEquals(diff.repo_collisions, []);
  assertEquals(diff.in_sync, true);
});

Deno.test("diffMigrations — deterministic: shuffled input → identical sorted output", () => {
  const a = diffMigrations(
    ["20261225000000", "20261222000000", "20261224000000", "20261223000000"],
    ["20261223000000", "20261222000000"],
  );
  const b = diffMigrations(
    ["20261223000000", "20261224000000", "20261225000000", "20261222000000"],
    ["20261222000000", "20261223000000"],
  );
  assertEquals(a, b);
  assertEquals(a.repo_not_applied, ["20261224000000", "20261225000000"]);
});

Deno.test("buildAppliedMigrationsQuery — schema-qualified, ordered, read-only", () => {
  const sql = buildAppliedMigrationsQuery();
  assertStringIncludes(sql, "supabase_migrations.schema_migrations");
  assertStringIncludes(sql, "order by version");
  assertEquals(/^select\s/i.test(sql), true);
});

Deno.test("migrationDiffTool — contract: read-only, requires repo_versions", () => {
  assertEquals(migrationDiffTool.name, "migration.diff");
  assertEquals(migrationDiffTool.readonly, true);
  assertEquals(migrationDiffTool.requiresServiceRole, undefined);
  assertEquals(migrationDiffTool.inputSchema.required, ["repo_versions"]);
});
