// @vitest-environment node
/**
 * computeClientHealth — o score da carteira extraído de
 * `calculate-portfolio-health/index.ts` (antigo processClient, linhas 142-245).
 *
 * A extração é PURA: nenhuma regra muda. Para provar isso, `legacyScore` abaixo
 * é a cópia congelada do corpo antigo (só a aritmética, sem I/O), e o último
 * bloco compara as duas implementações sobre centenas de carteiras geradas.
 * Se alguém mexer numa regra de propósito, este oráculo tem de ser atualizado
 * junto — e a revisão vê as duas mudanças lado a lado.
 */
import { describe, expect, it } from "vitest";
import {
  calculateChurnProbability,
  calculateEngagementScore,
  calculateFrequencyScore,
  calculateHealthScore,
  calculateRecencyScore,
  calculateTicketScore,
  computeClientHealth,
  computeCycleDays,
  deriveHealthStatus,
  deriveSegment,
  deriveTrend,
  detectSignals,
  groupOrdersByDay,
  orgAvgTicketFrom,
  type ClientHealthInput,
  type HealthOrder,
} from "../../supabase/functions/_shared/portfolio-health.ts";

const NOW = new Date("2026-10-05T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number, hour = 12) => {
  const t = new Date(NOW.getTime() - d * DAY);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};

function order(id: string, d: number, value: number, product = "Café", hour = 12): HealthOrder {
  return { id, sale_value: value, sold_at: daysAgo(d, hour), product_name: product };
}

function input(over: Partial<ClientHealthInput> = {}): ClientHealthInput {
  return {
    leadId: "lead-1",
    lastOrderAtStored: null,
    orders: [],
    ctxEngagement: null,
    lastIncomingAt: null,
    ...over,
  };
}

// ─── Oráculo: corpo antigo de processClient (index.ts:113-245), sem I/O ───────

function legacyScore(
  orders: HealthOrder[],
  client: { lead_id: string | null; last_order_at: string | null },
  ctxEngagement: number | null,
  lastIncomingAt: string | null,
  orgAvgTicket: number,
  now: Date,
  orgDefaultCycleDays?: number,
) {
  const daysBetween = (a: Date, b: Date) => Math.abs(b.getTime() - a.getTime()) / DAY;
  let engagementScore = 50;
  let daysSinceLastIncoming: number | null = null;
  if (client.lead_id) {
    daysSinceLastIncoming = lastIncomingAt
      ? Math.round(daysBetween(new Date(lastIncomingAt), now))
      : null;
    engagementScore = calculateEngagementScore(ctxEngagement, daysSinceLastIncoming);
  }
  const orderList = orders;
  const dayOrders = groupOrdersByDay(orderList);
  const orderCount = orderList.length;
  const cycleDays = computeCycleDays(dayOrders, orgDefaultCycleDays);
  const sorted = [...orderList].sort(
    (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime(),
  );
  const lastOrder = sorted.at(-1);
  const importedLastOrderAt =
    !lastOrder && client.last_order_at ? new Date(client.last_order_at) : null;
  const lastOrderAt = lastOrder ? new Date(lastOrder.sold_at) : importedLastOrderAt;
  const daysSinceLastOrder = lastOrderAt ? Math.round(daysBetween(lastOrderAt, now)) : 999;
  const totalValue = orderList.reduce((s, o) => s + Number(o.sale_value), 0);
  const avgTicket = dayOrders.length > 0 ? totalValue / dayOrders.length : 0;
  const scoringAvgTicket = orderCount > 0 ? totalValue / orderCount : 0;
  const cutoff90 = new Date(now.getTime() - 90 * DAY);
  const recent90 = orderList.filter((o) => new Date(o.sold_at) >= cutoff90);
  const historicalCount = Math.max(1, Math.ceil((orderCount * 90) / 365));
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
      ? 70
      : calculateHealthScore({
          recency: recencyScore,
          frequency: frequencyScore,
          ticket: ticketScore,
          engagement: engagementScore,
        });
  const healthStatus = deriveHealthStatus(healthScore);
  const segment = deriveSegment(healthScore, scoringAvgTicket, orgAvgTicket, orderCount);
  const trend = deriveTrend(lastThreeTickets, scoringAvgTicket);
  const nextOrderExpected = lastOrderAt
    ? new Date(lastOrderAt.getTime() + cycleDays * DAY)
    : null;
  const counts: Record<string, number> = {};
  for (const o of orderList) counts[o.product_name] = (counts[o.product_name] ?? 0) + 1;
  const pf = orderList.length === 0
    ? []
    : Object.entries(counts).map(([productName, count]) => ({
        productName,
        appearsInPct: Math.round((count / orderList.length) * 100),
      }));
  const signalInput = {
    daysSinceLastOrder,
    cycleDays,
    lastThreeTickets,
    historicalAvgTicket: scoringAvgTicket,
    productFrequencies: pf,
    lastOrderProducts: lastOrder ? [lastOrder.product_name] : [],
    daysSinceLastWhatsAppReply: daysSinceLastIncoming,
    lastNpsScore: null as number | null,
  };
  const churnProbability = orderCount < 3 ? 0 : calculateChurnProbability(signalInput, healthScore);
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
    signals: detectSignals(signalInput),
  };
}

