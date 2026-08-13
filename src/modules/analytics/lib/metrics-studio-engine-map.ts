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
 * ⚠ Só entra aqui o que o motor calcula. Medido em 2026-08-11: o catálogo de
 * PROD tem 7 medidas. As outras chegam pelas migrations do SCRUM-311, e a UI só
 * as mostra depois do apply — cada uma some sozinha da tela enquanto a sua
 * migration não estiver aplicada, porque o motor levanta 22023 e a janela cai.
 *
 * `reunioes_no_show` NÃO vem de `20260727140000` (aquela nunca foi aplicada e
 * NÃO PODE ser: reescreve `_metric_leaf` com o CASE de 8 medidas e apaga o
 * roteamento das 16). Vem de `20270812120000`, que absorveu as duas metades no
 * despachante vigente.
 *
 * `meta_definida` continua fora: alvo é CAMPO do payload (`target`), não medida,
 * e o motor só compõe razão entre dois ids do catálogo (SCRUM-365).
 */

import type { MeasureRef } from "@/modules/analytics/hooks/useMetricMeasure";
import type {
  MetricFilters,
  MetricFormatId,
  MetricRecorte,
  MetricUnit,
} from "@/modules/analytics/lib/metric-vocabulary";

// Os três tipos passaram a morar em `lib/metric-vocabulary` (módulo folha) para
// que `metric-tree` possa usá-los sem fechar ciclo com este arquivo. Continuam
// re-exportados daqui: nenhum consumidor precisou mudar de import.
export type { MetricFormatId, MetricRecorte };

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
  // SCRUM-311 fatia 1. Sem 'tempo' (é estado, não série) e sem corte por
  // pessoa ("sem dono por vendedor" é contradição).
  leads_sem_responsavel: ["total", "origem", "tag"],
  // SCRUM-311 fatias 2-8 — portadas para o motor pela pilha, e até aqui
  // INVISÍVEIS na tela: catálogo tem a medida, a lista lateral não a oferecia.
  leads_avaliados: ["total", "origem", "tag", "produto", "tempo"],
  leads_nao_avaliados: ["total", "origem", "tag", "produto", "tempo"],
  boas_avaliacoes: ["total", "origem", "tag", "produto", "tempo"],
  negocios_perdidos: ["total", "closer", "origem", "pipeline", "tempo"],
  tempo_resposta_equipe: ["total", "origem", "tempo"],
  reunioes_no_show: ["total", "sdr", "origem", "tempo"],
  // SCRUM-311 fatia 9 — a unidade do funil é o NEGÓCIO (ADR-0023).
  negocios_na_etapa: ["total", "pipeline", "etapa"],
  negocios_abertos: ["total", "tempo", "origem", "pipeline", "etapa"],
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
  leads_sem_responsavel: "integer",
  leads_avaliados: "integer",
  leads_nao_avaliados: "integer",
  boas_avaliacoes: "integer",
  negocios_perdidos: "integer",
  reunioes_no_show: "integer",
  tempo_resposta_equipe: "duration_human",
  negocios_na_etapa: "integer",
  negocios_abertos: "integer",
};

/**
 * Unidade por medida, de `metric_catalog_measures.unit` em prod.
 *
 * A árvore personalizada precisa da UNIDADE, não do formato: é dela que sai a
 * derivação de `receita ÷ leads → currency`. O compositor lê daqui para dizer
 * "essa conta não fecha" antes de o banco dizer.
 */
export const UNIDADE_DA_MEDIDA: Record<string, MetricUnit> = {
  receita: "currency",
  num_vendas: "count",
  leads_criados: "count",
  reunioes_marcadas: "count",
  reunioes_realizadas: "count",
  leads_na_etapa: "count",
  tempo_medio_etapa: "duration_seconds",
  leads_sem_responsavel: "count",
  leads_avaliados: "count",
  leads_nao_avaliados: "count",
  boas_avaliacoes: "count",
  negocios_perdidos: "count",
  reunioes_no_show: "count",
  tempo_resposta_equipe: "duration_seconds",
  negocios_na_etapa: "count",
  negocios_abertos: "count",
};

