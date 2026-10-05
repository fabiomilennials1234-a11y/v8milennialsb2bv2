export type HealthDimensions = {
  recency: number;
  frequency: number;
  ticket: number;
  engagement: number;
};

export type HealthStatus = "saudavel" | "atencao" | "risco" | "inativo";
export type Segment = "ouro" | "prata" | "novo" | "resgate" | "dormindo";

export type SignalType =
  | "reorder_overdue"
  | "ticket_declining"
  | "product_missing"
  | "cycle_stretching"
  | "engagement_cold"
  | "nps_low";

export type DetectedSignal = {
  type: SignalType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
};

export type ProductFrequency = {
  productName: string;
  appearsInPct: number;
};

export type SignalInput = {
  daysSinceLastOrder: number;
  cycleDays: number;
  lastThreeTickets: number[];
  historicalAvgTicket: number;
  productFrequencies: ProductFrequency[];
  lastOrderProducts: string[];
  daysSinceLastWhatsAppReply: number | null;
  lastNpsScore: number | null;
};

const WEIGHTS = { recency: 0.35, frequency: 0.25, ticket: 0.25, engagement: 0.15 };

export const DEFAULT_CYCLE_DAYS = 30;

// ─── Pedido real vs linha de item ────────────────────────────────────────────
//
// `upsell_orders` grava UMA LINHA POR ITEM de produto — não existe coluna que
// agrupe as linhas de um mesmo pedido (`external_id` do Tiny é por linha). Tratar
// linha como pedido fazia uma venda de 2 itens virar "2 pedidos separados por 0
// dia" → ciclo de recompra = 1 dia → o KPI de Receita Recorrente multiplicava o
// ticket por 30 (30/ciclo). Medido no PROD 2026-08-13: 107 clientes na frota,
// 99 deles na Basic4u (ciclo médio 18 → 41, ticket médio R$ 1.278 → R$ 1.999).
//
// Pedido = todas as linhas do mesmo cliente no mesmo DIA UTC de `sold_at`.
// UTC (e não America/Sao_Paulo) porque tem que casar exatamente com o
// `(sold_at AT TIME ZONE 'UTC')::date` do gêmeo em SQL — se as duas
// implementações divergirem, o valor gravado oscila entre a trigger e o cron de
// 30min (ver src/modules/carteira/CLAUDE.md). Diferença medida entre os dois
// fusos no PROD: 1 cliente em 333.

export type OrderLike = { sold_at: string; sale_value: number | string };

export type DayOrder = {
  /** dia UTC no formato YYYY-MM-DD — espelha `(sold_at AT TIME ZONE 'UTC')::date` */
  day: string;
  /** soma de `sale_value` de todas as linhas daquele dia */
  saleValue: number;
};

/**
 * Colapsa linhas de item no pedido real (cliente + dia UTC), somando o valor.
 * Retorna ordenado por dia ASC. Linhas com `sold_at` inválido são descartadas
 * (antes viravam NaN no ciclo e contaminavam a média).
 */
