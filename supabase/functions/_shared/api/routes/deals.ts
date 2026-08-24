/**
 * `GET /api/v1/deals` e `GET /api/v1/deals/{id}` — leitura de Negócio. (#1767)
 *
 * ── O CURSOR É PELA ÚLTIMA ATIVIDADE ──────────────────────────────────────
 * E não pela criação, como o de Leads. A coluna existe e é indexada desde #1766
 * (`idx_deals_org_last_activity`), e é a que o `updated_since` do #1771 vai
 * usar. Paginar por criação agora e trocar depois seria quebra de contrato
 * público: o cliente guarda o cursor entre chamadas, e cursor que muda de chave
 * faz o polling pular ou repetir registro silenciosamente.
 *
 * ── UM NEGÓCIO DE OUTRA ORG É 404, NÃO 403 ────────────────────────────────
 * Inexistente e alheio têm de ser indistinguíveis de fora. 403 no segundo caso
 * confirmaria ao chamador que aquele identificador existe em alguma organização
 * — que é informação que ele não deveria conseguir extrair.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiList, apiResource } from "../responses.ts";
import { decodeCursor, paginateByCursor } from "../cursor.ts";
import { parseLimit } from "../filters.ts";

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown }>;
}

interface DealRow {
  id: string;
  /** Chave do cursor. Ver o cabeçalho: última atividade, não criação. */
  last_activity_at: string;
  created_at?: string | null;
  title?: string | null;
  value?: number | null;
  source?: string | null;
  won?: boolean | null;
  closed_at?: string | null;
  loss_reason?: string | null;
  owner_id?: string | null;
  source_lead_id?: string | null;
  pipeline_slug?: string | null;
  stage_key?: string | null;
}

/**
 * `pipeline_slug`/`stage_key` viram `pipeline`/`stage` no corpo.
 *
 * Os nomes de coluna do banco carregam história (`stage_key` é chave textual
 * porque o funil de sistema não tem tabela de etapas própria). O contrato
 * público não precisa herdar isso.
 */
export function serializeDealRow(r: DealRow): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title ?? null,
    value: r.value ?? null,
    lead_id: r.source_lead_id ?? null,
    owner_id: r.owner_id ?? null,
    pipeline: r.pipeline_slug ?? null,
    stage: r.stage_key ?? null,
    source: r.source ?? null,
    won: r.won ?? null,
    loss_reason: r.loss_reason ?? null,
    closed_at: r.closed_at ?? null,
    created_at: r.created_at ?? null,
    last_activity_at: r.last_activity_at,
  };
}

export async function listDeals(ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(ctx.req.url);
  const limit = parseLimit(url.searchParams);
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  const supabase = ctx.supabase as unknown as RpcClient;
  const { data, error } = await supabase.rpc("api_list_deals", {
    p_org: ctx.organizationId,
    p_pipeline: url.searchParams.get("pipeline"),
    p_stage: url.searchParams.get("stage"),
    p_owner_id: url.searchParams.get("owner_id"),
    p_status: url.searchParams.get("status"),
    p_limit: limit + 1, // +1 para saber se há próxima página
    p_cursor_last_activity: cursor?.created_at ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    // Erro de leitura NÃO pode virar lista vazia: quem sincroniza leria "nada
    // mudou" e seguiria em frente, perdendo a janela para sempre.
    return apiError(500, "internal_error", "Erro ao listar negócios", ctx.cors);
  }

  const rows = (data ?? []) as DealRow[];
  // `paginateByCursor` é tipado sobre `created_at`; aqui a chave de ordenação é
  // a última atividade. Alimenta com ela, para o token carregar a chave certa.
  const paraCursor = rows.map((r) => ({ ...r, created_at: r.last_activity_at }));
  const { page, nextCursor } = paginateByCursor(paraCursor, limit);

  return apiList(page.map((r) => serializeDealRow(r as unknown as DealRow)), nextCursor, ctx.cors);
}

export async function getDeal(ctx: ApiRouteContext): Promise<Response> {
  const supabase = ctx.supabase as unknown as RpcClient;
  const { data, error } = await supabase.rpc("api_get_deal", {
    // A organização vem do contexto (resolvida da chave), nunca do caminho.
    p_org: ctx.organizationId,
    p_deal_id: ctx.params.id,
  });

  if (error) return apiError(500, "internal_error", "Erro ao ler negócio", ctx.cors);

  if (!data) {
    return apiError(404, "deal_not_found", "Negócio não encontrado", ctx.cors);
  }

  return apiResource(serializeDealRow(data as DealRow), ctx.cors);
}
