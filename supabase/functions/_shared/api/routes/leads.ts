/**
 * `GET /api/v1/leads` — keyset-paginated lead list (Slice 1, #794).
 *
 * Delegates filtering/pagination to the `api_list_leads` RPC (which scopes by
 * org server-side). The handler parses the allowlisted query, requests one
 * extra row to detect `has_more`, and serializes rows to the public shape —
 * stripping internal columns so they can never leak.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiList, apiResource } from "../responses.ts";
import { parseLeadFilters, parseLimit } from "../filters.ts";
import { decodeCursor, paginateByCursor } from "../cursor.ts";

/** Minimal Supabase surface the handler needs (keeps it injectable/testable). */
interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown }>;
}

interface LeadRow {
  id: string;
  created_at: string;
  [key: string]: unknown;
}

/** Public list-item shape — explicit allowlist (no internal columns). */
export function serializeLeadRow(row: LeadRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name ?? null,
    company: row.company ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    origin: row.origin ?? null,
    rating: row.rating ?? null,
    qualification_score: row.qualification_score ?? null,
    tier: row.tier_efetivo ?? null,
    tags: row.tags ?? [],
    responsible_id: row.responsible_id ?? null,
    sdr_id: row.sdr_id ?? null,
    closer_id: row.closer_id ?? null,
    sold: row.sold ?? false,
    sale_value: row.sale_value ?? null,
    created_at: row.created_at,
  };
}

export async function listLeads(ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(ctx.req.url);
  const filters = parseLeadFilters(url.searchParams);
  const limit = parseLimit(url.searchParams);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const supabase = ctx.supabase as RpcClient;

  const { data, error } = await supabase.rpc("api_list_leads", {
    p_org: ctx.organizationId,
    p_stage: filters.stage ?? null,
    p_tier: filters.tier ?? null,
    p_tag: filters.tag ?? null,
    p_origin: filters.origin ?? null,
    p_responsible_id: filters.responsible_id ?? null,
    p_created_from: filters.created_from ?? null,
    p_created_to: filters.created_to ?? null,
    p_q: filters.q ?? null,
    p_limit: limit + 1, // +1 to detect has_more
    p_cursor_created_at: cursor?.created_at ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    return apiError(500, "internal_error", "Erro ao listar leads", ctx.cors);
  }

  const rows = (data ?? []) as LeadRow[];
  const { page, nextCursor } = paginateByCursor(rows, limit);
  return apiList(page.map(serializeLeadRow), nextCursor, ctx.cors);
}

/** `GET /api/v1/leads/{id}` — lead 360 (tier, tags, custom fields, pipes). */
export async function getLead(ctx: ApiRouteContext): Promise<Response> {
  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc("api_get_lead", {
    p_org: ctx.organizationId,
    p_lead_id: ctx.params.id,
  });
  if (error) return apiError(500, "internal_error", "Erro ao buscar lead", ctx.cors);
  if (data == null) return apiError(404, "not_found", "Lead não encontrado", ctx.cors);
  return apiResource(data, ctx.cors);
}

/** `GET /api/v1/leads/{id}/timeline` — keyset-paginated lead_history. */
export async function getLeadTimeline(ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(ctx.req.url);
  const limit = parseLimit(url.searchParams);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const supabase = ctx.supabase as RpcClient;

  const { data, error } = await supabase.rpc("api_lead_timeline", {
    p_org: ctx.organizationId,
    p_lead_id: ctx.params.id,
    p_limit: limit + 1,
    p_cursor_created_at: cursor?.created_at ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) return apiError(500, "internal_error", "Erro ao buscar timeline", ctx.cors);

  const rows = (data ?? []) as Array<{ created_at: string; id: string; [k: string]: unknown }>;
  const { page, nextCursor } = paginateByCursor(rows, limit);
  return apiList(page, nextCursor, ctx.cors);
}