export function groupOrdersByDay(orders: OrderLike[]): DayOrder[] {
  const byDay = new Map<string, number>();

  for (const o of orders) {
    const ts = new Date(o.sold_at);
    if (Number.isNaN(ts.getTime())) continue;
    const day = ts.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(o.sale_value ?? 0));
  }

  return [...byDay.entries()]
    .map(([day, saleValue]) => ({ day, saleValue }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Ciclo de recompra = média dos gaps entre DIAS distintos de compra.
 * Menos de 2 pedidos → não há gap pra medir, cai no default da org.
 */
export function computeCycleDays(dayOrders: DayOrder[], orgDefault?: number): number {
  const fallback = orgDefault ?? DEFAULT_CYCLE_DAYS;
  if (dayOrders.length < 2) return fallback;

  const gaps: number[] = [];
  for (let i = 1; i < dayOrders.length; i++) {
    const prev = new Date(`${dayOrders[i - 1].day}T00:00:00Z`).getTime();
    const curr = new Date(`${dayOrders[i].day}T00:00:00Z`).getTime();
    gaps.push(Math.abs(curr - prev) / (1000 * 60 * 60 * 24));
  }

  return Math.max(1, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length));
}

export function calculateRecencyScore(daysSinceLast: number, cycleDays: number): number {
  if (cycleDays <= 0) return 50;
  if (daysSinceLast <= cycleDays) return 100;
  const overdue = daysSinceLast / cycleDays - 1;
  return Math.max(0, Math.round(100 - overdue * 100));
}

export function calculateFrequencyScore(recentCount: number, historicalCount: number): number {
  if (historicalCount <= 0) return 50;
  return Math.min(100, Math.round((recentCount / historicalCount) * 100));
}

export function calculateTicketScore(recentAvg: number, historicalAvg: number): number {
  if (historicalAvg <= 0) return 50;
  return Math.min(100, Math.round((recentAvg / historicalAvg) * 100));
}

export function calculateHealthScore(dims: HealthDimensions): number {
  return Math.round(
    dims.recency * WEIGHTS.recency +
    dims.frequency * WEIGHTS.frequency +
    dims.ticket * WEIGHTS.ticket +
    dims.engagement * WEIGHTS.engagement
  );
}

export function deriveHealthStatus(score: number): HealthStatus {
  if (score >= 80) return "saudavel";
  if (score >= 60) return "atencao";
  if (score >= 30) return "risco";
  return "inativo";
}

export function deriveSegment(
  healthScore: number,
  avgTicket: number,
  orgAvgTicket: number,
  orderCount: number,
): Segment {
  if (orderCount < 3) return "novo";
  if (healthScore < 30) return "dormindo";
  if (healthScore < 60 && orderCount >= 5) return "resgate";
  if (healthScore >= 80 && avgTicket >= orgAvgTicket && orderCount >= 5) return "ouro";
  if (healthScore >= 60 && orderCount >= 3) return "prata";
  return "prata";
}

export type Trend = "up" | "stable" | "down";

export function deriveTrend(
  lastThreeTickets: number[],
  historicalAvg: number,
): Trend {
  if (lastThreeTickets.length < 3 || historicalAvg <= 0) return "stable";
  const recentAvg =
    lastThreeTickets.reduce((s, v) => s + v, 0) / lastThreeTickets.length;
  if (recentAvg > historicalAvg * 1.1) return "up";
  if (recentAvg < historicalAvg * 0.9) return "down";
  return "stable";
}

function whatsappRecencyToScore(days: number): number {
  if (days <= 3) return 100;
  if (days <= 7) return 75;
  if (days <= 14) return 50;
  if (days <= 30) return 25;
  return 0;
}

export function calculateEngagementScore(
  contextEngagement: number | null,
  daysSinceLastIncoming: number | null,
): number {
  const ctxScore = contextEngagement != null ? contextEngagement : null;
  const waScore =
    daysSinceLastIncoming != null
      ? whatsappRecencyToScore(daysSinceLastIncoming)
      : null;

  if (ctxScore != null && waScore != null) {
    return Math.round(ctxScore * 0.6 + waScore * 0.4);
  }
  if (ctxScore != null) return ctxScore;
  if (waScore != null) return waScore;
  return 50;
}

export function calculateChurnProbability(input: SignalInput, healthScore: number): number {
  let score = 0;

  // Cycle stretching: days_since > cycle * 1.15 → +20
  if (input.cycleDays > 0 && input.daysSinceLastOrder > input.cycleDays * 1.15) {
    const ratio = input.daysSinceLastOrder / input.cycleDays;
    score += Math.min(20, Math.round((ratio - 1) * 40));
  }

  // Ticket declining: 3 consecutive drops → +25
  const t = input.lastThreeTickets;
  if (t.length === 3 && t[0] > t[1] && t[1] > t[2]) {
    const dropPct = (1 - t[2] / t[0]) * 100;
    score += Math.min(25, Math.round(dropPct * 0.5));
  }

  // No WhatsApp reply > 7d → +20
  if (input.daysSinceLastWhatsAppReply != null && input.daysSinceLastWhatsAppReply > 7) {
    score += Math.min(20, Math.round(input.daysSinceLastWhatsAppReply * 1.5));
  }

  // Product missing from last order → +10
  const missingProducts = input.productFrequencies.filter(
    (pf) => pf.appearsInPct >= 80 && !input.lastOrderProducts.includes(pf.productName),
  );
  if (missingProducts.length > 0) score += 10;

  // Health < 40 → +15
  if (healthScore < 40) score += 15;

  // NPS <= 2 → +10
  if (input.lastNpsScore != null && input.lastNpsScore <= 2) score += 10;

  return Math.min(100, Math.max(0, score));
}

export function detectSignals(input: SignalInput): DetectedSignal[] {
  const signals: DetectedSignal[] = [];

  // Reorder overdue
  if (input.cycleDays > 0 && input.daysSinceLastOrder > input.cycleDays * 1.15) {
    const daysOverdue = Math.round(input.daysSinceLastOrder - input.cycleDays);
    signals.push({
      type: "reorder_overdue",
      severity: daysOverdue > 7 ? "critical" : "warning",
      title: `Recompra ${daysOverdue} dias atrasada`,
      description: `Ciclo médio: ${input.cycleDays}d. Último pedido há ${input.daysSinceLastOrder}d.`,
      metadata: { daysOverdue, cycleDays: input.cycleDays },
    });
  }

  // Ticket declining (3 consecutive drops)
  const t = input.lastThreeTickets;
  if (t.length === 3 && t[0] > t[1] && t[1] > t[2]) {
    const dropPct = Math.round((1 - t[2] / t[0]) * 100);
    signals.push({
      type: "ticket_declining",
      severity: "warning",
      title: `Ticket caindo ${dropPct}% em 3 pedidos`,
      description: `Sequência: R$${t[0].toLocaleString()} → R$${t[1].toLocaleString()} → R$${t[2].toLocaleString()}`,
      metadata: { tickets: t, dropPct },
    });
  }

  // Product missing
  for (const pf of input.productFrequencies) {
    if (pf.appearsInPct >= 80 && !input.lastOrderProducts.includes(pf.productName)) {
      signals.push({
        type: "product_missing",
        severity: "info",
        title: `Produto ausente: ${pf.productName}`,
        description: `Presente em ${pf.appearsInPct}% dos pedidos anteriores, ausente no último.`,
        metadata: { productName: pf.productName, historicalPct: pf.appearsInPct },
      });
    }
  }

  // Engagement cold
  if (
    input.daysSinceLastWhatsAppReply != null &&
    input.daysSinceLastWhatsAppReply > 7 &&
    input.daysSinceLastOrder > input.cycleDays
  ) {
    signals.push({
      type: "engagement_cold",
      severity: "critical",
      title: "Sem resposta há 7+ dias + recompra atrasada",
      description: `Última resposta WhatsApp há ${input.daysSinceLastWhatsAppReply} dias.`,
      metadata: { daysSinceReply: input.daysSinceLastWhatsAppReply },
    });
  }

  // NPS low
  if (input.lastNpsScore != null && input.lastNpsScore <= 2) {
    signals.push({
      type: "nps_low",
      severity: "critical",
      title: `NPS baixo: ${input.lastNpsScore}/5`,
      description: "Último feedback com nota ≤ 2. Escalar para contato humano.",
      metadata: { npsScore: input.lastNpsScore },
    });
  }

  return signals;
}

// ─── Score de um cliente (extraído de calculate-portfolio-health) ────────────
//
// Corpo antigo de `processClient` (index.ts:113-245), sem I/O: a edge function
// lê as entradas em lote via `portfolio_health_inputs`, chama isto em memória
// e grava em lote via `portfolio_health_apply`. Nenhuma regra mudou na
// extração — tests/unit/portfolio-health-compute.test.ts compara com uma cópia
// congelada do corpo antigo.

const DAY_MS = 1000 * 60 * 60 * 24;
const NEW_CLIENT_SCORE = 70; // < 3 linhas de pedido → score neutro
const ENGAGEMENT_DEFAULT = 50; // sem lead → neutro

export type HealthOrder = {
  id?: string;
  sale_value: number | string;
  sold_at: string;
  product_name: string;
};

export type ClientHealthInput = {
  leadId: string | null;
  /** `upsell_clients.last_order_at` — semeado por import de carteira sem linha de pedido */
  lastOrderAtStored: string | null;
  /** linhas APROVADAS, já ordenadas por `sold_at, id` */
  orders: HealthOrder[];
  /** `conversation_context_summary.engagement_score` do lead */
  ctxEngagement: number | null;
  /** `timestamp` da última mensagem `incoming` do lead */
  lastIncomingAt: string | null;
};

export type OrgHealthContext = {
  /** média por LINHA aprovada da org — ver orgAvgTicketFrom */
  orgAvgTicket: number;
  defaultCycleDays?: number;
};

/** As colunas de saúde de `upsell_clients` (menos `health_updated_at`, que é do apply). */
export type ClientHealthUpdate = {
  health_score: number;
  health_status: HealthStatus;
  segment: Segment;
  reorder_cycle_days: number;
  days_since_last_order: number;
  last_order_at: string | null;
  next_order_expected: string | null;
  order_count: number;
  lifetime_value: number;
  avg_ticket: number | null;
  trend: Trend;
  churn_probability: number;
};

export type ClientHealthResult = {
  update: ClientHealthUpdate;
  snapshot: { health_score: number; health_status: HealthStatus; segment: Segment };
  signals: DetectedSignal[];
};

/** Ticket médio da org por linha aprovada: soma / contagem (0 sem pedido). */
export function orgAvgTicketFrom(
  approvedSum: number | string | null | undefined,
  approvedCount: number | null | undefined,
): number {
  const n = Number(approvedCount ?? 0);
  return n > 0 ? Number(approvedSum ?? 0) / n : 0;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / DAY_MS;
}

function productFrequencies(orders: HealthOrder[]): ProductFrequency[] {
  if (orders.length === 0) return [];
  const counts: Record<string, number> = {};
  for (const o of orders) {
    counts[o.product_name] = (counts[o.product_name] ?? 0) + 1;
  }
  return Object.entries(counts).map(([productName, count]) => ({
    productName,
    appearsInPct: Math.round((count / orders.length) * 100),
  }));
}

export function computeClientHealth(
  input: ClientHealthInput,
  org: OrgHealthContext,
  now: Date,
): ClientHealthResult {
  let engagementScore = ENGAGEMENT_DEFAULT;
  let daysSinceLastIncoming: number | null = null;

  if (input.leadId) {
    daysSinceLastIncoming = input.lastIncomingAt
      ? Math.round(daysBetween(new Date(input.lastIncomingAt), now))
      : null;
    engagementScore = calculateEngagementScore(input.ctxEngagement, daysSinceLastIncoming);
  }

  const orderList = input.orders;

  // `upsell_orders` é linha-por-ITEM. `dayOrders` colapsa no pedido real
  // (cliente + dia UTC de sold_at) — ver groupOrdersByDay acima.
  const dayOrders = groupOrdersByDay(orderList);

  // ⚠️ ESCOPO DELIBERADO (decisão do CTO, 2026-08-13): o agrupamento por pedido
  // alimenta SÓ o ciclo de recompra e o avg_ticket gravado. `order_count`
  // continua contando LINHAS de propósito: é entrada de `deriveSegment`
  // (< 3 → 'novo', >= 5 → 'ouro'/'resgate'), e trocá-lo jogaria 145 dos 148
  // clientes da Basic4u pra 'novo'. Consequência aceita: para cliente com
  // pedido multi-item, lifetime_value / order_count ≠ avg_ticket.
  const orderCount = orderList.length;
  const cycleDays = computeCycleDays(dayOrders, org.defaultCycleDays);

  const sorted = [...orderList].sort(
    (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime(),
  );
  const lastOrder = sorted.at(-1);
  // Import de carteira por CSV semeia `last_order_at` sem linha de pedido (a
  // planilha traz a data mas não o valor, e sale_value tem CHECK > 0). Sem
  // pedido, cai na data gravada para recência e atraso sobreviverem ao recálculo.
  const importedLastOrderAt =
    !lastOrder && input.lastOrderAtStored ? new Date(input.lastOrderAtStored) : null;
  const lastOrderAt = lastOrder ? new Date(lastOrder.sold_at) : importedLastOrderAt;
  const daysSinceLastOrder = lastOrderAt ? Math.round(daysBetween(lastOrderAt, now)) : 999;

  const totalValue = orderList.reduce((s, o) => s + Number(o.sale_value), 0);

  // Gravado em avg_ticket: total / PEDIDOS (o que a tela e o KPI mostram).
  const avgTicket = dayOrders.length > 0 ? totalValue / dayOrders.length : 0;

  // Só nos SCORES: total / LINHAS — as contrapartes comparadas (recentAvg,
  // lastThreeTickets, orgAvgTicket) também são por linha.
  const scoringAvgTicket = orderCount > 0 ? totalValue / orderCount : 0;

  const cutoff90 = new Date(now.getTime() - 90 * DAY_MS);
  const recent90 = orderList.filter((o) => new Date(o.sold_at) >= cutoff90);
  const historicalCount = Math.max(1, Math.ceil((orderCount * 90) / 365)); // esperado em 90d

  const lastThreeTickets = sorted.slice(-3).map((o) => Number(o.sale_value));

  const recencyScore = lastOrderAt ? calculateRecencyScore(daysSinceLastOrder, cycleDays) : 0;
  const frequencyScore = calculateFrequencyScore(recent90.length, historicalCount);
  const recentAvg =
    recent90.length > 0
      ? recent90.reduce((s, o) => s + Number(o.sale_value), 0) / recent90.length
      : 0;
  const ticketScore = calculateTicketScore(recentAvg, scoringAvgTicket || 1);

  const healthScore =
    orderCount < 3
      ? NEW_CLIENT_SCORE
      : calculateHealthScore({
          recency: recencyScore,
          frequency: frequencyScore,
          ticket: ticketScore,
          engagement: engagementScore,
        });

  const healthStatus = deriveHealthStatus(healthScore);
  const segment = deriveSegment(healthScore, scoringAvgTicket, org.orgAvgTicket, orderCount);
  const trend = deriveTrend(lastThreeTickets, scoringAvgTicket);

  const nextOrderExpected = lastOrderAt
    ? new Date(lastOrderAt.getTime() + cycleDays * DAY_MS)
    : null;

  const signalInput: SignalInput = {
    daysSinceLastOrder,
    cycleDays,
    lastThreeTickets,
    historicalAvgTicket: scoringAvgTicket,
    productFrequencies: productFrequencies(orderList),
    lastOrderProducts: lastOrder ? [lastOrder.product_name] : [],
    daysSinceLastWhatsAppReply: daysSinceLastIncoming,
    lastNpsScore: null,
  };
  const churnProbability =
    orderCount < 3 ? 0 : calculateChurnProbability(signalInput, healthScore);

  return {
    update: {
      health_score: healthScore,
      health_status: healthStatus,
      segment,
      reorder_cycle_days: cycleDays,
      days_since_last_order: daysSinceLastOrder,
      last_order_at: lastOrderAt?.toISOString() ?? null,
      next_order_expected: nextOrderExpected?.toISOString() ?? null,
      order_count: orderCount,
      lifetime_value: totalValue,
      avg_ticket: avgTicket || null,
      trend,
      churn_probability: churnProbability,
    },
    snapshot: { health_score: healthScore, health_status: healthStatus, segment },
    signals: detectSignals(signalInput),
  };
}

// ─── Contrato com as RPCs portfolio_health_inputs / portfolio_health_apply ────

/** Um cliente como `portfolio_health_inputs` devolve. */
export type PortfolioInputsClient = {
  id: string;
  lead_id: string | null;
  closer_id: string | null;
  name: string;
  last_order_at: string | null;
  orders: HealthOrder[];
  ctx_engagement: number | null;
  last_incoming_at: string | null;
};

/** Campos da org — só na 1ª página (`p_after` nulo). */
export type PortfolioInputsOrg = {
  default_reorder_cycle_days: number | null;
  approved_sum: number | string | null;
  approved_count: number | null;
  whatsapp_alerts_enabled: boolean;
  retention_config: Record<string, unknown> | null;
};

/** Uma linha do `p_results` de `portfolio_health_apply`. */
export type PortfolioApplyRow = ClientHealthUpdate & {
  client_id: string;
  signals: {
    alert_type: SignalType;
    severity: DetectedSignal["severity"];
    title: string;
    description: string;
    metadata: Record<string, unknown>;
  }[];
};

export function healthInputFromRow(row: PortfolioInputsClient): ClientHealthInput {
  return {
    leadId: row.lead_id,
    lastOrderAtStored: row.last_order_at,
    orders: row.orders ?? [],
    ctxEngagement: row.ctx_engagement ?? null,
    lastIncomingAt: row.last_incoming_at ?? null,
  };
}

export function applyRowFrom(clientId: string, result: ClientHealthResult): PortfolioApplyRow {
  return {
    client_id: clientId,
    ...result.update,
    signals: result.signals.map((s) => ({
      alert_type: s.type,
      severity: s.severity,
      title: s.title,
      description: s.description,
      metadata: s.metadata,
    })),
  };
}
