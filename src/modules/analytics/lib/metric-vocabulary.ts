/**
 * Vocabulário do catálogo fechado — recortes, formatos e a allowlist de filtros.
 *
 * Módulo FOLHA de propósito: não importa nada do módulo. Estes três tipos são
 * consumidos por `metrics-studio-engine-map`, por `useMetricMeasure` e pela
 * árvore personalizada (`metric-tree`), e tê-los em qualquer um dos três
 * fecharia ciclo de módulos — que é exatamente o que reprovou o `Lint & Build`
 * do #1497 (`dependency-cruiser` lê o grafo de módulos, não o de valores; import
 * só de TIPO conta igual).
 *
 * Os consumidores originais re-exportam estes nomes, então nada precisou mudar
 * de import.
 */

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

/**
 * Unidade da medida — `metric_catalog_measures.unit`, mais `number` para o
 * literal da árvore personalizada, que não é medida e não tem linha no catálogo.
 */
export type MetricUnit =
  | "currency"
  | "count"
  | "duration_seconds"
  | "percent"
  | "ratio"
  | "number";

/** Formatos do catálogo fechado. Espelha `metric_catalog_formats` em prod. */
export type MetricFormatId =
  | "currency_brl"
  | "integer"
  | "percent_1"
  | "duration_human"
  | "ratio_2";

/**
 * Allowlist de filtros — espelha o trigger do banco e o validador da árvore.
 * NUNCA `organization_id`: ele vem do parâmetro do servidor, jamais do payload.
 */
export interface MetricFilters {
  pipeline_id?: string;
  member_id?: string;
  origin?: string;
  tag_id?: string;
  product_id?: string;
  stream?: "novo_negocio" | "carteira";
  /**
   * SCRUM-316 — as duas pontas da conversão entre etapas. São `stage_key`
   * (slug), não id: é o que `pipeline_stage_events` guarda.
   *
   * Só as medidas `negocios_coorte_*` os lêem, e para elas NÃO são opcionais —
   * o motor levanta 22023 quando falta um dos dois, em vez de devolver zero.
   * Zero seria um número que parece resposta.
   */
  from_stage_key?: string;
  to_stage_key?: string;
}
