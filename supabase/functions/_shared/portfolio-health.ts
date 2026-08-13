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
