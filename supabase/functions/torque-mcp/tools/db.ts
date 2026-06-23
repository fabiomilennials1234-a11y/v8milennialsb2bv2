import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../lib/types.ts";
import { auditMcpAction } from "../lib/audit.ts";

const MAX_ROWS_CAP = 5000;
const DEFAULT_MAX_ROWS = 1000;

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do|vacuum|analyze|reindex|refresh|comment|lock|listen|notify|prepare|execute|set|reset|begin|commit|rollback|savepoint|into|nextval|setval)\b/i;

export interface SqlGuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Defense-in-depth guard mirrored in the DB function: only a single read-only
 * SELECT/WITH statement, no comments, no write/DDL keywords. The hard containment
 * is the read-only role + READ ONLY transaction in mcp_exec_readonly_sql; this just
 * fails fast with a clear message before hitting the database.
 */
export function isReadOnlySql(sql: string): SqlGuardResult {
  const s = (sql ?? "").trim();
  if (!s) return { ok: false, reason: "empty query" };

  const core = s.replace(/;+\s*$/, "").trim();
  if (!core) return { ok: false, reason: "empty query" };
  if (core.includes(";")) return { ok: false, reason: "only a single statement is allowed" };
  if (core.includes("--") || core.includes("/*")) {
    return { ok: false, reason: "comments are not allowed" };
  }

  const first = core.toLowerCase().match(/^(\w+)/)?.[1];
  if (first !== "select" && first !== "with") {
    return { ok: false, reason: "query must start with SELECT or WITH" };
  }
  if (FORBIDDEN.test(core)) {
    return { ok: false, reason: "query contains a forbidden (write/DDL) keyword" };
  }
  return { ok: true };
}

export function clampMaxRows(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ROWS;
  return Math.min(Math.floor(n), MAX_ROWS_CAP);
}

export const dbReadSqlTool: ToolDef = {
  name: "db.read_sql",
  description: "Run a single read-only SELECT/WITH query against the database for diagnostics. " +
    "Runs under a dedicated read-only role in a READ ONLY transaction with a statement timeout; " +
    "cannot write and cannot read secret tables. Every query is audited. " +
    "Provide sql and optionally max_rows (default 1000, cap 5000).",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A single SELECT or WITH query (no writes, no ';')" },
      max_rows: { type: "number", description: "Row cap (default 1000, max 5000)" },
    },
    required: ["sql"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const sql = String(args.sql ?? "");
    const guard = isReadOnlySql(sql);
    if (!guard.ok) {
      return { content: [{ type: "text", text: `Rejected: ${guard.reason}` }], isError: true };
    }
    const maxRows = clampMaxRows(args.max_rows);

    // Read-trail: record who ran what SQL before executing (params redacted in audit).
    try {
      await auditMcpAction(db, {
        tool: "db.read_sql",
        org_id: "",
        target_type: "sql",
        target_id: null,
        params: { sql, max_rows: maxRows },
        plan: { sql, max_rows: maxRows },
        confirm_token: "",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text", text: `Audit failed (query not run): ${msg}` }],
        isError: true,
      };
    }

    const { data, error } = await db.rpc("mcp_exec_readonly_sql", {
      p_sql: sql,
      p_max_rows: maxRows,
    });
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    const rows = Array.isArray(data) ? data : [];
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ row_count: rows.length, max_rows: maxRows, rows }, null, 2),
      }],
    };
  },
};
