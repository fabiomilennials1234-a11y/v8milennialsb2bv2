import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../lib/types.ts";

/**
 * Every SECURITY DEFINER function in public and whether it pins `search_path`. A definer
 * function that does NOT pin search_path is both a privilege-escalation surface and the
 * cause of the recurring "function inherited an empty search_path → 42883 unqualified call"
 * incidents (e.g. the leads uf trigger). This surfaces the whole class at once.
 *
 * Runs through mcp_exec_readonly_sql (read-only role, master-gated); pg_proc is
 * PUBLIC-readable, so no extra grants are needed.
 */
export function buildDefinerAuditQuery(): string {
  return `
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       exists(
         select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
         where cfg like 'search_path=%'
       ) as pins_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef = true
order by pins_search_path, p.proname`.trim();
}

export interface DefinerRow {
  function_name: string;
  args: string;
  pins_search_path: boolean;
}

/** Risk = a SECURITY DEFINER function that does not pin search_path. */
export function isDefinerRisk(row: DefinerRow): boolean {
  return row.pins_search_path === false;
}

export const schemaAuditDefinerTool: ToolDef = {
  name: "schema.audit_definer",
  description:
    "List SECURITY DEFINER functions in public and flag those that do NOT pin search_path " +
    "(a privilege-escalation surface + the cause of the recurring 42883 'unqualified call " +
    "under empty search_path' incidents). Read-only catalog introspection.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      include_safe: {
        type: "boolean",
        description: "Also list functions that DO pin search_path (default false: risks only)",
      },
    },
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const includeSafe = args.include_safe === true;

    const { data, error } = await db.rpc("mcp_exec_readonly_sql", {
      p_sql: buildDefinerAuditQuery(),
      p_max_rows: 2000,
    });
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    const rows = (Array.isArray(data) ? data : []) as DefinerRow[];
    const risks = rows.filter(isDefinerRisk);

    const payload = {
      definer_functions: rows.length,
      unpinned_search_path: risks.length,
      risks: risks.map((r) => ({ function_name: r.function_name, args: r.args })),
      ...(includeSafe
        ? { safe: rows.filter((r) => !isDefinerRisk(r)).map((r) => r.function_name) }
        : {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
};
