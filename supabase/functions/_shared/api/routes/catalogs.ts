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

/**
 * `GET /pipelines?only_active_stages=true` devolve, em cada funil, apenas as
 * etapas que o cliente enxerga na tela.
 *
 * O produto esconde etapa desativada: a tela filtra `is_active = true` e ordena
 * por `position` (`usePipelineStages`). O catálogo não filtrava, então quem
 * integra via API via etapas que não existem para o usuário — na org Milennials
 * são 15 inativas contra 16 ativas só no funil de Qualificação, com nomes
 * repetidos entre as duas listas ("↩️ Remarcar" aparece nas duas). Um seletor
 * montado sobre isso deixa abrir Negócio numa etapa fora do kanban: a API aceita,
 * o card nasce, e ninguém o encontra na tela.
 *
 * O default segue trazendo tudo — o parâmetro é opt-in para não mudar o contrato
 * de quem já consome. O filtro é aqui e não no SQL de propósito: mexer na
 * assinatura de `api_list_pipelines` criaria uma sobrecarga da função, e o
 * PostgREST poderia resolver para a versão antiga em silêncio.
 */
export async function listPipelines(ctx: ApiRouteContext): Promise<Response> {
  const params = new URL(ctx.req.url).searchParams;
  const somenteAtivas = params.get("only_active_stages") === "true";
  // `pipeline` aceita as duas formas de endereçar um funil: slug (sistema) e id
  // (personalizado). Quem monta seletor de etapa quer UM funil, e filtrar aqui
  // evita que o cliente tenha que escolher a chave certa por tentativa.
  const funilAlvo = params.get("pipeline")?.trim() || null;
  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc("api_list_pipelines", { p_org: ctx.organizationId });
  if (error) {
    return apiError(500, "internal_error", "Erro ao buscar catálogo", ctx.cors);
  }

  let funis = (data ?? []) as Array<Record<string, unknown>>;
  if (funilAlvo) {
    funis = funis.filter((f) => f.slug === funilAlvo || f.id === funilAlvo);
  }
  if (!somenteAtivas) return apiList(funis, null, ctx.cors);

  const filtrados = funis.map((f) => {
    const etapas = Array.isArray(f.stages) ? (f.stages as Array<Record<string, unknown>>) : [];
    return { ...f, stages: etapas.filter((e) => e.is_active === true) };
  });
  return apiList(filtrados, null, ctx.cors);
}
export const listTags = (ctx: ApiRouteContext) => catalog(ctx, "api_list_tags");
/**
 * Membros da organização, para preencher os campos de responsável.
 *
 * Uma lista só, de propósito: o Torque não marca no membro quem é pré-venda e
 * quem é vendas — isso é decidido por Lead, e a mesma pessoa pode ser um num
 * Lead e outro no seguinte. `job_title` é texto livre e serve como dica, não
 * como filtro. É a mesma lista que a tela usa nos dois campos.
 */
export const listTeamMembers = (ctx: ApiRouteContext) => catalog(ctx, "api_list_team_members");
export const listCustomFields = (ctx: ApiRouteContext) => catalog(ctx, "api_list_custom_fields");
