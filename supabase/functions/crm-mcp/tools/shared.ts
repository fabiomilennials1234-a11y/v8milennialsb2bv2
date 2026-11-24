/**
 * Helpers every customer tool shares (DESIGN §6.4). Pure — unit-tested in shared.test.ts.
 *
 * The org contract, restated because it is the whole point of this module: the org is the
 * PAT's (ctx.orgId), never the caller's argument. An `org_id` argument is tolerated only when
 * it EQUALS the token's org, and every query still carries `.eq("organization_id", orgId)` on
 * top of RLS — the barrier that contains an RLS regression.
 */
import type { ToolAnnotations, ToolResult } from "../../_shared/mcp/types.ts";

export type OrgScope =
  | { ok: true; orgId: string }
  | { ok: false; message: string };

/** The token org is authoritative; a diverging arg org_id is rejected, never silently used. */
export function resolveOrgScope(
  args: Record<string, unknown>,
  tokenOrgId: string | undefined,
): OrgScope {
  if (!tokenOrgId) return { ok: false, message: "No organization in token context." };
  const argOrg = typeof args.org_id === "string" ? args.org_id.trim() : "";
  if (argOrg && argOrg !== tokenOrgId) {
    return { ok: false, message: "org_id does not match the token's organization." };
  }
  return { ok: true, orgId: tokenOrgId };
}

/** Every customer tool is read-only and closed-world (it only sees this CRM). */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Hard ceiling on a single tool result, so one call cannot flood the model's context. */
export const MAX_RESULT_CHARS = 120_000;

export function jsonResult(value: unknown): ToolResult {
  let text = JSON.stringify(value, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text = text.slice(0, MAX_RESULT_CHARS) +
      "\n… [truncated: narrow the query or lower `limit`]";
  }
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** A DB error surfaces as a tool error with the PostgREST message, never as a 500. */
export function dbErrorResult(error: { message?: string; code?: string }): ToolResult {
  return errorResult(
    `Query failed${error.code ? ` (${error.code})` : ""}: ${error.message ?? "unknown"}`,
  );
}

/** Integer in [1, max], default when absent or garbage. */
export function clampLimit(v: unknown, def: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function optionalUuid(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : "invalid";
}

/** ISO-8601 date/datetime → normalized ISO string; null when absent; "invalid" otherwise. */
export function optionalIsoDate(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return "invalid";
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : "invalid";
}

/**
 * Quote a value for a PostgREST logical-filter string (`or=(...)`). Reserved characters
 * (`,` `.` `:` `(` `)`) are legal inside double quotes; `"` and `\` are backslash-escaped.
 * Every user- or cursor-derived value that goes into `.or()` passes through here.
 */
export function pgrstQuote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Free-text search term for ILIKE. LIKE wildcards (`%`, `_`) and PostgREST's `*` are
 * stripped so the caller cannot widen the match; quotes/backslashes would be escaped anyway
 * but carry no meaning in a name search. Returns null below 2 meaningful characters.
 */
export function sanitizeSearch(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[%_*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return s.length >= 2 ? s : null;
}

/** Opaque keyset cursor over (created_at DESC, id DESC). */
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify([c.createdAt, c.id])).replace(/=+$/, "");
}

export function decodeCursor(v: unknown): Cursor | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  try {
    const [createdAt, id] = JSON.parse(atob(v)) as unknown[];
    if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) return "invalid";
    if (typeof id !== "string" || !UUID_RE.test(id)) return "invalid";
    return { createdAt, id };
  } catch {
    return "invalid";
  }
}

/** `or=(...)` clause that continues a (created_at DESC, id DESC) scan after `c`. */
export function keysetAfter(c: Cursor): string {
  const t = pgrstQuote(c.createdAt);
  return `created_at.lt.${t},and(created_at.eq.${t},id.lt.${c.id})`;
}

/**
 * AND several `or`-groups into ONE `.or()` argument. supabase-js appends a separate `or=`
 * query param per `.or()` call; rather than depend on how PostgREST combines repeated logic
 * params, the groups are nested explicitly: `and(or(a),or(b))`.
 */
export function combineOrGroups(groups: string[]): string | null {
  const g = groups.filter((x) => x.length > 0);
  if (g.length === 0) return null;
  if (g.length === 1) return g[0];
  return `and(${g.map((x) => `or(${x})`).join(",")})`;
}

/** Truncate long free text (message bodies, notes) so a single row cannot dominate. */
export function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  return v.length > max ? v.slice(0, max) + "…" : v;
}
