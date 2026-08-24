/**
 * `POST /api/v1/deals` — abertura de Negócio pela API pública. (#1769)
 *
 * ── A CRIAÇÃO É ESTRITA ───────────────────────────────────────────────────
 * Exige um Lead que JÁ EXISTE, no estilo Pipedrive. Não aceita Lead embutido:
 * quem integra faz procurar → criar Lead → abrir Negócio, e é o `POST /leads`
 * que garante, com o 409, que ninguém crie uma segunda pessoa por engano.
 *
 * Aceitar Lead embutido aqui abriria um segundo caminho de criação de pessoa,
 * fora daquela garantia — por isso a recusa é explícita e não silenciosa.
 *
 * ── PROCEDÊNCIA NÃO É OPCIONAL NESTE CAMINHO ──────────────────────────────
 * Um Negócio nascido da API tem de dizer que nasceu da API. O handler grava
 * `api` sempre; não existe como o chamador pedir outra coisa. Deixar isso ao
 * corpo da requisição seria abrir, no primeiro dia, o buraco que a decisão 4 do
 * ADR-0030 existe para fechar.
 *
 * ── SEGUNDO NEGÓCIO ABERTO NO MESMO FUNIL: CRIA E SINALIZA ────────────────
 * É legal pelo modelo — é assim que recompra se representa (ADR-0023 decisão 2).
 * Mas o caso comum não é recompra, é a mesma pessoa preenchendo o mesmo anúncio
 * duas vezes. A resposta traz o aviso; a marca na tela é o #1773, e sem ela o
 * aviso é enfeite, porque ninguém lê campo em resposta de sucesso.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiResource } from "../responses.ts";

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

interface CreateDealResult {
  status?: string;
  deal?: Record<string, unknown>;
  warning?: Record<string, unknown>;
}

/**
 * Traduz o erro do banco em erro de API.
 *
 * Sem isto, "funil não existe" e "lead de outra organização" chegariam ao
 * integrador como 500 — e 500 diz "problema nosso, tente de novo", que é
 * conselho errado para quem digitou o funil errado.
 */
function traduzErro(err: unknown): { status: number; code: string; message: string } {
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? "";

  if (e?.code === "P0002" || /não encontrado|nao encontrado/i.test(msg)) {
    return { status: 404, code: "lead_not_found", message: "Lead não encontrado nesta organização" };
  }
  if (e?.code === "22023" || /não abre negócio|nao abre negocio|funil/i.test(msg)) {
    return {
      status: 422,
      code: "invalid_pipeline_or_stage",
      message: "Funil ou etapa inválidos para abertura de Negócio",
    };
  }
  if (e?.code === "23514" || /não pertence|nao pertence|Procedência/i.test(msg)) {
    return { status: 422, code: "invalid_value", message: msg || "Valor inválido" };
  }
  return { status: 500, code: "internal_error", message: "Erro ao abrir negócio" };
}

export async function createDeal(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }

  if ("lead" in body) {
    return apiError(
      422,
      "inline_lead_not_supported",
      "Informe lead_id de um Lead existente. Para criar a pessoa, use POST /api/v1/leads.",
      ctx.cors,
    );
  }

  const leadId = body.lead_id;
  if (typeof leadId !== "string" || leadId.length === 0) {
    return apiError(422, "missing_lead_id", "lead_id é obrigatório", ctx.cors);
  }

  const supabase = ctx.supabase as unknown as RpcClient;
  const { data, error } = await supabase.rpc("api_create_deal", {
    p_org: ctx.organizationId,
    p_lead_id: leadId,
    p_pipe: body.pipeline ?? null,
    p_stage: body.stage ?? null,
    p_owner_id: body.owner_id ?? null,
    p_value: body.value ?? null,
    p_title: body.title ?? null,
    p_notes: body.notes ?? null,
    // Fixo. O chamador não escolhe a Procedência do próprio Negócio.
    p_source: "api",
    p_idempotency_key: ctx.req.headers.get("Idempotency-Key"),
  });

  if (error) {
    const t = traduzErro(error);
    return apiError(t.status, t.code, t.message, ctx.cors);
  }

  const result = (data ?? {}) as CreateDealResult;
  const corpo: Record<string, unknown> = { ...(result.deal ?? {}) };
  if (result.warning) corpo.warning = result.warning;

  // Replay não é criação: 201 afirmaria que esta requisição abriu o Negócio,
  // quando ela só recebeu de volta o que a primeira abriu.
  return apiResource(corpo, ctx.cors, result.status === "replayed" ? 200 : 201);
}
