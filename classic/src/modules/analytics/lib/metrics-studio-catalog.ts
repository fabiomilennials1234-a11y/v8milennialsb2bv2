/**
 * Catálogo do Estúdio de Métricas (SCRUM-11 / épico #1194 · ADR-0023).
 *
 * Fonte da listagem lateral: TODAS as métricas que o sistema pode expor, não só
 * as que já estão prontas. Cada entrada carrega o `readiness` medido contra o
 * código de hoje (`src/modules/analytics/`), então a barra lateral é ao mesmo
 * tempo a UI e o mapa do que falta construir.
 *
 * `composable: true` = a medida JÁ existe no catálogo fechado servido por
 * `fn_metric_catalog()` (migration 20260723100000 + 20260727140000), ou seja o
 * motor `fn_metric_measure` sabe calculá-la sem código novo. As demais vivem em
 * hooks legados (ou não existem) e precisam ser portadas para o motor antes de
 * virarem widget de verdade.
 *
 * Este arquivo é DADO, não lógica: trocar o gerador de amostra por
 * `useMetricMeasure` não deve exigir mexer aqui.
 */

export type MetricUnit = "currency" | "count" | "percent" | "duration" | "ratio";

/** G3 do grill: vela saiu — o motor não tem OHLC e não existe definição de
 *  negócio para abertura/máxima/mínima de faturamento. */
export type ChartKind = "number" | "line" | "pie";

export type MetricReadiness = "pronta" | "parcial" | "ausente";

export type MetricFamilyId =
  | "aquisicao"
  | "conversao"
  | "receita"
  | "equipe"
  | "qualidade"
  | "reuniao"
  | "meta"
  | "origem"
  | "negocio";

export interface StudioMetric {
  id: string;
  label: string;
  family: MetricFamilyId;
  unit: MetricUnit;
  /** Uma linha — vira o subtítulo da janela e o tooltip da lista. */
  description: string;
  readiness: MetricReadiness;
  /** Já é medida do catálogo fechado (motor sabe calcular). */
  composable?: boolean;
  /** Onde a métrica vive hoje — some quando tudo estiver no motor. */
  source: string;
  /** Formas de exibição que fazem sentido. `number` é sempre a primeira. */
  charts: ChartKind[];
}

export interface MetricFamily {
  id: MetricFamilyId;
  label: string;
}

export const METRIC_FAMILIES: MetricFamily[] = [
  { id: "aquisicao", label: "Aquisição" },
  { id: "conversao", label: "Conversão" },
  { id: "receita", label: "Receita" },
  { id: "negocio", label: "Negócios" },
  { id: "reuniao", label: "Reuniões" },
  { id: "equipe", label: "Equipe e resposta" },
  { id: "qualidade", label: "Qualidade de lead" },
  { id: "meta", label: "Metas" },
  { id: "origem", label: "Origem" },
];

const SERIES: ChartKind[] = ["number", "line"];
const BREAKDOWN: ChartKind[] = ["number", "line", "pie"];
const FULL: ChartKind[] = ["number", "line", "pie"];

