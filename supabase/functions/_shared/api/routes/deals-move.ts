/**
 * `POST /api/v1/deals/{id}/move` — mover Negócio de etapa ou de funil. (#1770)
 *
 * ── MOVER É MOVER, NÃO COPIAR ─────────────────────────────────────────────
 * ADR-0023 decisão 4. Antes deste modelo, chegar na etapa de sucesso fazia DUAS
 * escritas — atualizava a origem e inseria um card novo no destino — e o gêmeo
 * ficava para trás. Era ele que fazia o mesmo Lead aparecer em Qualificação e em
 * Orçamentos ao mesmo tempo. A função de banco `mover_negocio` troca o funil na
 * MESMA linha; nenhum card novo nasce.
 *
 * ── QUALQUER FUNIL É DESTINO VÁLIDO (SCRUM-625) ───────────────────────────
 * `pipeline` aceita o id (uuid) ou o slug de qualquer funil da org — sistema ou
 * personalizado. A recusa antiga de funil custom morreu com a inversão do silo
 * (SCRUM-621): o card vive em `pipeline_entries` seja qual for o funil, então
 * mover é o mesmo UPDATE na mesma linha e nenhum histórico se perde. Funil que
 * não existe é 404 e funil inativo é 409 — os MESMOS códigos que o lead-webhook
 * dá para o mesmo erro (SCRUM-624), porque o integrador é o mesmo.
 *
 * ── POR QUE ESTA ROTA E NÃO O PATCH ───────────────────────────────────────
 * Mover tem regra; editar não. Aceitar `stage` no PATCH daria um segundo
 * caminho, sem a recusa do funil custom e sem a garantia de posição única.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiResource } from "../responses.ts";
import { serializeDealRow } from "./deals.ts";

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

/**
 * Traduz o erro do banco.
 *
 * Como 500, o integrador leria "problema nosso, tente de novo" — conselho errado
 * para quem mandou um funil que não existe, e que faria o node do n8n retentar
 * em laço contra uma requisição que nunca vai dar certo.
 */
function traduzErro(err: unknown): { status: number; code: string; message: string } {
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? "";

  // As mensagens do resolvedor têm prioridade sobre o SQLSTATE: 22023 tanto
  // carrega "funil não existe" (endereço errado → 404, como no lead-webhook)
  // quanto "etapa inválida" (corpo errado → 422). O prefixo da mensagem — Funil,
  // Negócio, Etapa — é o discriminador estável.
  if (/^funil .*não existe/i.test(msg)) {
    return { status: 404, code: "pipeline_not_found", message: msg || "Funil não existe nesta organização" };
  }
  if (e?.code === "55000" || /^funil .*está inativo/i.test(msg)) {
    return { status: 409, code: "pipeline_inactive", message: msg || "Funil está inativo nesta organização" };
  }
  if (e?.code === "P0002" || /não encontrado|nao encontrado|não tem posição/i.test(msg)) {
    return { status: 404, code: "deal_not_found", message: "Negócio não encontrado nesta organização" };
  }
  if (e?.code === "22023" || e?.code === "23514") {
    return { status: 422, code: "invalid_pipeline_or_stage", message: msg || "Funil ou etapa inválidos" };
  }
  return { status: 500, code: "internal_error", message: "Erro ao mover negócio" };
}

export async function moveDeal(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }

  // Recusa antes de chegar ao banco, com código próprio para cada ausência: um
  // erro genérico obrigaria quem integra a adivinhar qual dos dois faltou.
  const pipeline = body.pipeline;
  if (typeof pipeline !== "string" || pipeline.length === 0) {
    return apiError(422, "missing_pipeline", "pipeline é obrigatório", ctx.cors);
  }
  const stage = body.stage;
  if (typeof stage !== "string" || stage.length === 0) {
    return apiError(422, "missing_stage", "stage é obrigatório", ctx.cors);
  }

  const supabase = ctx.supabase as unknown as RpcClient;
  const { data, error } = await supabase.rpc("api_move_deal", {
    p_org: ctx.organizationId,
    p_deal_id: ctx.params.id,
    p_pipeline: pipeline,
    p_stage: stage,
    p_owner_id: body.owner_id ?? null,
  });

  if (error) {
    const t = traduzErro(error);
    return apiError(t.status, t.code, t.message, ctx.cors);
  }

  if (!data) {
    return apiError(404, "deal_not_found", "Negócio não encontrado nesta organização", ctx.cors);
  }

  // Devolve a posição NOVA. Devolver a antiga faria o conector achar que o move
  // não aconteceu, e retentar.
  return apiResource(serializeDealRow(data as Parameters<typeof serializeDealRow>[0]), ctx.cors);
}
