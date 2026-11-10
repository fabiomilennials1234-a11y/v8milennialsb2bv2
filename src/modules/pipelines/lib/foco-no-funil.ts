/**
 * Foco no negócio — o card que o "Ir para o negócio" do chat veio buscar.
 *
 * A coluna pagina de 20 em 20 por `(created_at, id)`; numa etapa de 1.618
 * negócios, o alvo pode estar na página 45. Em vez de carregar página por página,
 * a RPC `localizar_negocio_no_funil` traz a linha DELE, no mesmo formato da
 * coluna, e o board a mostra no topo da etapa enquanto durar a visita.
 *
 * O cache das colunas não é tocado: o foco é uma query própria (sob o prefixo
 * `pipeline-page`, para receber toda invalidação que o board já recebe) e entra
 * na coluna só na hora de montar os itens, por esta função.
 */

/**
 * Segmento da chave da query de foco no lugar da etapa:
 * `["pipeline-page", pipelineId, FOCO_SEGMENTO, orgId, filtersKey, entryId]`.
 * Para o Realtime e a reconciliação do move, o foco é uma "coluna" a mais.
 */
export const FOCO_SEGMENTO = "__foco__";

/** O que a RPC devolve, já no formato do front. `null` (na query) = não localizável. */
export interface FocoDoNegocio {
  entryId: string;
  pipelineId: string;
  /** Etapa ATUAL, lida do banco (a do chat pode ter ficado velha). */
  stageKey: string;
  leadId: string | null;
  /** O recorte do board (filtros, "Meus") mostra o negócio? */
  visivel: boolean;
  /** A linha no formato da coluna (`flattenRpcEntry`). Só existe quando `visivel`. */
  linha: (Record<string, unknown> & { id: string; stage_key: string }) | null;
}

/** O dado de uma query sob `pipeline-page` é o foco (e não uma coluna paginada)? */
export function ehFocoDoNegocio(dado: unknown): dado is FocoDoNegocio {
  return !!dado && typeof dado === "object" && "visivel" in dado && "linha" in dado && "entryId" in dado;
}

/** A linha a fixar no board, ou `null` quando não há o que mostrar. */
export function linhaFocada(foco: FocoDoNegocio | null | undefined): FocoDoNegocio["linha"] {
  return foco?.visivel && foco.linha ? foco.linha : null;
}

const instante = (v: unknown) => (typeof v === "string" ? Date.parse(v) : Number.NaN);

type LinhaDoBoard = NonNullable<FocoDoNegocio["linha"]>;

/**
 * A versão mais NOVA deste negócio entre o foco e as colunas. A coluna pode
 * chegar antes do foco (o move relê as duas juntas; o Realtime de outra pessoa
 * refaz a coluna antes de o foco reler): vale a dela, com a etapa dela.
 */
function versaoMaisNova(stageData: Record<string, { items: unknown[] }>, linha: LinhaDoBoard): LinhaDoBoard {
  let maisNova = linha;
  let quando = instante(linha.updated_at);
  if (Number.isNaN(quando)) return linha;
  for (const slot of Object.values(stageData)) {
    for (const item of slot.items as Array<Partial<LinhaDoBoard> | null>) {
      if (item?.id !== linha.id || typeof item.stage_key !== "string") continue;
      const t = instante(item.updated_at);
      if (t > quando) {
        maisNova = item as LinhaDoBoard;
        quando = t;
      }
    }
  }
  return maisNova;
}

/**
 * O board inteiro com o foco aplicado, coluna a coluna. Sem linha focada,
 * devolve o MESMO objeto — ninguém re-renderiza por causa do foco.
 *
 * O card fixado é a versão mais nova que o board conhece (`versaoMaisNova`):
 * continua no topo da etapa dele e fora das outras — nada pula, e nunca em
 * duas colunas, nem quando a coluna relê antes do foco.
 */
export function aplicarFocoNoBoard<S extends { items: unknown[] }>(
  stageData: Record<string, S>,
  foco: FocoDoNegocio | null | undefined,
): Record<string, S> {
  const linha = linhaFocada(foco);
  if (!linha) return stageData;
  const fixada = versaoMaisNova(stageData, linha);
  const board: Record<string, S> = {};
  for (const [stageKey, slot] of Object.entries(stageData)) {
    const items = aplicarFocoNaColuna(stageKey, slot.items as Array<{ id: string }>, fixada);
    board[stageKey] = items === slot.items ? slot : { ...slot, items };
  }
  return board;
}