export const STUDIO_METRICS: StudioMetric[] = [
  // ── Aquisição ────────────────────────────────────────────────────────────
  {
    id: "leads_criados",
    label: "Leads que entraram",
    family: "aquisicao",
    unit: "count",
    description: "Leads criados na janela (metrics_period_at ou created_at).",
    readiness: "pronta",
    composable: true,
    source: "medida leads_criados · useDashboardMetrics.totalLeads",
    charts: FULL,
  },
  {
    id: "leads_sem_responsavel",
    label: "Leads sem responsável",
    family: "aquisicao",
    unit: "count",
    description: "Leads ativos sem dono atribuído — fila órfã da operação.",
    readiness: "parcial",
    source: "useLeadsStats.withOwner expõe só o complemento (módulo leads)",
    charts: BREAKDOWN,
  },

  // ── Conversão ────────────────────────────────────────────────────────────
  {
    id: "taxa_conversao",
    label: "Taxa Leads → Clientes",
    family: "conversao",
    unit: "percent",
    description: "Leads com negócio ganho sobre o total de leads da janela.",
    readiness: "pronta",
    composable: true,
    source: "razão conversao (num_vendas ÷ leads_criados)",
    charts: SERIES,
  },
  {
    id: "ganho_perda",
    label: "Ganho e perda",
    family: "conversao",
    unit: "count",
    description: "Negócios ganhos contra perdidos na janela.",
    readiness: "pronta",
    source: "useWinLossAnalysis · WinLossAnalysis",
    charts: BREAKDOWN,
  },
  {
    id: "motivos_perda",
    label: "Motivos de perda",
    family: "conversao",
    unit: "count",
    description: "Distribuição dos motivos registrados na saída do funil.",
    readiness: "pronta",
    source: "tabela loss_reasons · useLossReasons · LossReasonsCard",
    charts: BREAKDOWN,
  },
  {
    id: "taxa_pre_venda",
    label: "Vendas com pré-venda",
    family: "conversao",
    unit: "percent",
    description: "Fatia das vendas que passou por pré-venda antes do fechamento.",
    readiness: "parcial",
    source: "insumo em useFunnelHealth.depth (pre_only/final) — sem KPI único",
    charts: SERIES,
  },

  // ── Receita ──────────────────────────────────────────────────────────────
  {
    id: "receita",
    label: "Faturamento",
    family: "receita",
    unit: "currency",
    description: "Σ sale_value de vendas não estornadas no período.",
    readiness: "pronta",
    composable: true,
    source: "medida receita · receita canônica (área frágil)",
    charts: FULL,
  },
  {
    id: "ticket_medio",
    label: "Ticket médio",
    family: "receita",
    unit: "currency",
    description: "Faturamento dividido pelo número de vendas.",
    readiness: "pronta",
    composable: true,
    source: "razão ticket_medio · useDashboardMetrics.ticketMedio",
    charts: FULL,
  },
  {
    id: "ltv",
    label: "LTV do cliente",
    family: "receita",
    unit: "currency",
    description: "Valor total esperado por cliente ao longo do relacionamento.",
    readiness: "parcial",
    source: "useAnalyticsOverview.UnitEconomics.ltv_estimate — estimativa agregada",
    charts: SERIES,
  },
  {
    id: "curva_abc",
    label: "Curva ABC de produtos",
    family: "receita",
    unit: "currency",
    description: "Produtos classificados por participação acumulada na receita.",
    readiness: "ausente",
    source: "só ranking bruto em ProductRanking — falta a classificação A/B/C",
    charts: BREAKDOWN,
  },

  // ── Negócios ─────────────────────────────────────────────────────────────
  {
    id: "negocios_por_funil",
    label: "Negócios por funil",
    family: "negocio",
    unit: "count",
    description: "Volume de negócios abertos distribuído por funil.",
    readiness: "pronta",
    composable: true,
    source: "recorte pipeline · useAnalyticsPipesFunis",
    charts: BREAKDOWN,
  },
  {
    id: "negocios_por_etapa",
    label: "Negócios por etapa",
    family: "negocio",
    unit: "count",
    description: "Estado atual: negócios parados em cada etapa.",
    readiness: "pronta",
    composable: true,
    source: "medida leads_na_etapa · recorte etapa · StageAnalysis",
    charts: BREAKDOWN,
  },
  {
    id: "negocios_por_lead",
    label: "Negócios por lead",
    family: "negocio",
    unit: "ratio",
    description: "Média de negócios abertos por lead/cliente da base.",
    readiness: "ausente",
    source: "ADR-0023-negocio existe, métrica não",
    charts: SERIES,
  },
  {
    id: "tempo_medio_etapa",
    label: "Tempo médio na etapa",
    family: "negocio",
    unit: "duration",
    description: "Dwell médio na etapa a partir do caderno de transições.",
    readiness: "pronta",
    composable: true,
    source: "medida tempo_medio_etapa",
    charts: BREAKDOWN,
  },

  // ── Reuniões ─────────────────────────────────────────────────────────────
  {
    id: "reunioes_marcadas",
    label: "Reuniões marcadas",
    family: "reuniao",
    unit: "count",
    description: "meeting_events booked no período.",
    readiness: "pronta",
    composable: true,
    source: "medida reunioes_marcadas (event-sourced, ADR-0007)",
    charts: FULL,
  },
  {
    id: "reunioes_realizadas",
    label: "Reuniões comparecidas",
    family: "reuniao",
    unit: "count",
    description: "meeting_events held no período.",
    readiness: "pronta",
    composable: true,
    source: "medida reunioes_realizadas",
    charts: FULL,
  },
  {
    id: "reunioes_no_show",
    label: "No-show",
    family: "reuniao",
    unit: "count",
    description: "Marcadas que não compareceram: booked − held, clamp ≥ 0.",
    readiness: "pronta",
    composable: true,
    source: "medida reunioes_no_show (migration 20260727140000)",
    charts: SERIES,
  },

  // ── Equipe e resposta ────────────────────────────────────────────────────
  {
    id: "tempo_resposta_equipe",
    label: "Tempo médio de resposta",
    family: "equipe",
    unit: "duration",
    description: "Quanto a equipe demora para responder o cliente.",
    readiness: "pronta",
    source: "useAnalyticsEngajamento.our_avg_response_seconds · TeamResponseTimes",
    charts: FULL,
  },
  {
    id: "clientes_sem_resposta",
    label: "Clientes sem resposta",
    family: "equipe",
    unit: "count",
    description: "Conversas em que o cliente falou e ninguém respondeu.",
    readiness: "parcial",
    source: "existe a taxa (response_rate_pct), não a contagem nem a lista",
    charts: BREAKDOWN,
  },
  {
    id: "clientes_sem_atuacao",
    label: "Clientes sem atuação",
    family: "equipe",
    unit: "count",
    description: "Sem movimentação, negócio novo ou mensagem há X dias.",
    readiness: "parcial",
    source: "carteira.days_since_last_order cobre só pedido; X não é parametrizável",
    charts: BREAKDOWN,
  },
  {
    id: "taxa_resposta_automacao",
    label: "Taxa de resposta por automação",
    family: "equipe",
    unit: "percent",
    description: "Quantos contatos respondem a cada automação disparada.",
    readiness: "ausente",
    source: "sem métrica em workflows/campaigns — CopilotVsHuman não é isso",
    charts: BREAKDOWN,
  },

  // ── Qualidade de lead ────────────────────────────────────────────────────
  {
    id: "leads_avaliados",
    label: "Leads avaliados",
    family: "qualidade",
    unit: "count",
    description: "Leads que receberam nota de qualificação.",
    readiness: "pronta",
    source: "useFunnelHealth.stages.avaliados",
    charts: SERIES,
  },
  {
    id: "leads_nao_avaliados",
    label: "Leads não avaliados",
    family: "qualidade",
    unit: "count",
    description: "Entraram e ninguém qualificou — dívida da triagem.",
    readiness: "parcial",
    source: "derivável (entraram − avaliados), não exposto",
    charts: SERIES,
  },
  {
    id: "boas_avaliacoes",
    label: "Boas avaliações",
    family: "qualidade",
    unit: "count",
    description: "Leads em tier diamante ou ouro.",
    readiness: "pronta",
    source: "useFunnelHealth.stages.bons + tiers",
    charts: BREAKDOWN,
  },
  {
    id: "taxa_qualidade",
    label: "Taxa de qualidade de leads",
    family: "qualidade",
    unit: "percent",
    description: "Boas avaliações sobre o total de leads avaliados.",
    readiness: "parcial",
    source: "LeadQualityByOrigin por origem — sem KPI agregado",
    charts: SERIES,
  },

  // ── Metas ────────────────────────────────────────────────────────────────
  //
  // ⚠ A família meta NÃO vira medida do catálogo, e isso é decisão, não
  // pendência (SCRUM-389). O motor já devolve `target` no payload de TODA
  // medida com `goal_type` (migration 20260727140000): soma de
  // `goals.target_value` da org no mês do período. Portá-las como medidas
  // criaria uma SEGUNDA verdade sobre meta, com o mesmo join reescrito.
  //
  // O que faltava era a UI ler o campo — feito: a janela do Estúdio mostra
  // "Meta: X" e o percentual atingido quando `target` vem preenchido
  // (`useMetricWindowData.percentualDaMeta`). Alvo ausente não vira barra em
  // zero: a linha inteira some, porque "0% da meta" afirma que nada foi feito.
  //
  // `meta_atingimento` é `valor ÷ target × 100`. O ×100 mora no hook porque
  // `percent_1` apenas sufixa "%": sem ele, meta 87% batida imprime "0,9%".
  {
    id: "meta_definida",
    label: "Meta definida",
    family: "meta",
    unit: "currency",
    description: "Alvo do período lido de goals.target_value.",
    readiness: "pronta",
    composable: true,
    source: "motor serve target (migration 20260727140000) · GoalProgress",
    charts: ["number", "line"],
  },
  {
    id: "meta_atingimento",
    label: "% da meta atingida",
    family: "meta",
    unit: "percent",
    description: "Realizado sobre o alvo definido para o período.",
    readiness: "pronta",
    source: "goalProgress · TeamGoalsGauges",
    charts: SERIES,
  },

  // ── Origem ───────────────────────────────────────────────────────────────
  //
  // ⚠ A família origem NÃO vira medida do catálogo (SCRUM-390), pela decisão G2
  // do grill: o corte é escolha do usuário, não atributo da métrica. "Receita
  // por origem" É Faturamento com corte `origem`; "Ranking de origem" é Leads
  // que entraram (e Nº de vendas) com o mesmo corte.
  //
  // As três medidas já declaram `origem` em `cortes` no `ENGINE_METRICS`, e o
  // motor já aceita o recorte — conferido contra `metric_catalog_measure_recortes`.
  // Portá-las como medidas próprias criaria uma segunda soma de RECEITA, que é
  // dinheiro (ADR-0017 §1) e tem consumidor legado (`useDashboardMetrics`,
  // `useAnalyticsFinanceiro`). Duas somas de dinheiro é uma a mais.
  //
  // O teste `metrics-studio-engine-map.test.ts` guarda a promessa: se alguém
  // tirar `origem` dos cortes dessas medidas, a família origem some da tela sem
  // que ninguém perceba — e é isso que ele reprova.
  {
    id: "ranking_origem",
    label: "Ranking de origem",
    family: "origem",
    unit: "count",
    description: "Origens ordenadas por leads e clientes gerados.",
    readiness: "pronta",
    source: "useMktByOrigin (RPC get_mkt_origin_metrics) · AttributionTable",
    charts: BREAKDOWN,
  },
  {
    id: "receita_por_origem",
    label: "Receita por origem",
    family: "origem",
    unit: "currency",
    description: "Faturamento atribuído a cada origem de lead.",
    readiness: "pronta",
    composable: true,
    source: "recorte origem sobre a medida receita",
    charts: BREAKDOWN,
  },
];