/**
 * O que o Estúdio oferece de FÁBRICA: 16 medidas + 5 razões.
 *
 * As personalizadas do cliente NÃO entram nesta constante — elas vêm do banco
 * (`metric_custom_definitions`) e são juntadas em runtime por
 * `useStudioCatalog`. Esta lista é o que o motor calcula sem ninguém compor.
 *
 * Fora daqui, com o motivo:
 *   - `meta_definida` → alvo é campo do payload, não medida (SCRUM-365)
 *   - `curva_abc`, `taxa_resposta_automacao` → não existem
 *   - as demais do inventário → vivem em hook legado (SCRUM-311 as porta)
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
  // SCRUM-311 fatia 9 — LEAD ≠ NEGÓCIO, e a janela salva não muda de id.
  //
  // Este item já se chamava "Negócios na etapa" na tela, mas apontava para
  // `leads_na_etapa`, que conta ENTRADA. Medido em prod (2026-08-12): 41.025
  // entradas para 36.073 leads distintos — 12% de diferença que ninguém via. O
  // `id` do StudioMetric fica: painel salvo referencia `negocios_por_etapa` e
  // continua abrindo. O que muda é para onde ele aponta.
  {
    id: "negocios_por_etapa",
    label: "Negócios na etapa",
    measureRef: { kind: "leaf", id: "negocios_na_etapa" },
    cortes: ["total", "etapa", "pipeline"],
    formatId: "integer",
  },
  {
    // A outra metade da separação: pessoa distinta. Um lead com 3 negócios
    // conta 1 aqui e 3 acima — e é isso que o E2E do lead com dois negócios
    // prova.
    id: "leads_na_etapa",
    label: "Leads na etapa",
    measureRef: { kind: "leaf", id: "leads_na_etapa" },
    cortes: ["total", "etapa", "pipeline"],
    formatId: "integer",
  },
  {
    id: "negocios_abertos",
    label: "Negócios abertos",
    measureRef: { kind: "leaf", id: "negocios_abertos" },
    cortes: ["total", "tempo", "origem", "pipeline", "etapa"],
    formatId: "integer",
  },
  {
    id: "leads_sem_responsavel",
    label: "Leads sem responsável",
    measureRef: { kind: "leaf", id: "leads_sem_responsavel" },
    cortes: ["total", "origem", "tag"],
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

  // SCRUM-311 fatias 2-8 — o motor já as calcula desde a pilha do épico; até
  // aqui nenhuma aparecia na lista lateral, o que é o mesmo que não existir
  // para quem usa o produto.
  {
    id: "negocios_perdidos",
    label: "Negócios perdidos",
    measureRef: { kind: "leaf", id: "negocios_perdidos" },
    cortes: ["total", "tempo", "origem", "closer", "pipeline"],
    formatId: "integer",
  },
  {
    id: "leads_avaliados",
    label: "Leads avaliados",
    measureRef: { kind: "leaf", id: "leads_avaliados" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    id: "leads_nao_avaliados",
    label: "Leads não avaliados",
    measureRef: { kind: "leaf", id: "leads_nao_avaliados" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    id: "boas_avaliacoes",
    label: "Boas avaliações",
    measureRef: { kind: "leaf", id: "boas_avaliacoes" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    // O rótulo diz REGISTRO, não comparecimento — medido em prod: 627 marcadas
    // × 159 comparecidas, e o cliente não falta a 3 de cada 4 reuniões. A
    // medida enxerga a lacuna de registro, e o nome não pode prometer outra
    // coisa (ver o cabeçalho de 20270812120000).
    id: "reunioes_no_show",
    label: "Reuniões sem comparecimento registrado",
    measureRef: { kind: "leaf", id: "reunioes_no_show" },
    cortes: ["total", "tempo", "origem", "sdr"],
    formatId: "integer",
  },
  {
    id: "tempo_resposta_equipe",
    label: "Tempo médio de resposta",
    measureRef: { kind: "leaf", id: "tempo_resposta_equipe" },
    cortes: ["total", "tempo", "origem"],
    formatId: "duration_human",
  },

  // Razões: profundidade 1, dois filhos, ambos forçados a 'total' pelo motor.
  // `series` vem SEMPRE null — a UI não oferece corte nem gráfico de série.
  {
    // Renomeada na fatia 9: o denominador é LEAD, e sob a unidade nova isso
    // precisa estar no rótulo. Um lead com 3 negócios entra UMA vez aqui e pode
    // ganhar TRÊS — a taxa passa de 100% e não é defeito, é a pergunta que ela
    // responde. Quem quer conversão na unidade do funil usa a de baixo.
    id: "taxa_conversao",
    label: "Taxa de conversão por lead",
    measureRef: { kind: "ratio", num: "num_vendas", den: "leads_criados" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    id: "taxa_conversao_negocio",
    label: "Taxa de conversão por negócio",
    measureRef: { kind: "ratio", num: "num_vendas", den: "negocios_abertos" },
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
  {
    // SCRUM-311 fatia 7. Os dois filhos ancoram em `entradas` e o numerador é
    // subconjunto do denominador — a razão vive em [0, 100] por construção.
    id: "taxa_qualidade",
    label: "Taxa de qualidade de leads",
    measureRef: { kind: "ratio", num: "boas_avaliacoes", den: "leads_avaliados" },
    cortes: ["total"],
    formatId: "percent_1",
  },
];

export const ENGINE_BY_ID = new Map(ENGINE_METRICS.map((m) => [m.id, m]));

/**
 * Ids de medida referenciados (1 para leaf, 2 para razão).
 *
 * Personalizada devolve lista vazia: os operandos dela vivem na árvore, do lado
 * do banco, e quem precisa deles é o compositor — não este mapa.
 */
export function medidasDe(m: EngineMetric): string[] {
  if (m.measureRef.kind === "leaf") return [m.measureRef.id];
  if (m.measureRef.kind === "ratio") return [m.measureRef.num, m.measureRef.den];
  return [];
}

/**
 * Razão e personalizada são SEMPRE escalares — o motor devolve `series: null`
 * nas duas. Leaf é escalar só no corte `total`.
 */
export function ehEscalar(m: EngineMetric, corte: MetricRecorte): boolean {
  return m.measureRef.kind !== "leaf" || corte === "total";
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
  if (m.measureRef.kind !== "leaf") return true;
  return COMPATIBILIDADE[m.measureRef.id]?.includes(corte) ?? false;
}
