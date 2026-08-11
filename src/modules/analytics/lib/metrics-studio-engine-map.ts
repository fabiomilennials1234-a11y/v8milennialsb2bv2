/**
 * Mapa StudioMetric → motor (SCRUM-310, épico #1194 · ADR-0023).
 *
 * O catálogo do Estúdio (`metrics-studio-catalog.ts`) é o INVENTÁRIO das 29
 * métricas do roadmap, com o estado de cada uma. Este arquivo é outra coisa: a
 * lista do que o motor realmente calcula, e como.
 *
 * Decisões do grill de 2026-08-11 que moldam este arquivo
 * (`.specs/features/metricas-v2/SPEC.md` §1.7):
 *
 *   G1 — a UI mostra SÓ o que tem número real. Métrica fora deste mapa não
 *        aparece na lista lateral; nada de amostra na frente do cliente.
 *   G2 — o corte é escolha do usuário, não atributo da métrica. Por isso
 *        `cortes[]` em vez de um `recorte` fixo, e por isso "Receita por
 *        origem" deixa de ser item próprio: é Faturamento com corte `origem`.
 *   G3 — vela sai. Nenhum binding oferece OHLC porque o motor não tem.
 *   G6 — cortes por pessoa (closer/sdr) exigem a permissão do Ranking.
 *
 * As duas linguagens NÃO se traduzem por semelhança de nome:
 * `taxa_conversao` e `ticket_medio` são RAZÕES, não medidas.
 *
 * ⚠ Só entra aqui o que o motor calcula EM PRODUÇÃO. Medido em 2026-08-11: o
 * catálogo de prod tem 7 medidas. `reunioes_no_show` e o campo `target` (de que
 * `meta_definida` depende) vivem na migration `20260727140000`, que NUNCA foi
 * aplicada — o ledger pula de `20260727120000` para `20260727140241`.
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

/**
 * Cortes que expõem número por PESSOA. G6: só aparecem para quem já tem acesso
 * ao Ranking — a mesma regra que hoje governa `/performance`.
 */
export const CORTES_POR_PESSOA: MetricRecorte[] = ["closer", "sdr"];

/** Rótulo de UI por corte. Linguagem de produto, não do banco. */
export const ROTULO_DO_CORTE: Record<MetricRecorte, string> = {
  total: "Total",
  tempo: "Por dia",
  origem: "Por origem",
  closer: "Por closer",
  sdr: "Por SDR",
  tag: "Por tag",
  produto: "Por produto",
  stream: "Por tipo de negócio",
  pipeline: "Por funil",
  etapa: "Por etapa",
};

export interface EngineMetric {
  /** Id do StudioMetric correspondente, quando existe no inventário. */
  id: string;
  label: string;
  measureRef: MeasureRef;
  /**
   * Cortes que o motor aceita para esta métrica, na ordem em que aparecem na
   * UI. O primeiro é o default da janela.
   *
   * Razão ignora corte — o motor força `total` nos dois filhos —, então razão
   * declara `["total"]` e a UI não mostra o seletor.
   */
  cortes: MetricRecorte[];
  formatId: MetricFormatId;
  filtrosFixos?: MetricFilters;
}

/**
 * Compatibilidade medida × recorte, conferida contra `metric_catalog_measure_recortes`
 * em PROD (2026-08-11) linha a linha. Par ausente = `EXCEPTION 22023` no motor,
 * que NÃO é capturado por `isMissingSchemaError` e derruba a janela.
 *
 * `tempo_medio_etapa` é a única medida SEM `total`.
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
 * O que o Estúdio oferece. 7 medidas + 3 razões.
 *
 * Fora daqui, com o motivo:
 *   - `reunioes_no_show`, `meta_definida` → migration 20260727140000 não está em prod
 *   - `curva_abc`, `negocios_por_lead`, `taxa_resposta_automacao` → não existem
 *   - as 7 parciais e as demais "prontas" → vivem em hook legado (SCRUM-311 as porta)
 */
