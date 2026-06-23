import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../lib/types.ts";

/**
 * Introspection query: every public base table that is multi-tenant (has organization_id)
 * and has RLS enabled, plus whether any policy looks master/ghost-aware. The recurring
 * incident class is a multi-tenant table whose master-ghost policy is missing on a rebuild,
 * so the ops-master silently "sees nothing". This finds those.
 *
 * Runs through mcp_exec_readonly_sql (read-only role, master-gated) — pg_catalog and
 * information_schema are PUBLIC-readable so no extra grants are needed.
 */
export function buildRlsAuditQuery(table?: string): string {
  const tableFilter = table ? `and c.relname = ${quoteLiteral(table)}` : "";
  return `
with tbls as (
  select c.relname as table_name,
         c.relrowsecurity as rls_enabled,
         exists(
           select 1 from information_schema.columns col
           where col.table_schema = 'public' and col.table_name = c.relname
             and col.column_name = 'organization_id'
         ) as has_org
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' ${tableFilter}
),
pol as (
  select tablename,
         bool_or(coalesce(qual, '') ilike '%is_master%' or coalesce(qual, '') ilike '%master%')
           as has_master_policy,
         count(*) as policy_count
  from pg_policies
  where schemaname = 'public'
  group by tablename
)
select t.table_name,
       t.rls_enabled,
       t.has_org,
       coalesce(p.has_master_policy, false) as has_master_policy,
       coalesce(p.policy_count, 0) as policy_count
from tbls t
left join pol p on p.tablename = t.table_name
${table ? "" : "where t.has_org = true and t.rls_enabled = true"}
order by t.table_name`.trim();
}

/** Minimal single-quote escaping for an identifier-as-literal (table name). */
function quoteLiteral(v: string): string {
  return "'" + v.replace(/'/g, "''") + "'";
}

export interface RlsRow {
  table_name: string;
  rls_enabled: boolean;
  has_org: boolean;
  has_master_policy: boolean;
  policy_count: number;
}

/** A gap = multi-tenant + RLS on + no master-aware policy → master sees nothing. */
export function isRlsGap(row: RlsRow): boolean {
  return row.has_org === true && row.rls_enabled === true && row.has_master_policy === false;
}

export const rlsCheckAccessTool: ToolDef = {
  name: "rls.check_access",
  description: "Audit master-ghost RLS coverage. Without a table, lists multi-tenant tables " +
    "(organization_id, RLS on) with NO master-aware policy — CANDIDATES to review, not all are " +
    "bugs (not every table needs cross-org master access; the recurring incident is a table that " +
    "SHOULD have it losing it on a rebuild). With a table, returns its precise RLS status " +
    "(high-signal during an incident). Read-only catalog introspection.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", description: "Specific public table to inspect (optional)" },
    },
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const table = typeof args.table === "string" && args.table.trim()
      ? args.table.trim()
      : undefined;

    const { data, error } = await db.rpc("mcp_exec_readonly_sql", {
      p_sql: buildRlsAuditQuery(table),
      p_max_rows: 1000,
    });
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    const rows = (Array.isArray(data) ? data : []) as RlsRow[];

    if (table) {
      if (rows.length === 0) {
        return { content: [{ type: "text", text: `Table not found: ${table}` }] };
      }
      const row = rows[0];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ...row, is_gap: isRlsGap(row) }, null, 2),
        }],
      };
    }

    const candidates = rows.filter(isRlsGap).map((r) => r.table_name);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          {
            multi_tenant_tables_scanned: rows.length,
            without_master_policy_count: candidates.length,
            note:
              "Candidates without a master-aware policy — review which SHOULD have cross-org master access. Not all are bugs.",
            without_master_policy: candidates,
          },
          null,
          2,
        ),
      }],
    };
  },
};
