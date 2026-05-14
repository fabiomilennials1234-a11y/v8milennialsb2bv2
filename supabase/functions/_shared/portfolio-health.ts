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
