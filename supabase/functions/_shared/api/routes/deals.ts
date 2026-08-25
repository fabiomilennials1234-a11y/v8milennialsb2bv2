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
 * ── FILTRAR POR CRIAÇÃO NÃO É ORDENAR POR CRIAÇÃO ─────────────────────────
 * `created_from`/`created_to` recortam por `created_at` e NÃO mexem na ordem —
 * o keyset continua sendo a última atividade. Ordenar por criação só quando o
 * filtro aparecesse daria dois contratos de cursor na mesma rota, e o cursor é
 * opaco: quem pagina guarda a string e não tem como saber que a chave por trás
 * dela mudou.
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

/**
 * Instante de recorte, ou o erro de quem escreveu a data errado.
 *
 * Instante ilegível NÃO pode virar "sem corte". O conector receberia a base
 * inteira achando que recebeu só a fatia, e processaria tudo de novo — em fluxo
 * que dispara mensagem, isso é reenvio em massa para o cliente final.
 *
 * Normaliza para ISO: o banco compara timestamptz, e deixar o formato do
 * chamador chegar cru faria "2026-08-01" ser interpretado no fuso do servidor em
 * vez de UTC, deslocando o corte em três horas sem ninguém perceber.
 */
function instante(
  params: URLSearchParams,
  nome: string,
): { valor: string | null } | { erroCode: string } {
  const bruto = params.get(nome);
  if (bruto === null) return { valor: null };
  const t = Date.parse(bruto);
  if (Number.isNaN(t)) return { erroCode: `invalid_${nome}` };
  return { valor: new Date(t).toISOString() };
}

export async function listDeals(ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(ctx.req.url);
  const limit = parseLimit(url.searchParams);
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  // `updated_since` é ponteiro de sincronização (exclusivo, sobre a última
  // atividade); `created_from`/`created_to` são janela de CRIAÇÃO (inclusivos).
  // São perguntas diferentes e convivem: um Negócio criado ontem e editado hoje
  // entra nas duas.
  const cortes: Record<string, string | null> = {};
  for (const nome of ["updated_since", "created_from", "created_to"]) {
    const r = instante(url.searchParams, nome);
    if ("erroCode" in r) {
      return apiError(
        422,
        r.erroCode,
        `${nome} deve ser uma data ISO 8601, por exemplo 2026-08-01T00:00:00Z`,
        ctx.cors,
      );
    }
    cortes[nome] = r.valor;
  }

  // Janela invertida devolve lista vazia, e vazio é indistinguível de "não há
  // Negócio nesse período" — o cenário seguiria adiante achando que terminou.
  const de = cortes.created_from;
  const ate = cortes.created_to;
  if (de !== null && ate !== null && de > ate) {
    return apiError(
      422,
      "invalid_created_range",
      "created_from é posterior a created_to — a janela está invertida",
      ctx.cors,
    );
  }

  const supabase = ctx.supabase as unknown as RpcClient;
  const { data, error } = await supabase.rpc("api_list_deals", {
    p_org: ctx.organizationId,
    p_pipeline: url.searchParams.get("pipeline"),
    p_stage: url.searchParams.get("stage"),
    p_owner_id: url.searchParams.get("owner_id"),
    p_status: url.searchParams.get("status"),
    p_updated_since: cortes.updated_since,
    p_created_from: de,
    p_created_to: ate,
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
  // A chave de ordenação vai por parâmetro. Sobrescrever `created_at` na linha
  // para alimentar o cursor corromperia o corpo — é o MESMO objeto que vai
  // serializado para quem integra.
  const { page, nextCursor } = paginateByCursor(rows, limit, "last_activity_at");

  return apiList(page.map(serializeDealRow), nextCursor, ctx.cors);
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

/** Vocabulário de situação — o MESMO da leitura (`?status=`). */
const STATUS_ESCRITA = ["open", "won", "lost"] as const;

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
 * `PATCH /api/v1/deals/{id}` — editar Negócio. (#1772)
 *
 * Cobre título, valor, dono e o fechamento com motivo. NÃO cobre posição:
 * mover tem rota própria (#1770), porque mover é operação com regra — não pode
 * copiar, não pode atravessar para funil customizado. Aceitar `stage` aqui daria
 * um segundo caminho, sem nenhuma dessas regras.
 *
 * Reabrir Negócio fechado é recusado no banco: sair da etapa de ganho dispara
 * `sale_reversed`, que é irreversível.
 */
export async function patchDeal(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }

  if ("stage" in body || "pipeline" in body) {
    return apiError(
      422,
      "stage_not_editable",
      "Posição não se edita: use POST /api/v1/deals/{id}/move",
      ctx.cors,
    );
  }

  let status: string | null = null;
  if ("status" in body) {
    const s = String(body.status);
    if (!STATUS_ESCRITA.includes(s as typeof STATUS_ESCRITA[number])) {
      return apiError(
        422,
        "invalid_status",
        `status inválido. Válidos: ${STATUS_ESCRITA.join(", ")}`,
        ctx.cors,
      );
    }
    status = s;
  }

  const temCampo = ["title", "value", "owner_id", "notes"].some((f) => f in body) ||
    status !== null;
  if (!temCampo) {
    return apiError(422, "no_valid_fields", "Nenhum campo editável fornecido", ctx.cors);
  }

  const supabase = ctx.supabase as unknown as RpcClient;
  const { data, error } = await supabase.rpc("api_update_deal", {
    p_org: ctx.organizationId,
    p_deal_id: ctx.params.id,
    p_title: "title" in body ? body.title : null,
    p_value: "value" in body ? body.value : null,
    p_owner_id: "owner_id" in body ? body.owner_id : null,
    p_notes: "notes" in body ? body.notes : null,
    p_status: status,
    p_loss_reason: "loss_reason" in body ? body.loss_reason : null,
  });

  if (error) {
    const e = error as { code?: string; message?: string };
    if (e?.code === "P0002") {
      return apiError(404, "deal_not_found", "Negócio não encontrado", ctx.cors);
    }
    return apiError(422, "invalid_value", e?.message ?? "Valor inválido", ctx.cors);
  }

  if (!data) {
    return apiError(404, "deal_not_found", "Negócio não encontrado", ctx.cors);
  }

  return apiResource(serializeDealRow(data as DealRow), ctx.cors);
}

/**
 * `GET /api/v1/leads/{id}/deals` — os Negócios de um Lead. (#1772)
 *
 * Abertos e fechados, cada um com a própria posição. É a recompra ficando
 * legível de fora: é por esta lista que se vê o mesmo Lead com dois Negócios
 * abertos no mesmo funil — que o modelo autoriza desde o ADR-0023 decisão 2.
 */
export async function listLeadDeals(ctx: ApiRouteContext): Promise<Response> {
  const supabase = ctx.supabase as unknown as RpcClient;
  const { data, error } = await supabase.rpc("api_list_lead_deals", {
    p_org: ctx.organizationId,
    p_lead_id: ctx.params.id,
  });

  if (error) return apiError(500, "internal_error", "Erro ao listar negócios do lead", ctx.cors);

  const rows = (data ?? []) as DealRow[];
  // Sem cursor: a lista é do Lead, e um Lead com centenas de Negócios não é um
  // caso que exista — o maior em produção tem poucas unidades.
  return apiList(rows.map(serializeDealRow), null, ctx.cors);
}
