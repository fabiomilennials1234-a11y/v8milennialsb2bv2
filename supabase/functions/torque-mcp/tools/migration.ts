import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";

/**
 * Drift between the migrations *in the repo* and what is *applied in the database*
 * (`supabase_migrations.schema_migrations`) is the most recurring incident class in the
 * project: out-of-band changes applied straight to prod with no repo migration, repo
 * migrations that never reached the DB (#824), and duplicate version prefixes that
 * `db push` silently drops (#822/#824). `migration.diff` turns the manual check into one
 * audited, RLS-safe call.
 *
 * The tool is stateless about the repo (the edge function has no repo filesystem): the
 * caller injects the repo truth (`repo_versions`), the tool injects the DB truth (the
 * applied ledger). Diff = comparison of the two sets.
 */
export interface MigrationDiff {
  /** In the repo, absent from the DB → pending / skipped. */
  repo_not_applied: string[];
  /** In the DB, absent from the repo → out-of-band / drift. */
  applied_not_in_repo: string[];
  /** Version prefixes that appear more than once in the repo (counted BEFORE dedup). */
  repo_collisions: Array<{ version: string; count: number }>;
  /** True iff all three arrays are empty. */
  in_sync: boolean;
}

/**
 * Normalize a raw version token to its 14-digit prefix. Tolerates the shapes `git ls-files`
 * produces (`supabase/migrations/20261222000000_foo.sql`, a bare prefix, a `_name.sql`
 * suffix). Strips every non-digit, keeps the first 14 digits, and returns null for anything
 * that is not exactly 14 digits (defensive against garbage rows).
 */
function normalizeVersion(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "").slice(0, 14);
  return /^\d{14}$/.test(digits) ? digits : null;
}

/** Map a raw token list to valid 14-digit versions, dropping garbage (order preserved). */
export function normalizeVersions(versions: string[]): string[] {
  const out: string[] = [];
  for (const v of versions) {
    const n = normalizeVersion(v);
    if (n !== null) out.push(n);
  }
  return out;
}

/**
 * Pure diff of repo migration versions against DB-applied versions. Deterministic: every
 * output array is sorted ascending, no clocks / randomness. Collisions are counted on the
 * normalized repo array *before* dedup (duplicates are the signal, not noise).
 */
export function diffMigrations(repoVersions: string[], dbVersions: string[]): MigrationDiff {
  const repo = normalizeVersions(repoVersions);
  const db = normalizeVersions(dbVersions);

  const repoSet = new Set(repo);
  const dbSet = new Set(db);

  const repo_not_applied = [...repoSet].filter((v) => !dbSet.has(v)).sort();
  const applied_not_in_repo = [...dbSet].filter((v) => !repoSet.has(v)).sort();

  const counts = new Map<string, number>();
  for (const v of repo) counts.set(v, (counts.get(v) ?? 0) + 1);
  const repo_collisions = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));

  const in_sync = repo_not_applied.length === 0 &&
    applied_not_in_repo.length === 0 &&
    repo_collisions.length === 0;

  return { repo_not_applied, applied_not_in_repo, repo_collisions, in_sync };
}

/**
 * The applied-migrations ledger of the DB the function is deployed against. The schema MUST
 * be qualified (`supabase_migrations.`) — `mcp_exec_readonly_sql` runs with
 * `search_path = pg_catalog, public`, so an unqualified `schema_migrations` would not resolve.
 * Read access is granted to `mcp_readonly` by the S6 grant migration.
 */
export function buildAppliedMigrationsQuery(): string {
  return `
select version
from supabase_migrations.schema_migrations
order by version`.trim();
}

interface AppliedMigrationRow {
  version: string;
}

export const migrationDiffTool: ToolDef = {
  name: "migration.diff",
  description:
    "Compare the migration versions in the repo against what is actually applied in the DB " +
    "(supabase_migrations.schema_migrations). Surfaces the recurring drift classes: repo " +
    "migrations never applied (pending/skipped), out-of-band changes applied with no repo " +
    "migration, and duplicate version prefixes in the repo (collisions). The caller injects the " +
    "repo truth via repo_versions (e.g. `git ls-files supabase/migrations | grep -oE '[0-9]{14}'`); " +
    "the tool injects the DB truth. Read-only.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      repo_versions: {
        type: "array",
        description:
          "Version prefixes of the repo migrations (14-digit; full paths / _name.sql suffixes are " +
          "tolerated). Duplicates are PRESERVED — they are the collision signal.",
      },
      include_applied: {
        type: "boolean",
        description: "Also return the full list of versions applied in the DB (default false)",
      },
    },
    required: ["repo_versions"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;

    const repoInput = args.repo_versions;
    if (!Array.isArray(repoInput) || !repoInput.every((v) => typeof v === "string")) {
      return {
        content: [{ type: "text", text: "Error: repo_versions must be an array of strings" }],
        isError: true,
      };
    }
    const repoVersions = repoInput as string[];
    const includeApplied = args.include_applied === true;

    const { data, error } = await db.rpc("mcp_exec_readonly_sql", {
      p_sql: buildAppliedMigrationsQuery(),
      p_max_rows: 5000,
    });
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }

    const rows = (Array.isArray(data) ? data : []) as AppliedMigrationRow[];
    const dbVersions = rows.map((r) => String(r.version));
    const applied = [...new Set(normalizeVersions(dbVersions))].sort();

    const diff = diffMigrations(repoVersions, dbVersions);
    const payload = {
      db_applied_count: applied.length,
      repo_count: normalizeVersions(repoVersions).length,
      repo_not_applied: diff.repo_not_applied,
      applied_not_in_repo: diff.applied_not_in_repo,
      repo_collisions: diff.repo_collisions,
      in_sync: diff.in_sync,
      ...(includeApplied ? { applied } : {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
};
