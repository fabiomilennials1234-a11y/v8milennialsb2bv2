/**
 * Mapa StudioMetric → motor (SCRUM-310, épico #1194 · ADR-0023).
 *
 * O catálogo do Estúdio (`metrics-studio-catalog.ts`) fala a linguagem do
 * usuário: "Negócios por etapa", "Ticket médio". O motor
 * (`fn_metric_measure`) fala a linguagem do catálogo fechado: um `measure_ref`
 * mais um recorte, ambos validados contra tabela de compatibilidade.
 *
 * As duas linguagens NÃO se traduzem por semelhança de nome — foi medido:
 *
 *   - `taxa_conversao` e `ticket_medio` são RAZÕES, não medidas.
 *   - `negocios_por_etapa` é a medida `leads_na_etapa` com recorte `etapa`.
 *   - `negocios_por_funil` e `receita_por_origem` são pares (medida, recorte),
 *     não medidas próprias.
 *   - só 5 ids batem 1:1.
 *
 * Este arquivo é o único lugar onde a tradução existe. Sem ele, montar o par
 * (medida, recorte) errado levanta `EXCEPTION 22023` no motor — que NÃO é
 * capturado por `isMissingSchemaError` e vira throw na janela.
 *
 * ⚠ Só entram aqui métricas que o motor calcula EM PRODUÇÃO. Medido em
 * 2026-08-11: o catálogo de prod tem 7 medidas. `reunioes_no_show` e o campo
 * `target` (de que `meta_definida` depende) vivem na migration
 * `20260727140000`, que NUNCA foi aplicada — o ledger pula de `20260727120000`
 * para `20260727140241`. Métrica fora deste mapa continua em amostra.
 */

import type { MeasureRef, MetricFilters } from "@/modules/analytics/hooks/useMetricMeasure";

/** Recortes do catálogo fechado. Espelha `metric_catalog_recortes` em prod. */
export type MetricRecorte =
  | "total"
  | "closer"
  | "sdr"
  | "origem"
  | "tag"
  | "produto"
  | "stream"
  | "pipeline"
  | "etapa"
  | "tempo";

/** Formatos do catálogo fechado. Espelha `metric_catalog_formats` em prod. */
export type MetricFormatId =
  | "currency_brl"
  | "integer"
  | "percent_1"
  | "duration_human"
  | "ratio_2";

export interface EngineBinding {
  measureRef: MeasureRef;
  /** Recorte padrão da janela. Precisa existir em COMPATIBILIDADE[measure]. */
  recorte: MetricRecorte;
  /** Formato do motor. NÃO usar `MetricUnit` do Estúdio — os vocabulários divergem. */
  formatId: MetricFormatId;
  filters?: MetricFilters;
  /**
   * `true` quando o motor devolve escalar (`value`) e `series: null`.
   * Razão é SEMPRE escalar. Leaf é escalar só com recorte `total`.
   * Quem consome usa isto para saber que gráfico de série não tem fonte.
   */
  escalar: boolean;
}

/**
 * Compatibilidade medida × recorte, copiada de `metric_catalog_measure_recortes`
 * em PROD (2026-08-11). Par ausente = `EXCEPTION 22023` no motor.
 *
 * Note `tempo_medio_etapa` SEM `total` — é a única medida que não aceita.
 */
export const COMPATIBILIDADE: Record<string, MetricRecorte[]> = {
  receita: ["total", "closer", "sdr", "origem", "tag", "stream", "pipeline", "tempo"],
  num_vendas: ["total", "closer", "sdr", "origem", "tag", "stream", "pipeline", "tempo"],
  leads_criados: ["total", "origem", "produto", "tag", "tempo"],
  reunioes_marcadas: ["total", "sdr", "origem", "tag", "tempo"],
  reunioes_realizadas: ["total", "sdr", "origem", "tag", "tempo"],
  leads_na_etapa: ["total", "pipeline", "etapa"],
  tempo_medio_etapa: ["etapa", "pipeline"],
};

