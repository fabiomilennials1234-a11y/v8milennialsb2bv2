/**
 * Endereço de um negócio no board: `/funil/<pipelineId>?negocio=<entryId>`.
 *
 * Contrato entre quem MANDA para o negócio (o "Ir para o negócio" da ficha do
 * lead no chat) e quem o MOSTRA (a página `/funil/:slug`, que rola até o card e
 * o faz brilhar). Mora em `contracts` porque os dois lados são módulos que não
 * podem se importar: `communication` → `pipelines` fecha ciclo de dependência.
 *
 * ── Por que o UUID do funil, e não o slug ────────────────────────────────────
 * O slug muda quando o funil é renomeado; o UUID não. `/funil/:slug` aceita os
 * dois (`resolveFunil`), então o link continua válido para sempre.
 *
 * ── Por que parâmetro de busca, e não `location.state` ───────────────────────
 * Sobrevive a recarregar a página e aos redirects `/pipe-*` → `/funil/*`
 * (preservam `search`, não `state`), e vira um link que dá para mandar a alguém.
 * O board consome o pedido UMA vez e tira o parâmetro da URL (`semNegocio`).
 */

/**
 * Piloto por organização (Café Jurerê, 10/11): `organizations.feature_flags.
 * chat_ir_para_negocio = true`. O chat só mostra o botão com ela, e o board só
 * reage ao endereço com ela — desligar a flag desliga os dois lados.
 */
export const IR_PARA_NEGOCIO_FLAG = "chat_ir_para_negocio";

/** Nome do parâmetro de busca com o `pipeline_entries.id` do negócio. */
export const NEGOCIO_PARAM = "negocio";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DestinoDoNegocio {
  /** `pipelines.id`. */
  pipelineId: string;
  /** `pipeline_entries.id` — o negócio, não o lead (um lead pode ter vários). */
  entryId: string;
}

export function caminhoDoNegocio({ pipelineId, entryId }: DestinoDoNegocio): string {
  const busca = new URLSearchParams({ [NEGOCIO_PARAM]: entryId });
  return `/funil/${encodeURIComponent(pipelineId)}?${busca.toString()}`;
}

/**
 * O negócio que a URL pede, ou `null`. Só UUID passa: o valor vira seletor de
 * DOM e argumento de RPC. Em minúsculas, como o banco devolve o id (e como o
 * card o carrega em `data-lead-id`).
 */
export function negocioDaUrl(busca: Pick<URLSearchParams, "get">): string | null {
  const valor = busca.get(NEGOCIO_PARAM)?.trim();
  return valor && UUID_RE.test(valor) ? valor.toLowerCase() : null;
}

/** A mesma busca sem o pedido do negócio. Não muta a recebida. */
export function semNegocio(busca: URLSearchParams): URLSearchParams {
  const proxima = new URLSearchParams(busca);
  proxima.delete(NEGOCIO_PARAM);
  return proxima;
}
