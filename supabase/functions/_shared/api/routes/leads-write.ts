/**
 * Write endpoints (P2 — Slices 3-5, #796/#797/#798).
 *
 *   PATCH  /api/v1/leads/{id}                (lead:write)
 *   POST   /api/v1/leads/{id}/stage          (lead:write) — reuses moveStage
 *   POST   /api/v1/leads/{id}/tags           (lead:write)
 *   DELETE /api/v1/leads/{id}/tags/{tag}     (lead:write)
 *   PUT    /api/v1/leads/{id}/custom-fields  (lead:write)
 *
 * Field/tag/custom writes go through org-scoped SECURITY DEFINER RPCs that
 * verify the lead belongs to p_org (closing the org gap in the raw
 * action-handlers). Stage moves reuse the moveStage action-handler so the API
 * fires the same workflows / meeting_events / auto-Orçamentos as the UI
 * (ADR-0008 decision 5). DB triggers fire regardless of path.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiResource } from "../responses.ts";
import { moveStage } from "../../action-handlers/move-stage.ts";
import { getOrgDefaultPipelineRef } from "../../pipeline-destination.ts";
import type { ActionInput, ActionResult } from "../../action-handlers/types.ts";

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown }>;
}

const INVALID = Symbol("invalid-json");

async function readJson(req: Request): Promise<unknown | typeof INVALID> {
  try {
    return await req.json();
  } catch {
    return INVALID;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const TIERS = ["diamante", "ouro", "prata", "bronze", "desqualificado"];

// Public field name → leads column. Campos personalizados de verdade continuam
// fora daqui — vão por PUT /custom-fields.
// `segment`, `faturamento` e os cinco UTM são COLUNAS de `leads`, não campos
// personalizados — 5.181 leads com utm_campaign e 9.987 com segment nos últimos
// 90 dias, lidos por 11 arquivos do front e 3 funções do banco. Gravá-los em
// outro lugar deixaria a tela vazia para todo lead novo, sem erro nenhum
// aparecendo. Entraram aqui para que a migração dos cenários do Make preserve o
// que o `lead-webhook` já gravava.
const TEXT_FIELDS = [
  "name", "company", "email", "phone", "notes",
  "segment", "faturamento",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
];
// `rating` saiu daqui (SCRUM-647, Etapa 2): a coluna `leads.rating` foi
// aposentada. A chave continua ACEITA no corpo do PATCH e passa a ser
// ignorada — o laço abaixo só olha os campos desta lista, então uma chave
// desconhecida já é descartada em silêncio, sem 422.
//
// Ignorar em vez de recusar é decisão, não descuido: quem envia `rating` envia
// junto com `name`, `phone` e o resto. Um 422 reprovaria o PATCH INTEIRO por
// causa de um campo aposentado, e a integração perderia a atualização toda.
// O aviso às orgs (.specs/features/funis-unificacao/aviso-remocao-rating.md) é
// o canal para contar que o campo saiu; a API não é lugar de dar essa notícia
// derrubando escrita boa.
const NUM_FIELDS = ["qualification_score"];
const UUID_FIELDS = [
  "responsible_id", "sdr_id", "closer_id",
  "pre_sale_responsible_id", "sale_responsible_id",
];

/** PATCH /leads/{id} — partial update of allowlisted lead columns. */
export async function patchLead(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }

  const patch: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) if (f in body) patch[f] = body[f] == null ? null : String(body[f]);
  for (const f of NUM_FIELDS) {
    if (f in body) {
      const n = Number(body[f]);
      if (!Number.isFinite(n)) return apiError(422, "invalid_value", `Campo ${f} deve ser numérico`, ctx.cors);
      patch[f] = n;
    }
  }
  for (const f of UUID_FIELDS) if (f in body) patch[f] = body[f] == null ? null : String(body[f]);
  if ("tier" in body) {
    const t = String(body.tier);
    if (!TIERS.includes(t)) {
      return apiError(422, "invalid_tier", `tier inválido. Válidos: ${TIERS.join(", ")}`, ctx.cors);
    }
    patch.qualification_tier = t;
  }
  if ("pre_qualification_tier" in body) {
    const t = String(body.pre_qualification_tier);
    if (!TIERS.includes(t)) {
      return apiError(422, "invalid_tier", `pre_qualification_tier inválido`, ctx.cors);
    }
    patch.pre_qualification_tier = t;
  }

  if (Object.keys(patch).length === 0) {
    return apiError(422, "no_valid_fields", "Nenhum campo editável fornecido", ctx.cors);
  }

  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc("api_update_lead", {
    p_org: ctx.organizationId,
    p_lead_id: ctx.params.id,
    p_patch: patch,
  });
  if (error) return apiError(500, "internal_error", "Erro ao atualizar lead", ctx.cors);

  const r = (data ?? {}) as { ok?: boolean; code?: string; lead?: unknown; field?: string };
  if (!r.ok) {
    if (r.code === "not_found") return apiError(404, "not_found", "Lead não encontrado", ctx.cors);
    if (r.code === "invalid_responsible") {
      return apiError(422, "invalid_responsible", "Responsável não pertence à organização", ctx.cors, { field: r.field });
    }
    return apiError(422, r.code ?? "update_failed", "Falha ao atualizar lead", ctx.cors);
  }
  return apiResource(r.lead, ctx.cors);
}