/**
 * O foco que ESTE board pode fixar: o negócio pedido, deste funil, numa etapa
 * que o board mostra, e visível no recorte. Qualquer outra resposta não fixa
 * nada — ENVASE e VAREJO (Café Jurerê) têm as mesmas chaves de etapa, e um card
 * de um funil jamais pode aparecer fixado no outro.
 */
export function focoEfetivo(
  foco: FocoDoNegocio | null | undefined,
  alvo: { entryId: string | null | undefined; pipelineId: string | null | undefined; etapas: ReadonlySet<string> },
): FocoDoNegocio | null {
  const linha = linhaFocada(foco);
  if (!foco || !linha || !alvo.entryId || !alvo.pipelineId) return null;
  if (foco.entryId !== alvo.entryId || linha.id !== alvo.entryId) return null;
  const funilDaLinha = typeof linha.pipeline_id === "string" ? linha.pipeline_id : foco.pipelineId;
  if (foco.pipelineId !== alvo.pipelineId || funilDaLinha !== alvo.pipelineId) return null;
  if (!alvo.etapas.has(linha.stage_key)) return null;
  return foco;
}

/** O que o board faz com o pedido, decidido UMA vez por pedido. */
export type DecisaoDoPedido =
  | { tipo: "indisponivel" }
  | { tipo: "outro-funil"; pipelineId: string }
  | { tipo: "mostrar-todos" }
  | { tipo: "filtro-esconde" }
  | { tipo: "etapa-fora" }
  | { tipo: "abrir-painel"; entryId: string; leadId: string | null }
  | { tipo: "levar"; entryId: string; stageKey: string };

/**
 * A decisão do pedido "Ir para o negócio", pura (a página só executa):
 *  - nada localizado → indisponível (a pessoa não vê, ou foi excluído);
 *  - negócio de outro funil → vai para o board dele;
 *  - "Meus" esconde → mostra Todos nesta visita (uma vez); outro filtro → avisa;
 *  - etapa que o board não mostra → avisa;
 *  - celular (sem board) → abre o painel do negócio;
 *  - senão → leva até o card, na etapa ATUAL (a do chat pode ter ficado velha).
 */
export function decidirIrAoNegocio(
  foco: FocoDoNegocio | null,
  ctx: { pipelineId: string; etapas: ReadonlySet<string>; mobile: boolean; meusAtivo: boolean; jaMostrouTodos: boolean },
): DecisaoDoPedido {
  if (!foco) return { tipo: "indisponivel" };
  if (foco.pipelineId !== ctx.pipelineId) return { tipo: "outro-funil", pipelineId: foco.pipelineId };
  if (!foco.visivel) return ctx.meusAtivo && !ctx.jaMostrouTodos ? { tipo: "mostrar-todos" } : { tipo: "filtro-esconde" };
  if (!ctx.etapas.has(foco.stageKey)) return { tipo: "etapa-fora" };
  if (ctx.mobile) return { tipo: "abrir-painel", entryId: foco.entryId, leadId: foco.leadId };
  return { tipo: "levar", entryId: foco.entryId, stageKey: foco.stageKey };
}

/**
 * Itens da coluna `stageKey` com o negócio focado aplicado:
 *  - na etapa do foco, ele vai para o TOPO (a cópia natural sai: id único para
 *    o React e o dnd-kit, e nada pula quando a página natural dele chegar);
 *  - nas outras, some — cache velho nunca o mostra em duas colunas.
 * Sem foco, ou coluna que não o tem, devolve o MESMO array.
 */
export function aplicarFocoNaColuna<T extends { id: string }>(
  stageKey: string,
  naturais: T[],
  foco: (T & { stage_key: string }) | null,
): T[] {
  if (!foco) return naturais;
  const temCopia = naturais.some((l) => l.id === foco.id);
  if (foco.stage_key !== stageKey) {
    return temCopia ? naturais.filter((l) => l.id !== foco.id) : naturais;
  }
  return [foco, ...(temCopia ? naturais.filter((l) => l.id !== foco.id) : naturais)];
}