// ─── Casos de borda do contrato ──────────────────────────────────────────────

describe("computeClientHealth", () => {
  const org = { orgAvgTicket: 100 };

  it("0 pedidos com last_order_at importado: recência sobrevive ao recálculo", () => {
    const stored = daysAgo(40);
    const r = computeClientHealth(input({ lastOrderAtStored: stored }), org, NOW);
    expect(r.update.last_order_at).toBe(new Date(stored).toISOString());
    expect(r.update.days_since_last_order).toBe(40);
    expect(r.update.order_count).toBe(0);
    expect(r.update.lifetime_value).toBe(0);
    expect(r.update.avg_ticket).toBeNull();
    expect(r.update.next_order_expected).toBe(new Date(new Date(stored).getTime() + 30 * DAY).toISOString());
    // 40 > 30 * 1.15 → recompra atrasada mesmo sem linha de pedido
    expect(r.signals.map((s) => s.type)).toContain("reorder_overdue");
  });

  it("0 pedidos e nada importado: 999 dias, sem datas", () => {
    const r = computeClientHealth(input(), org, NOW);
    expect(r.update.days_since_last_order).toBe(999);
    expect(r.update.last_order_at).toBeNull();
    expect(r.update.next_order_expected).toBeNull();
    expect(r.update.health_score).toBe(70);
    expect(r.update.segment).toBe("novo");
  });

  it("< 3 pedidos: score neutro 70, segmento novo, churn 0", () => {
    const r = computeClientHealth(
      input({ orders: [order("a", 200, 50), order("b", 100, 50)] }),
      org,
      NOW,
    );
    expect(r.update.health_score).toBe(70);
    expect(r.update.health_status).toBe("atencao");
    expect(r.update.segment).toBe("novo");
    expect(r.update.churn_probability).toBe(0);
    expect(r.snapshot).toEqual({ health_score: 70, health_status: "atencao", segment: "novo" });
  });

  it("sem lead: engagement fica 50 e ignora contexto/WhatsApp", () => {
    const orders = [order("a", 90, 100), order("b", 60, 100), order("c", 30, 100), order("d", 1, 100)];
    const semLead = computeClientHealth(
      input({ leadId: null, orders, ctxEngagement: 0, lastIncomingAt: daysAgo(60) }),
      org,
      NOW,
    );
    const neutro = computeClientHealth(input({ orders, ctxEngagement: 50 }), org, NOW);
    expect(semLead.update.health_score).toBe(neutro.update.health_score);
    expect(semLead.signals.map((s) => s.type)).not.toContain("engagement_cold");
  });

  it("multi-item no mesmo dia: avg_ticket por pedido, order_count por linha", () => {
    const orders = [
      order("a", 60, 100, "Café", 10),
      order("b", 60, 50, "Filtro", 11),
      order("c", 30, 100, "Café", 10),
      order("d", 30, 50, "Filtro", 11),
    ];
    const r = computeClientHealth(input({ orders }), org, NOW);
    expect(r.update.order_count).toBe(4);
    expect(r.update.lifetime_value).toBe(300);
    expect(r.update.avg_ticket).toBe(150); // 300 / 2 dias
    expect(r.update.reorder_cycle_days).toBe(30);
  });

  it("cutoff de 90 dias entra no score de frequência e ticket", () => {
    const antigos = [order("a", 400, 100), order("b", 300, 100), order("c", 200, 100)];
    const comRecente = [...antigos, order("d", 89, 100)];
    const semRecente = [...antigos, order("d", 91, 100)];
    const a = computeClientHealth(input({ orders: comRecente }), org, NOW);
    const b = computeClientHealth(input({ orders: semRecente }), org, NOW);
    expect(a.update.health_score).toBeGreaterThan(b.update.health_score);
  });

  it("product_missing: produto presente em ≥ 80% das LINHAS e ausente no último pedido", () => {
    // A frequência é por linha (não por pedido), então dois produtos nunca
    // passam de 80% juntos — na prática sai no máximo um product_missing.
    const orders = [
      ...Array.from({ length: 9 }, (_, i) => order(`q${i}`, 300 - i * 30, 100, "Café")),
      order("last", 0, 100, "Outro"),
    ];
    const s = computeClientHealth(input({ orders }), org, NOW).signals
      .filter((x) => x.type === "product_missing");
    expect(s).toHaveLength(1);
    expect(s[0].metadata).toEqual({ productName: "Café", historicalPct: 90 });

    // Café em 9 de 19 linhas (47%) — abaixo do limiar, nenhum sinal.
    const multiItem = orders.slice(0, 9).flatMap((o, i) => [o, { ...o, id: `f${i}`, product_name: "Filtro" }]);
    multiItem.push(order("ult", 0, 100, "Outro"));
    expect(computeClientHealth(input({ orders: multiItem }), org, NOW).signals
      .filter((x) => x.type === "product_missing")).toHaveLength(0);
  });

  it("avg_ticket 0 vira null (avgTicket || null)", () => {
    const r = computeClientHealth(input({ lastOrderAtStored: daysAgo(3) }), org, NOW);
    expect(r.update.avg_ticket).toBeNull();
  });

  it("engagement: contexto + WhatsApp entram no score", () => {
    const orders = [order("a", 90, 100), order("b", 60, 100), order("c", 30, 100), order("d", 1, 100)];
    const frio = computeClientHealth(input({ orders, ctxEngagement: 0, lastIncomingAt: daysAgo(40) }), org, NOW);
    const quente = computeClientHealth(input({ orders, ctxEngagement: 100, lastIncomingAt: daysAgo(1) }), org, NOW);
    expect(quente.update.health_score).toBeGreaterThan(frio.update.health_score);
  });

  it("ciclo default da org vale quando há menos de 2 dias de pedido", () => {
    const r = computeClientHealth(input({ orders: [order("a", 10, 100)] }), { orgAvgTicket: 0, defaultCycleDays: 45 }, NOW);
    expect(r.update.reorder_cycle_days).toBe(45);
  });
});