type Mover = (input: ActionInput) => Promise<ActionResult>;

/** POST /leads/{id}/stage — reuses moveStage (mover injectable for tests). */
export async function moveLeadStage(
  ctx: ApiRouteContext,
  mover: Mover = moveStage,
): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }
  // SCRUM-641: `pipe` omitido cai no funil PADRÃO da org (D4), não mais no
  // literal 'whatsapp'. Para as orgs antigas é o mesmo funil (106/108 têm o
  // default apontando o whatsapp semeado); org sem funil padrão mantém o
  // literal legado — que, sem o funil, vira o erro tipado do adapter (D6).
  const pipe = typeof body.pipe === "string" && body.pipe
    ? body.pipe
    : (await getOrgDefaultPipelineRef(ctx.supabase as never, ctx.organizationId)) ?? "whatsapp";
  const stage = body.stage;
  if (typeof stage !== "string" || !stage) {
    return apiError(400, "missing_stage", "Campo 'stage' é obrigatório", ctx.cors);
  }

  const supabase = ctx.supabase as RpcClient;
  const { data: exists, error } = await supabase.rpc("api_lead_exists", {
    p_org: ctx.organizationId,
    p_lead_id: ctx.params.id,
  });
  if (error) return apiError(500, "internal_error", "Erro ao verificar lead", ctx.cors);
  if (!exists) return apiError(404, "not_found", "Lead não encontrado", ctx.cors);

  const result = await mover({
    // deno-lint-ignore no-explicit-any
    supabase: ctx.supabase as any,
    organizationId: ctx.organizationId,
    leadId: ctx.params.id,
    // `PATCH /leads/:id/pipeline` move o LEAD por definição — a rota recebe o id
    // da pessoa e não o do negócio. Mover um negócio específico é rota própria
    // (`/deals`), não um parâmetro escondido aqui.
    entryId: null,
    dealId: null,
    conversationId: null,
    params: { target_pipe: pipe, target_stage: stage },
  });
  if (!result.success) {
    return apiError(422, "stage_move_failed", result.error ?? "Falha ao mover etapa", ctx.cors);
  }
  return apiResource({ moved: true, ...(result.data ?? {}) }, ctx.cors);
}

/** POST /leads/{id}/tags — add tags by name (creates missing). */
export async function addLeadTags(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body) || !Array.isArray(body.tags)) {
    return apiError(400, "invalid_body", "Esperado { tags: [...] }", ctx.cors);
  }
  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc("api_add_lead_tags", {
    p_org: ctx.organizationId,
    p_lead_id: ctx.params.id,
    p_tags: body.tags,
  });
  if (error) return apiError(500, "internal_error", "Erro ao adicionar tags", ctx.cors);
  const r = (data ?? {}) as { ok?: boolean; code?: string; tags?: unknown };
  if (!r.ok) return apiError(404, "not_found", "Lead não encontrado", ctx.cors);
  return apiResource({ tags: r.tags ?? [] }, ctx.cors);
}

/** DELETE /leads/{id}/tags/{tag} — remove a tag by name. */
export async function removeLeadTag(ctx: ApiRouteContext): Promise<Response> {
  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc("api_remove_lead_tag", {
    p_org: ctx.organizationId,
    p_lead_id: ctx.params.id,
    p_tag: ctx.params.tag,
  });
  if (error) return apiError(500, "internal_error", "Erro ao remover tag", ctx.cors);
  const r = (data ?? {}) as { ok?: boolean };
  if (!r.ok) return apiError(404, "not_found", "Lead não encontrado", ctx.cors);
  return apiResource({ removed: true }, ctx.cors);
}

/** PUT /leads/{id}/custom-fields — set values for existing fields (422 if unknown). */
export async function putCustomFields(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto { campo: valor }", ctx.cors);
  }
  // `create_missing=true` cria como `text` o campo que ainda não existe, em vez
  // de recusar com 422. O caminho do integrador é o inverso do nosso: ele tem o
  // valor na mão (a resposta de um formulário) e descobre no envio que o campo
  // não estava cadastrado — sem isto, teria que parar o cenário, abrir o CRM,
  // criar o campo e voltar. Continua sendo opt-in: sem o parâmetro, campo
  // desconhecido segue recusado, e quem não quer estrutura nascendo por
  // integração não precisa fazer nada.
  const criarAusentes = new URL(ctx.req.url).searchParams.get("create_missing") === "true";
  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc(
    criarAusentes ? "api_set_custom_fields_creating" : "api_set_custom_fields",
    {
      p_org: ctx.organizationId,
      p_lead_id: ctx.params.id,
      p_values: body,
    },
  );
  if (error) return apiError(500, "internal_error", "Erro ao salvar campos", ctx.cors);
  const r = (data ?? {}) as { ok?: boolean; code?: string; unknown_fields?: unknown };
  if (!r.ok) {
    if (r.code === "unknown_field") {
      return apiError(422, "unknown_field", "Campo customizado inexistente", ctx.cors, {
        unknown_fields: r.unknown_fields ?? [],
      });
    }
    return apiError(404, "not_found", "Lead não encontrado", ctx.cors);
  }
  return apiResource({ updated: true }, ctx.cors);
}
