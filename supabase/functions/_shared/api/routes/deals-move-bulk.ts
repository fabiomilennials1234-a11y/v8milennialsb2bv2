/**
 * `POST /api/v1/deals/move` — mover ATÉ 100 Negócios para a mesma etapa.
 *
 * ── POR QUE ESTA ROTA EXISTE ──────────────────────────────────────────────
 * Mover um Negócio já tinha rota. O que não existia era mover uma lista: quem
 * integra tinha um request por Negócio, contra um teto de 60–100 por minuto.
 * Mover mil Negócios custava mil chamadas — mais as mil de descoberta — e o
 * cenário do Make rodava vinte minutos para um trabalho de um clique na tela.
 *
 * ── O LAÇO É AQUI, NÃO NO BANCO ───────────────────────────────────────────
 * Uma função plpgsql que percorresse os cem seria UMA instrução, e o papel que
 * o PostgREST usa herda `statement_timeout=8s`. Cem movimentações — cada uma
 * disparando gatilho, workflow e histórico — passam desse teto com folga, e o
 * timeout mataria o lote inteiro no meio, deixando parte movida sem ninguém
 * saber qual parte. Um RPC por Negócio é uma instrução por Negócio: o teto
 * passa a valer por item.
 *
 * ── DELEGA PARA `api_move_deal`, SEM REIMPLEMENTAR MOVER ──────────────────
 * A mesma função de banco do move unitário, e portanto a mesma semântica:
 * mover é MOVER (ADR-0023 decisão 4), destino em funil customizado é recusado,
 * Negócio de outra organização é 404. Um segundo caminho de movimentação seria
 * um segundo lugar para a regra divergir.
 *
 * ── FALHA PARCIAL É VISÍVEL, NUNCA SILENCIOSA ─────────────────────────────
 * Um id inválido no meio da lista não pode abortar os outros noventa e nove,
 * nem ser engolido. Cada item traz o próprio veredito, e o corpo traz a
 * contagem. O status é 200 mesmo com falhas: a requisição foi processada, e é
 * o corpo que diz o que aconteceu com cada Negócio.
 *
 * ── ERRO DE DESTINO INTERROMPE ────────────────────────────────────────────
 * Funil ou etapa que não existem falham IGUAL para todos os itens — devolver
 * cem vezes o mesmo erro faria o chamador procurar defeito nos ids. Ao primeiro
 * erro de destino o lote para e responde 422, dizendo o que já tinha movido.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiResource } from "../responses.ts";
import { traduzErro } from "./deals-move.ts";

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown }>;
}

/** Mesmo teto do `?limit=` da listagem: uma página lida é uma página movida. */
export const TETO_LOTE = 100;

/**
 * Quantas movimentações em voo ao mesmo tempo.
 *
 * Baixo de propósito. O ganho de latência satura rápido, e cada movimentação
 * dispara gatilhos que tocam as mesmas linhas de funil e de lead — abrir muitas
 * em paralelo troca espera por disputa de lock.
 */
const EM_VOO = 4;

/** Erros que são do DESTINO, não do item: repetiriam idênticos em todo o lote. */
const ERRO_DE_DESTINO = new Set([
  "invalid_pipeline_or_stage",
  "custom_pipeline_not_supported",
]);

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

export interface ResultadoItem {
  deal_id: string;
  status: "moved" | "failed";
  pipeline?: string | null;
  stage?: string | null;
  error?: { code: string; message: string };
}

