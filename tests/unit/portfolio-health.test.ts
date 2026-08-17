import { describe, it, expect } from "vitest";
import {
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateTicketScore,
  calculateHealthScore,
  calculateEngagementScore,
  deriveHealthStatus,
  deriveSegment,
  deriveTrend,
  detectSignals,
  groupOrdersByDay,
  computeCycleDays,
} from "../../supabase/functions/_shared/portfolio-health.ts";

describe("calculateRecencyScore", () => {
  it("returns 100 when within cycle", () => {
    expect(calculateRecencyScore(25, 30)).toBe(100);
  });
  it("returns 100 at exact cycle boundary", () => {
    expect(calculateRecencyScore(30, 30)).toBe(100);
  });
  it("decays linearly past cycle", () => {
    expect(calculateRecencyScore(45, 30)).toBe(50);
  });
  it("returns 0 at 2x cycle", () => {
    expect(calculateRecencyScore(60, 30)).toBe(0);
  });
  it("returns 0 beyond 2x cycle", () => {
    expect(calculateRecencyScore(90, 30)).toBe(0);
  });
});

describe("calculateFrequencyScore", () => {
  it("returns 100 when frequency matches", () => {
    expect(calculateFrequencyScore(3, 3)).toBe(100);
  });
  it("caps at 100 when frequency exceeds", () => {
    expect(calculateFrequencyScore(5, 3)).toBe(100);
  });
  it("returns proportional score when frequency drops", () => {
    expect(calculateFrequencyScore(2, 3)).toBe(67);
  });
  it("returns 0 when no recent orders", () => {
    expect(calculateFrequencyScore(0, 3)).toBe(0);
  });
});

describe("calculateTicketScore", () => {
  it("returns 100 when ticket matches", () => {
    expect(calculateTicketScore(10000, 10000)).toBe(100);
  });
  it("caps at 100 when ticket exceeds", () => {
    expect(calculateTicketScore(15000, 10000)).toBe(100);
  });
  it("returns proportional score when ticket drops", () => {
    expect(calculateTicketScore(7000, 10000)).toBe(70);
  });
});

describe("calculateHealthScore", () => {
  it("returns weighted composite", () => {
    const score = calculateHealthScore({
      recency: 100, frequency: 100, ticket: 100, engagement: 100,
    });
    expect(score).toBe(100);
  });
  it("applies correct weights", () => {
    const score = calculateHealthScore({
      recency: 0, frequency: 0, ticket: 0, engagement: 100,
    });
    expect(score).toBe(15);
  });
});

describe("deriveHealthStatus", () => {
  it("returns saudavel for 80+", () => {
    expect(deriveHealthStatus(85)).toBe("saudavel");
  });
  it("returns atencao for 60-79", () => {
    expect(deriveHealthStatus(65)).toBe("atencao");
  });
  it("returns risco for 30-59", () => {
    expect(deriveHealthStatus(45)).toBe("risco");
  });
  it("returns inativo for 0-29", () => {
    expect(deriveHealthStatus(20)).toBe("inativo");
  });
});

describe("deriveSegment", () => {
  it("returns ouro for high health + high ticket + many orders", () => {
    expect(deriveSegment(90, 15000, 10000, 8)).toBe("ouro");
  });
  it("returns prata for good health + stable + enough orders", () => {
    expect(deriveSegment(70, 8000, 10000, 5)).toBe("prata");
  });
  it("returns novo for few orders regardless of health", () => {
    expect(deriveSegment(90, 15000, 10000, 2)).toBe("novo");
  });
  it("returns resgate for low health + was active", () => {
    expect(deriveSegment(40, 8000, 10000, 7)).toBe("resgate");
  });
  it("returns dormindo for very low health", () => {
    expect(deriveSegment(15, 8000, 10000, 10)).toBe("dormindo");
  });
});