export const ENGINE_METRICS: EngineMetric[] = [
  {
    id: "receita",
    label: "Faturamento",
    measureRef: { kind: "leaf", id: "receita" },
    cortes: ["total", "tempo", "origem", "closer", "sdr", "pipeline", "tag", "stream"],
    formatId: "currency_brl",
  },
  {
    id: "num_vendas",
    label: "Nº de vendas",
    measureRef: { kind: "leaf", id: "num_vendas" },
    cortes: ["total", "tempo", "origem", "closer", "sdr", "pipeline", "tag", "stream"],
    formatId: "integer",
  },
  {
    id: "leads_criados",
    label: "Leads que entraram",
    measureRef: { kind: "leaf", id: "leads_criados" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    id: "reunioes_marcadas",
    label: "Reuniões marcadas",
    measureRef: { kind: "leaf", id: "reunioes_marcadas" },
    cortes: ["total", "tempo", "origem", "sdr", "tag"],
    formatId: "integer",
  },
  {
    id: "reunioes_realizadas",
    label: "Reuniões comparecidas",
    measureRef: { kind: "leaf", id: "reunioes_realizadas" },
    cortes: ["total", "tempo", "origem", "sdr", "tag"],
    formatId: "integer",
  },
  {
    id: "negocios_por_etapa",
    label: "Negócios na etapa",
    measureRef: { kind: "leaf", id: "leads_na_etapa" },
    cortes: ["total", "etapa", "pipeline"],
    formatId: "integer",
  },
  {
    id: "tempo_medio_etapa",
    label: "Tempo médio na etapa",
    measureRef: { kind: "leaf", id: "tempo_medio_etapa" },
    // Sem 'total': o catálogo de prod não aceita. Default vira 'etapa'.
    cortes: ["etapa", "pipeline"],
    formatId: "duration_human",
  },

  // Razões: profundidade 1, dois filhos, ambos forçados a 'total' pelo motor.
  // `series` vem SEMPRE null — a UI não oferece corte nem gráfico de série.
  {
    id: "taxa_conversao",
    label: "Taxa de conversão",
    measureRef: { kind: "ratio", num: "num_vendas", den: "leads_criados" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    id: "comparecimento",
    label: "Taxa de comparecimento",
    measureRef: { kind: "ratio", num: "reunioes_realizadas", den: "reunioes_marcadas" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    id: "ticket_medio",
    label: "Ticket médio",
    measureRef: { kind: "ratio", num: "receita", den: "num_vendas" },
    cortes: ["total"],
    formatId: "currency_brl",
  },
];

export const ENGINE_BY_ID = new Map(ENGINE_METRICS.map((m) => [m.id, m]));

/** Ids de medida referenciados (1 para leaf, 2 para razão). */
export function medidasDe(m: EngineMetric): string[] {
  return m.measureRef.kind === "leaf"
    ? [m.measureRef.id]
    : [m.measureRef.num, m.measureRef.den];
}

/** Razão é sempre escalar; leaf é escalar só no corte `total`. */
export function ehEscalar(m: EngineMetric, corte: MetricRecorte): boolean {
  return m.measureRef.kind === "ratio" || corte === "total";
}

/**
 * Cortes que ESTE usuário pode escolher. G6: corte por pessoa depende da
 * permissão do Ranking.
 */
export function cortesVisiveis(m: EngineMetric, podeVerPorPessoa: boolean): MetricRecorte[] {
  if (podeVerPorPessoa) return m.cortes;
  return m.cortes.filter((c) => !CORTES_POR_PESSOA.includes(c));
}

/**
 * Guarda de runtime do par (medida, corte). Razão ignora o corte — o motor
 * força `total` nos filhos —, então a checagem vale só para leaf.
 */
export function parEhCompativel(m: EngineMetric, corte: MetricRecorte): boolean {
  if (m.measureRef.kind === "ratio") return true;
  return COMPATIBILIDADE[m.measureRef.id]?.includes(corte) ?? false;
}