describe("orgAvgTicketFrom", () => {
  it("divide soma por contagem; contagem 0 → 0", () => {
    expect(orgAvgTicketFrom(300, 3)).toBe(100);
    expect(orgAvgTicketFrom("300.5", 2)).toBe(150.25);
    expect(orgAvgTicketFrom(null, 0)).toBe(0);
    expect(orgAvgTicketFrom(0, 0)).toBe(0);
  });
});

// ─── Equivalência com o corpo antigo ─────────────────────────────────────────

describe("computeClientHealth ≡ corpo antigo de processClient", () => {
  // PRNG determinístico — a mesma carteira em toda execução.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("bate campo a campo em 500 carteiras geradas", () => {
    const rand = rng(20261005);
    const products = ["Café", "Filtro", "Açúcar", "Copo"];
    for (let n = 0; n < 500; n++) {
      const count = Math.floor(rand() * 12);
      const orders: HealthOrder[] = [];
      for (let i = 0; i < count; i++) {
        orders.push({
          id: `${n}-${i}`,
          sale_value: Math.round(rand() * 50000) / 100 + 0.01,
          sold_at: new Date(NOW.getTime() - Math.floor(rand() * 400 * DAY)).toISOString(),
          product_name: products[Math.floor(rand() * (rand() < 0.5 ? 1 : products.length))],
        });
      }
      // Entrada já ordenada como o SQL entrega: sold_at, id.
      orders.sort((a, b) => (a.sold_at < b.sold_at ? -1 : a.sold_at > b.sold_at ? 1 : a.id! < b.id! ? -1 : 1));
      const leadId = rand() < 0.9 ? "lead" : null;
      const stored = rand() < 0.3 ? new Date(NOW.getTime() - Math.floor(rand() * 200 * DAY)).toISOString() : null;
      const ctx = rand() < 0.5 ? Math.floor(rand() * 101) : null;
      const incoming = rand() < 0.6 ? new Date(NOW.getTime() - Math.floor(rand() * 60 * DAY)).toISOString() : null;
      const orgAvgTicket = rand() * 300;
      const cycle = rand() < 0.3 ? 10 + Math.floor(rand() * 60) : undefined;

      const novo = computeClientHealth(
        { leadId, lastOrderAtStored: stored, orders, ctxEngagement: ctx, lastIncomingAt: incoming },
        { orgAvgTicket, defaultCycleDays: cycle },
        NOW,
      );
      const antigo = legacyScore(
        orders, { lead_id: leadId, last_order_at: stored }, ctx, incoming, orgAvgTicket, NOW, cycle,
      );
      expect(novo.update, `carteira ${n}`).toEqual(antigo.update);
      expect(novo.signals, `carteira ${n}`).toEqual(antigo.signals);
      expect(novo.snapshot).toEqual({
        health_score: antigo.update.health_score,
        health_status: antigo.update.health_status,
        segment: antigo.update.segment,
      });
    }
  });
});