describe("detectSignals", () => {
  it("detects reorder_overdue", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 40, cycleDays: 30,
      lastThreeTickets: [10000, 10000, 10000], historicalAvgTicket: 10000,
      productFrequencies: [], lastOrderProducts: [],
      daysSinceLastWhatsAppReply: 2, lastNpsScore: 4,
    });
    expect(signals.find((s) => s.type === "reorder_overdue")).toBeDefined();
    expect(signals.find((s) => s.type === "reorder_overdue")?.severity).toBe("critical");
  });

  it("detects ticket_declining with 3 consecutive drops", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 10, cycleDays: 30,
      lastThreeTickets: [14000, 11000, 9000], historicalAvgTicket: 13000,
      productFrequencies: [], lastOrderProducts: [],
      daysSinceLastWhatsAppReply: 1, lastNpsScore: 5,
    });
    expect(signals.find((s) => s.type === "ticket_declining")).toBeDefined();
  });

  it("does not detect ticket_declining when not 3 consecutive", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 10, cycleDays: 30,
      lastThreeTickets: [14000, 15000, 9000], historicalAvgTicket: 13000,
      productFrequencies: [], lastOrderProducts: [],
      daysSinceLastWhatsAppReply: 1, lastNpsScore: 5,
    });
    expect(signals.find((s) => s.type === "ticket_declining")).toBeUndefined();
  });

  it("detects product_missing", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 10, cycleDays: 30,
      lastThreeTickets: [10000, 10000, 10000], historicalAvgTicket: 10000,
      productFrequencies: [
        { productName: "Resina Epoxi", appearsInPct: 100 },
        { productName: "Catalisador B2", appearsInPct: 90 },
      ],
      lastOrderProducts: ["Resina Epoxi"],
      daysSinceLastWhatsAppReply: 1, lastNpsScore: 5,
    });
    expect(signals.find((s) => s.type === "product_missing")).toBeDefined();
    expect(signals.find((s) => s.type === "product_missing")?.metadata?.productName).toBe("Catalisador B2");
  });
});

describe("deriveTrend", () => {
  it("returns up when recent avg exceeds historical by >10%", () => {
    expect(deriveTrend([15000, 14000, 13000], 10000)).toBe("up");
  });

  it("returns down when recent avg is below historical by >10%", () => {
    expect(deriveTrend([7000, 8000, 9000], 12000)).toBe("down");
  });

  it("returns stable when recent avg is within ±10% of historical", () => {
    expect(deriveTrend([10500, 9800, 10200], 10000)).toBe("stable");
  });

  it("returns stable when fewer than 3 tickets", () => {
    expect(deriveTrend([15000, 14000], 10000)).toBe("stable");
  });

  it("returns stable when historicalAvg is 0", () => {
    expect(deriveTrend([15000, 14000, 13000], 0)).toBe("stable");
  });

  it("returns stable at exactly +10% boundary", () => {
    expect(deriveTrend([11000, 11000, 11000], 10000)).toBe("stable");
  });

  it("returns stable at exactly -10% boundary", () => {
    expect(deriveTrend([9000, 9000, 9000], 10000)).toBe("stable");
  });

  it("returns up when just above +10% boundary", () => {
    expect(deriveTrend([11001, 11001, 11001], 10000)).toBe("up");
  });

  it("returns down when just below -10% boundary", () => {
    expect(deriveTrend([8999, 8999, 8999], 10000)).toBe("down");
  });

  it("returns stable for empty array", () => {
    expect(deriveTrend([], 10000)).toBe("stable");
  });
});

describe("calculateEngagementScore — whatsapp recency only", () => {
  it("returns 100 for 0 days", () => {
    expect(calculateEngagementScore(null, 0)).toBe(100);
  });

  it("returns 100 for 3 days", () => {
    expect(calculateEngagementScore(null, 3)).toBe(100);
  });

  it("returns 75 for 7 days", () => {
    expect(calculateEngagementScore(null, 7)).toBe(75);
  });

  it("returns 50 for 14 days", () => {
    expect(calculateEngagementScore(null, 14)).toBe(50);
  });

  it("returns 25 for 30 days", () => {
    expect(calculateEngagementScore(null, 30)).toBe(25);
  });

  it("returns 0 for 60 days", () => {
    expect(calculateEngagementScore(null, 60)).toBe(0);
  });
});

describe("calculateEngagementScore — combo and fallbacks", () => {
  it("returns weighted combo when both sources present", () => {
    // context=80 * 0.6 = 48, whatsapp(3d)=100 * 0.4 = 40 → 88
    expect(calculateEngagementScore(80, 3)).toBe(88);
  });

  it("returns weighted combo with low whatsapp recency", () => {
    // context=80 * 0.6 = 48, whatsapp(30d)=25 * 0.4 = 10 → 58
    expect(calculateEngagementScore(80, 30)).toBe(58);
  });

  it("returns context score only when whatsapp is null", () => {
    expect(calculateEngagementScore(75, null)).toBe(75);
  });

  it("returns whatsapp score only when context is null", () => {
    expect(calculateEngagementScore(null, 7)).toBe(75);
  });

  it("returns 50 fallback when both are null", () => {
    expect(calculateEngagementScore(null, null)).toBe(50);
  });

  it("handles context=0 as valid (not null)", () => {
    // context=0 * 0.6 = 0, whatsapp(3d)=100 * 0.4 = 40 → 40
    expect(calculateEngagementScore(0, 3)).toBe(40);
  });

  it("handles whatsapp=0 as valid (not null)", () => {
    // context=100 * 0.6 = 60, whatsapp(0d)=100 * 0.4 = 40 → 100
    expect(calculateEngagementScore(100, 0)).toBe(100);
  });
});