export const METRIC_BY_ID = new Map(STUDIO_METRICS.map((m) => [m.id, m]));

export const READINESS_META: Record<
  MetricReadiness,
  { label: string; hint: string; dot: string; text: string }
> = {
  pronta: {
    label: "Pronta",
    hint: "Já calculada hoje pelo sistema.",
    dot: "bg-emerald-500",
    text: "text-emerald-500",
  },
  parcial: {
    label: "Parcial",
    hint: "Insumo existe, falta consolidar como métrica.",
    dot: "bg-amber-500",
    text: "text-amber-500",
  },
  ausente: {
    label: "A construir",
    hint: "Não existe no sistema hoje.",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
};

export const CHART_KIND_META: Record<ChartKind, { label: string }> = {
  number: { label: "Número" },
  line: { label: "Linha" },
  pie: { label: "Pizza" },
};

/** Paleta categórica do estúdio — dourado da marca na frente, frias atrás. */
export const STUDIO_PALETTE = [
  "hsl(47 100% 50%)",
  "hsl(199 89% 58%)",
  "hsl(160 72% 45%)",
  "hsl(266 85% 68%)",
  "hsl(14 90% 60%)",
  "hsl(220 12% 55%)",
] as const;

export function formatMetricValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "currency":
      return value >= 1000
        ? `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`
        : `R$ ${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
    case "percent":
      return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "ratio":
      return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "duration": {
      const total = Math.round(value);
      if (total < 60) return `${total}s`;
      if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
      return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
    }
    case "count":
    default:
      return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
}
