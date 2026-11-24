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

/**
 * A tool result as compact JSON (the reader is a model: indentation only costs context).
 * Over the ceiling it is shrunk by `fitToBudget`, never sliced mid-structure — a result the
 * model cannot parse is worse than a shorter one that says what was left out.
 */
export function jsonResult(value: unknown): ToolResult {
  let text = JSON.stringify(value) ?? "null";
  if (text.length > MAX_RESULT_CHARS) text = JSON.stringify(fitToBudget(value, MAX_RESULT_CHARS));
  return { content: [{ type: "text", text }] };
}

type Path = Array<string | number>;
interface Target {
  path: Path;
  size: number;
  isArray: boolean;
}

/** The biggest shrinkable node: an array of 2+ items beats any string; then by size. */
function biggest(v: unknown, path: Path, best: Target | null): Target | null {
  const better = (t: Target) =>
    !best || (t.isArray && !best.isArray) || (t.isArray === best.isArray && t.size > best.size);
  if (typeof v === "string") {
    const t = { path, size: v.length, isArray: false };
    return v.length > 40 && better(t) ? t : best; // short strings are not worth clipping
  }
  if (Array.isArray(v)) {
    const t = { path, size: JSON.stringify(v).length, isArray: true };
    if (v.length > 1 && better(t)) best = t;
    v.forEach((x, i) => (best = biggest(x, [...path, i], best)));
    return best;
  }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) best = biggest(x, [...path, k], best);
  }
  return best;
}

/**
 * Shrink `value` until its JSON fits `max`, keeping it valid: halve the biggest array (its
 * tail goes), and only when no array has 2+ items left, halve the longest string. What was
 * cut is listed in `_truncated.cut` (path → original length). Pure.
 */
export function fitToBudget(value: unknown, max: number): Record<string, unknown> {
  const holder: Record<string, unknown> = { r: JSON.parse(JSON.stringify(value ?? null)) };
  const cut: Record<string, number> = {};
  const shaped = () => {
    const r = holder.r;
    const base = r && typeof r === "object" && !Array.isArray(r)
      ? r as Record<string, unknown>
      : { result: r };
    return {
      ...base,
      _truncated: { cut, hint: "Result too large: narrow the query (filters, limit) or page." },
    };
  };
  for (let i = 0; i < 400 && JSON.stringify(shaped()).length > max; i++) {
    const t = biggest(holder.r, ["r"], null);
    if (!t) break;
    const parent = t.path.slice(0, -1).reduce<Record<string | number, unknown>>(
      (o, k) => o[k] as Record<string | number, unknown>,
      holder,
    );
    const last = t.path[t.path.length - 1];
    const cur = parent[last] as unknown[] | string;
    cut[t.path.slice(1).join(".") || "(root)"] ??= cur.length;
    parent[last] = Array.isArray(cur)
      ? cur.slice(0, Math.ceil(cur.length / 2))
      : `${cur.slice(0, Math.floor(cur.length / 2))}…`;
  }
  return shaped();
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

/**
 * "Stalled since before X" over COALESCE(stage_changed_at, entered_at, created_at) — the
 * definition the funnel board uses — as one PostgREST `or` group.
 */
export function idleOrFilter(cutoffIso: string): string {
  const q = pgrstQuote(cutoffIso);
  return `stage_changed_at.lt.${q},` +
    `and(stage_changed_at.is.null,entered_at.lt.${q}),` +
    `and(stage_changed_at.is.null,entered_at.is.null,created_at.lt.${q})`;
}

/** Whether a WhatsApp message was sent by the org. Both spellings exist in the data. */
export function isFromUs(direction: string | null | undefined): boolean {
  return direction === "outgoing" || direction === "outbound";
}

/** `fn` over `items` with at most `limit` in flight; results in input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => PromiseLike<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A semaphore: `run(fn)` starts `fn` once fewer than `limit` runs are in flight. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        // through a promise, so a synchronous throw also releases the slot
        Promise.resolve().then(fn).then(resolve, reject).finally(release);
      };
      if (active < limit) start();
      else queue.push(start);
    });
}