describe("groupOrdersByDay", () => {
  it("colapsa linhas de item do mesmo dia em 1 pedido, somando o valor", () => {
    // caso real do PROD (Basic4u): venda de 2 itens no mesmo timestamp
    const grouped = groupOrdersByDay([
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 3180.5 },
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 117.7 },
    ]);
    expect(grouped).toEqual([{ day: "2025-08-12", saleValue: 3298.2 }]);
  });

  it("agrupa linhas do mesmo dia mesmo em horas diferentes", () => {
    const grouped = groupOrdersByDay([
      { sold_at: "2025-08-12T09:15:00Z", sale_value: 100 },
      { sold_at: "2025-08-12T18:40:00Z", sale_value: 50 },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].saleValue).toBe(150);
  });

  it("mantém dias distintos separados e ordenados ASC", () => {
    const grouped = groupOrdersByDay([
      { sold_at: "2025-09-10T10:00:00Z", sale_value: 300 },
      { sold_at: "2025-08-12T10:00:00Z", sale_value: 100 },
      { sold_at: "2025-08-12T11:00:00Z", sale_value: 200 },
    ]);
    expect(grouped).toEqual([
      { day: "2025-08-12", saleValue: 300 },
      { day: "2025-09-10", saleValue: 300 },
    ]);
  });

  it("aceita sale_value como string (numeric do Postgres via PostgREST)", () => {
    const grouped = groupOrdersByDay([
      { sold_at: "2025-08-12T12:00:00Z", sale_value: "10.50" },
      { sold_at: "2025-08-12T12:00:00Z", sale_value: "4.50" },
    ]);
    expect(grouped[0].saleValue).toBe(15);
  });

  it("descarta sold_at inválido em vez de contaminar o ciclo com NaN", () => {
    const grouped = groupOrdersByDay([
      { sold_at: "not-a-date", sale_value: 999 },
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 100 },
    ]);
    expect(grouped).toEqual([{ day: "2025-08-12", saleValue: 100 }]);
  });

  it("retorna vazio pra lista vazia", () => {
    expect(groupOrdersByDay([])).toEqual([]);
  });
});

describe("computeCycleDays", () => {
  it("cai no default da org quando o cliente só tem 1 pedido", () => {
    const grouped = groupOrdersByDay([{ sold_at: "2025-08-12T12:00:00Z", sale_value: 100 }]);
    expect(computeCycleDays(grouped, 45)).toBe(45);
  });

  it("usa 30 quando não há default da org", () => {
    expect(computeCycleDays([], undefined)).toBe(30);
  });

  it("REGRESSÃO: pedido multi-item NÃO vira ciclo de 1 dia", () => {
    // antes do fix: 2 linhas = "2 pedidos com gap 0" → ciclo 1 → KPI x30
    const grouped = groupOrdersByDay([
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 3180.5 },
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 117.7 },
    ]);
    expect(computeCycleDays(grouped, 30)).toBe(30);
  });

  it("mede o gap entre dias distintos", () => {
    const grouped = groupOrdersByDay([
      { sold_at: "2025-07-13T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 100 },
    ]);
    expect(computeCycleDays(grouped, 45)).toBe(30);
  });

  it("tira a média dos gaps quando há vários pedidos", () => {
    // 10/01 → 20/01 (10d) → 10/02 (21d) → média 15,5 → 16
    const grouped = groupOrdersByDay([
      { sold_at: "2025-01-10T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-01-20T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-02-10T12:00:00Z", sale_value: 100 },
    ]);
    expect(computeCycleDays(grouped, 30)).toBe(16);
  });

  it("ignora as linhas extras de cada pedido ao medir o gap", () => {
    // 2 pedidos multi-item separados por 30 dias → ciclo 30, não 10
    const grouped = groupOrdersByDay([
      { sold_at: "2025-07-13T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-07-13T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-07-13T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 100 },
    ]);
    expect(computeCycleDays(grouped, 45)).toBe(30);
  });

  it("nunca retorna menos que 1 (dias consecutivos)", () => {
    const grouped = groupOrdersByDay([
      { sold_at: "2025-08-12T12:00:00Z", sale_value: 100 },
      { sold_at: "2025-08-13T12:00:00Z", sale_value: 100 },
    ]);
    expect(computeCycleDays(grouped, 30)).toBe(1);
  });
});
