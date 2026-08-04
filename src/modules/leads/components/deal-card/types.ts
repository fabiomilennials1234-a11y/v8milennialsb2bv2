/**
 * Formato de entrada do Card do Negócio.
 *
 * O Negócio é o que morre com a venda; o Lead é o que sobrevive a ela. Por isso
 * aqui a pessoa entra como **referência clicável**, não como conteúdo: nome e
 * empresa para saber de quem é, e o id para abrir o card dela.
 *
 * ── O QUE A MEDIÇÃO IMPÔS AO FORMATO ──────────────────────────────────────
 * Prod, 04/08/2026, sobre 38.739 cards:
 *   - `valor` existe em **1,1%**. É opcional de verdade, não "quase sempre
 *     preenchido" — o card precisa ser bom sem ele.
 *   - a média é de **1,16 movimentação por negócio**: 39.297 têm uma só, a da
 *     criação. A linha do tempo tem que ser boa com um item.
 *   - o negócio mediano está parado há **42 dias** e 57% da carteira passou de
 *     30. Tempo é o único dado que existe para 100% e o único que aponta ação.
 */

export type EstadoDoNegocio = "aberto" | "ganho" | "perdido";

export interface DealCardStage {
  chave: string;
  nome: string;
  /** Etapa terminal — desenha diferente e encerra a trilha. */
  papel: "aberto" | "ganho" | "perdido";
}

export interface DealCardMove {
  id: string;
  de: string | null;
  para: string;
  quando: string;
  autor: string | null;
  origem: "manual" | "automacao" | "sistema";
}

export interface DealCardLeadRef {
  id: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  /** `Cliente` quando a pessoa já comprou alguma vez — ADR-0023 §6/§7. */
  relacao: "lead" | "cliente";
}

export interface DealCardData {
  /** `pipeline_entries.id` — a posição, que é o que identifica o negócio hoje. */
  id: string;
  titulo: string;
  estado: EstadoDoNegocio;

  lead: DealCardLeadRef;

  funil: string;
  funilCor: string;
  /** Trilha completa do funil, para a barra mostrar onde ele está e o que falta. */
  etapas: DealCardStage[];
  etapaAtual: string;

  dono: string | null;

  /** Dias desde `entered_at`. */
  diasEmAberto: number | null;
  /** Dias desde `stage_changed_at`. */
  diasNaEtapa: number | null;
  /**
   * Mediana de dias parado dos negócios da MESMA org e etapa. O alerta compara
   * com isto em vez de um número fixo: a 30 dias fixos, 22.060 dos 38.403
   * negócios abertos acenderiam, e alarme que toca sempre não é alarme.
   */
  medianaDaEtapa: number | null;

  valor: number;
  moeda: string;
  produto: string | null;

  reuniao: { data: string; confirmada: boolean; link: string | null } | null;

  /** Preenchido só quando `estado` não é `aberto`. */
  desfecho: {
    quando: string;
    /** Valor da venda no ledger (`sale_events`), quando ganho. */
    valorVenda: number | null;
    motivo: string | null;
  } | null;

  movimentacoes: DealCardMove[];
  nota: string;
}
