/**
 * Tempo médio de recompra do cliente.
 *
 * ─── A PERGUNTA QUE ISTO RESPONDE ───────────────────────────────────────────
 * "De quanto em quanto tempo esta pessoa compra, e quando ela volta?" O anel na
 * lista mostra a média e o quanto já se andou rumo à próxima compra esperada.
 *
 * ─── O QUE CONTA COMO COMPRA ────────────────────────────────────────────────
 * As duas fontes, unidas pelas DATAS (decisão do CTO, 2026-09-04):
 *   1. `sale_events` com `event_type = 'sale'`, líquido de estorno — o negócio
 *      ganho no funil (ADR-0017);
 *   2. `upsell_orders` aprovados — o pedido da carteira/ERP.
 *
 * União de datas, e não média das duas médias: a org que fecha pelo funil E
 * lança pedido tem UM histórico de compra, não dois. Somar médias já calculadas
 * daria um número que não corresponde a intervalo nenhum que existiu.
 *
 * Medido em prod (2026-09-04) antes de escrever: 5.442 leads na gaveta Cliente,
 * TODOS da Café Jurerê, e nenhum deles com venda ou pedido — a classificação
 * "cliente" vem de estar cadastrado no ERP, não de ter comprado. Quem tem
 * histórico real hoje está fora daquela gaveta (Basic4u: 185 leads com pedido,
 * 133 com dois ou mais). Foi esse dado que moveu a coluna para todas as abas.
 *
 * ─── POR QUE COLAPSAR POR DIA ───────────────────────────────────────────────
 * A mesma venda pode existir nas duas fontes (fechou no funil e virou pedido).
 * Sem colapsar, ela vira duas compras separadas por zero dia e ARRASTA a média
 * para baixo — o cliente de 60 dias apareceria com 30. Duas compras no mesmo
 * dia são uma compra para efeito de ciclo.
 */

/** Janela, em dias, em que o cliente é considerado em época de recompra. */
export const JANELA_DE_RECOMPRA_DIAS = 7;

const UM_DIA_MS = 86_400_000;

export type EstadoDoCiclo =
  /** Nenhuma compra registrada. */
  | "sem-compra"
  /** Uma compra só — existe cliente, não existe intervalo a medir. */
  | "uma-compra"
  /** Duas ou mais: há média. */
  | "com-ciclo";

export interface CicloDeRecompra {
  estado: EstadoDoCiclo;
  /** Compras distintas (colapsadas por dia). */
  compras: number;
  /** Média de dias entre compras. `null` fora de "com-ciclo". */
  mediaDias: number | null;
  /** Dias desde a última compra. `null` quando não houve compra. */
  diasDesdeUltima: number | null;
  /**
   * Dias que faltam para a próxima compra esperada. NEGATIVO quando o prazo já
   * passou — o sinal importa, é ele que distingue "falta uma semana" de
   * "atrasou um mês".
   */
  diasRestantes: number | null;
  /** Progresso rumo à próxima compra, de 0 a 1 (satura em 1 quando vence). */
  progresso: number;
  /**
   * Está na época de recomprar? Verdadeiro a partir de 7 dias antes do
   * esperado e **assim permanece** depois de vencer (decisão do CTO): o cliente
   * atrasado é o que mais precisa de contato, e apagar o verde no dia seguinte
   * ao prazo o tiraria do radar exatamente aí.
   */
  emEpoca: boolean;
  /** O que vai escrito dentro do anel: "Sem compra", "Sem informações", "45D". */
  rotulo: string;
}

const SEM_COMPRA: CicloDeRecompra = {
  estado: "sem-compra",
  compras: 0,
  mediaDias: null,
  diasDesdeUltima: null,
  diasRestantes: null,
  progresso: 0,
  emEpoca: false,
  rotulo: "Sem compra",
};

/** Dia (UTC) de um instante, como número — a chave que colapsa duplicata. */
function diaDe(ms: number): number {
  return Math.floor(ms / UM_DIA_MS);
}

/**
 * Calcula o ciclo a partir das datas de compra já unidas das duas fontes.
 *
 * Pura, e `agora` é injetável: sem isso, testar "faltam 7 dias" exigiria forjar
 * `sold_at` no passado — coisa que os triggers `trg_sale_events_force_sold_at` e
 * `trg_sale_events_immutable` impedem de propósito.
 */
export function calcularCicloDeRecompra(
  datas: readonly (string | Date | null | undefined)[],
  agora: number = Date.now(),
  janelaDias: number = JANELA_DE_RECOMPRA_DIAS,
): CicloDeRecompra {
  const dias = new Set<number>();
  for (const d of datas) {
    if (!d) continue;
    const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
    if (Number.isNaN(ms)) continue;
    dias.add(diaDe(ms));
  }

  if (dias.size === 0) return SEM_COMPRA;

  const ordenados = [...dias].sort((a, b) => a - b);
  const compras = ordenados.length;
  const ultimaMs = ordenados[compras - 1] * UM_DIA_MS;
  const diasDesdeUltima = Math.max(0, Math.floor((agora - ultimaMs) / UM_DIA_MS));

  if (compras === 1) {
    return {
      estado: "uma-compra",
      compras,
      mediaDias: null,
      diasDesdeUltima,
      diasRestantes: null,
      progresso: 0,
      emEpoca: false,
      rotulo: "Sem informações",
    };
  }

  // Média do vão total dividido pelo número de intervalos — não a média de
  // pares consecutivos calculada um a um, que dá o mesmo número por muito mais
  // trabalho.
  const vaoEmDias = ordenados[compras - 1] - ordenados[0];
  const mediaDias = Math.max(1, Math.round(vaoEmDias / (compras - 1)));

  const diasRestantes = mediaDias - diasDesdeUltima;
  const progresso = Math.min(1, Math.max(0, diasDesdeUltima / mediaDias));

  return {
    estado: "com-ciclo",
    compras,
    mediaDias,
    diasDesdeUltima,
    diasRestantes,
    progresso,
    emEpoca: diasRestantes <= janelaDias,
    rotulo: `${mediaDias}D`,
  };
}
