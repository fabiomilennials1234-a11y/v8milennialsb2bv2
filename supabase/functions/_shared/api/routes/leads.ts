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

/**
 * `rating` está DEPRECADO e sai do payload em 2026-11-03 (SCRUM-647, Etapa 2).
 *
 * Até lá a chave continua no JSON, sempre `null`. Não é meio-termo por
 * indecisão — é a única transição que não mente e não quebra:
 *
 *   * `null` JÁ É um valor legal desta chave hoje: 208 leads em 18 orgs têm
 *     `rating IS NULL` em produção. Todo consumidor correto já trata esse caso.
 *     Passar a devolver `null` para todos não introduz um estado novo, só
 *     generaliza um que a API sempre emitiu.
 *   * SUMIR com a chave, esse sim, é o estado novo: quebra validador de schema
 *     estrito e cliente gerado a partir da `openapi.json` — que é exatamente o
 *     público que respeita o contrato. Punir quem integrou direito é o pior
 *     resultado possível de uma remoção.
 *
 * Ao fim da janela: apagar esta linha e a entrada correspondente na
 * `public/api/openapi.json`. Nada mais depende dela.
 */
const RATING_DEPRECADO = null;

/** Public list-item shape — explicit allowlist (no internal columns). */
export function serializeLeadRow(row: LeadRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name ?? null,
    company: row.company ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    origin: row.origin ?? null,
    rating: RATING_DEPRECADO,
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

/**
 * `GET /api/v1/leads/search` — lookup por telefone ou e-mail.
 *
 * O passo de dedup que todo conector faz antes de criar. Com a criação de
 * Negócio estrita (exige `lead_id` de um Lead que já existe), é esta rota que
 * impede a integração ingênua de criar uma segunda pessoa: ela pergunta antes.
 *
 * Devolve LISTA, e isso é decisão, não descuido — um telefone pode casar mais de
 * um Lead, e esconder isso atrás de um resultado único faria a rota mentir
 * justamente onde a duplicata mora.
 */
export async function searchLeads(ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(ctx.req.url);
  const phone = url.searchParams.get("phone");
  const email = url.searchParams.get("email");
  const limit = parseLimit(url.searchParams);

  // Sem alvo, isto seria varredura, não busca — e um parâmetro escrito errado no
  // node viraria "liste tudo" em silêncio. Quem quer a base inteira usa
  // `GET /leads`, que é paginado por cursor.
  if (!phone && !email) {
    return apiError(
      422,
      "missing_search_criteria",
      "Informe ao menos phone ou email",
      ctx.cors,
    );
  }

  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc("api_search_leads", {
    p_org: ctx.organizationId,
    p_phone: phone,
    p_email: email,
    p_limit: limit,
  });

  if (error) {
    return apiError(500, "internal_error", "Erro ao buscar leads", ctx.cors);
  }

  const rows = (data ?? []) as LeadRow[];
  return apiList(rows.map(serializeLeadRow), null, ctx.cors);
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
