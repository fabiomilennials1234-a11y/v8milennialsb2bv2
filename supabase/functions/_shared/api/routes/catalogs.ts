/**
 * Catalog endpoints (Slice 2, #795) — small, non-paginated lists scoped by org.
 *
 *   GET /api/v1/pipelines      (scope pipeline:read) — pipelines + stages
 *   GET /api/v1/tags           (scope metadata:read)
 *   GET /api/v1/custom-fields  (scope metadata:read) — field definitions
 *
 * Each delegates to a SECURITY DEFINER RPC that filters by p_org. Returned in
 * the list envelope with no cursor (catalogs are bounded).
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiList } from "../responses.ts";

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown }>;
}

async function catalog(ctx: ApiRouteContext, rpc: string): Promise<Response> {
  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc(rpc, { p_org: ctx.organizationId });
  if (error) {
    return apiError(500, "internal_error", "Erro ao buscar catálogo", ctx.cors);
  }
  return apiList((data ?? []) as unknown[], null, ctx.cors);
}

export const listPipelines = (ctx: ApiRouteContext) => catalog(ctx, "api_list_pipelines");
export const listTags = (ctx: ApiRouteContext) => catalog(ctx, "api_list_tags");
export const listCustomFields = (ctx: ApiRouteContext) => catalog(ctx, "api_list_custom_fields");