/** Formato único por medida, de `metric_catalog_measure_formats` em prod. */
export const FORMATO_DA_MEDIDA: Record<string, MetricFormatId> = {
  receita: "currency_brl",
  num_vendas: "integer",
  leads_criados: "integer",
  reunioes_marcadas: "integer",
  reunioes_realizadas: "integer",
  leads_na_etapa: "integer",
  tempo_medio_etapa: "duration_human",
};

/**
 * A tradução. Chave = `StudioMetric.id`.
 *
 * Deliberadamente FORA daqui, com o motivo:
 *   - reunioes_no_show, meta_definida → migration 20260727140000 não está em prod
 *   - curva_abc, negocios_por_lead, taxa_resposta_automacao → não existem
 *   - as 7 parciais e as demais "prontas" → vivem em hook legado, não no motor
 *     (é o SCRUM-311 que as porta)
 */
export const ENGINE_MAP: Record<string, EngineBinding> = {
  receita: {
    measureRef: { kind: "leaf", id: "receita" },
    recorte: "total",
    formatId: "currency_brl",
    escalar: true,
  },
  leads_criados: {
    measureRef: { kind: "leaf", id: "leads_criados" },
    recorte: "total",
    formatId: "integer",
    escalar: true,
  },
  reunioes_marcadas: {
    measureRef: { kind: "leaf", id: "reunioes_marcadas" },
    recorte: "total",
    formatId: "integer",
    escalar: true,
  },
  reunioes_realizadas: {
    measureRef: { kind: "leaf", id: "reunioes_realizadas" },
    recorte: "total",
    formatId: "integer",
    escalar: true,
  },

  // Razões: profundidade 1, dois filhos, ambos forçados a recorte 'total' pelo
  // motor. `series` vem SEMPRE null — por isso escalar.
  taxa_conversao: {
    measureRef: { kind: "ratio", num: "num_vendas", den: "leads_criados" },
    recorte: "total",
    formatId: "percent_1",
    escalar: true,
  },
  ticket_medio: {
    measureRef: { kind: "ratio", num: "receita", den: "num_vendas" },
    recorte: "total",
    formatId: "currency_brl",
    escalar: true,
  },

  // Pares (medida, recorte): o id do Estúdio descreve o CORTE, não a medida.
  negocios_por_etapa: {
    measureRef: { kind: "leaf", id: "leads_na_etapa" },
    recorte: "etapa",
    formatId: "integer",
    escalar: false,
  },
  negocios_por_funil: {
    measureRef: { kind: "leaf", id: "leads_na_etapa" },
    recorte: "pipeline",
    formatId: "integer",
    escalar: false,
  },
  receita_por_origem: {
    measureRef: { kind: "leaf", id: "receita" },
    recorte: "origem",
    formatId: "currency_brl",
    escalar: false,
  },
  tempo_medio_etapa: {
    measureRef: { kind: "leaf", id: "tempo_medio_etapa" },
    recorte: "etapa",
    formatId: "duration_human",
    escalar: false,
  },
};

/** Ids de medida referenciados por um binding (1 para leaf, 2 para razão). */
export function medidasDe(binding: EngineBinding): string[] {
  return binding.measureRef.kind === "leaf"
    ? [binding.measureRef.id]
    : [binding.measureRef.num, binding.measureRef.den];
}

/** `undefined` = métrica sem tradução; o consumidor mantém a amostra. */
export function bindingDe(metricId: string): EngineBinding | undefined {
  return ENGINE_MAP[metricId];
}

/**
 * Guarda de tempo de execução para o par (medida, recorte).
 *
 * Razão ignora o recorte pedido — o motor força `total` nos dois filhos —,
 * então a checagem vale só para leaf.
 */
export function parEhCompativel(binding: EngineBinding): boolean {
  if (binding.measureRef.kind === "ratio") return true;
  return COMPATIBILIDADE[binding.measureRef.id]?.includes(binding.recorte) ?? false;
}
