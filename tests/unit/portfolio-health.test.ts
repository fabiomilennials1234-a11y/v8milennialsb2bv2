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