export async function moveDealsBulk(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }

  const brutos = body.deal_ids;
  if (!Array.isArray(brutos)) {
    return apiError(422, "missing_deal_ids", "deal_ids é obrigatório e deve ser uma lista", ctx.cors);
  }
  if (brutos.some((v) => typeof v !== "string" || v.trim().length === 0)) {
    return apiError(422, "invalid_deal_ids", "deal_ids deve conter apenas identificadores", ctx.cors);
  }

  // Repetido na lista é repetido no efeito: mover duas vezes o mesmo Negócio
  // grava duas passagens no histórico dele. Deduplica preservando a ordem.
  const ids = [...new Set((brutos as string[]).map((s) => s.trim()))];

  if (ids.length === 0) {
    return apiError(422, "empty_deal_ids", "deal_ids está vazio — não há o que mover", ctx.cors);
  }
  // Recusa em vez de mover os cem primeiros e calar sobre o resto: truncar em
  // silêncio faria o chamador acreditar que a lista inteira andou.
  if (ids.length > TETO_LOTE) {
    return apiError(
      422,
      "too_many_deals",
      `Máximo de ${TETO_LOTE} Negócios por chamada — recebidos ${ids.length}`,
      ctx.cors,
      { max: TETO_LOTE, received: ids.length },
    );
  }

  const pipeline = body.pipeline;
  if (typeof pipeline !== "string" || pipeline.length === 0) {
    return apiError(422, "missing_pipeline", "pipeline é obrigatório", ctx.cors);
  }
  const stage = body.stage;
  if (typeof stage !== "string" || stage.length === 0) {
    return apiError(422, "missing_stage", "stage é obrigatório", ctx.cors);
  }

  // Fixados fora do laço: o destino é o mesmo para o lote inteiro, e é o corpo
  // que o dita — não o item.
  const destino = { pipeline, stage, owner_id: body.owner_id ?? null };

  const supabase = ctx.supabase as unknown as RpcClient;
  const resultados: (ResultadoItem | undefined)[] = new Array(ids.length);
  const parada: { erro: { code: string; message: string } | null } = { erro: null };

  async function mover(indice: number): Promise<void> {
    const dealId = ids[indice];
    const { data, error } = await supabase.rpc("api_move_deal", {
      p_org: ctx.organizationId,
      p_deal_id: dealId,
      p_pipeline: destino.pipeline,
      p_stage: destino.stage,
      p_owner_id: destino.owner_id,
    });

    if (error) {
      const t = traduzErro(error);
      if (ERRO_DE_DESTINO.has(t.code)) parada.erro ??= { code: t.code, message: t.message };
      resultados[indice] = {
        deal_id: dealId,
        status: "failed",
        error: { code: t.code, message: t.message },
      };
      return;
    }
    if (!data) {
      resultados[indice] = {
        deal_id: dealId,
        status: "failed",
        error: { code: "deal_not_found", message: "Negócio não encontrado nesta organização" },
      };
      return;
    }

    const d = data as { pipeline_slug?: string | null; stage_key?: string | null };
    // Posição NOVA, item a item. O lote pede a mesma etapa para todos, mas quem
    // devolve é o banco: repetir o que foi pedido esconderia o dia em que a
    // função de destino resolver diferente do pedido.
    resultados[indice] = {
      deal_id: dealId,
      status: "moved",
      pipeline: d.pipeline_slug ?? null,
      stage: d.stage_key ?? null,
    };
  }

  // Pool de tamanho fixo. Cada trabalhador puxa o próximo índice livre; nenhum
  // começa item novo depois que o destino se provou inválido.
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(EM_VOO, ids.length) }, async () => {
    while (proximo < ids.length && parada.erro === null) {
      await mover(proximo++);
    }
  });
  await Promise.all(trabalhadores);

  const destinoInvalido = parada.erro;
  if (destinoInvalido !== null) {
    const movidos = resultados.filter((r) => r?.status === "moved").map((r) => r!.deal_id);
    return apiError(422, destinoInvalido.code, destinoInvalido.message, ctx.cors, {
      // O lote parou no meio, e omitir isto faria o chamador retentar a lista
      // inteira — movendo de novo o que já andou.
      moved: movidos,
      not_attempted: ids.length - resultados.filter(Boolean).length,
    });
  }

  const results = resultados.filter(Boolean) as ResultadoItem[];
  const moved = results.filter((r) => r.status === "moved").length;
  return apiResource({
    requested: ids.length,
    moved,
    failed: results.length - moved,
    results,
  }, ctx.cors);
}
