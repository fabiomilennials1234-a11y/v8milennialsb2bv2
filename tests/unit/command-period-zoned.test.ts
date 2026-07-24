import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computePeriodRange } from "@/modules/analytics/hooks/useCommandMetrics";

/**
 * Ramos `today`/`week` de `computePeriodRange` no fuso da org (rota A do fix
 * "dashboard conta lead de ontem como hoje"). `month`/`quarter`/`custom` NÃO
 * mudam com timeZone — invariância byte-a-byte coberta abaixo.
 */
const SP = "America/Sao_Paulo";

describe("computePeriodRange — today (fuso da org)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-07-24 09:00 BRT (12:00Z) — qualquer instante do dia 24 BRT serve.
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("janela 'Hoje' BRT = [03:00Z do dia 24, 02:59:59.999Z do dia 25]", () => {
    const r = computePeriodRange("today", 7, 2026, null, SP);
    expect(r.start.toISOString()).toBe("2026-07-24T03:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-25T02:59:59.999Z");
    expect(r.dayOfPeriod).toBe(1);
    expect(r.daysTotal).toBe(1);
    expect(r.prevLabel).toBe("ontem");
  });

  it("'ontem' BRT = dia 23 org-local (não −24h ingênuo)", () => {
    const r = computePeriodRange("today", 7, 2026, null, SP);
    expect(r.prevStart.toISOString()).toBe("2026-07-23T03:00:00.000Z");
    expect(r.prevEnd.toISOString()).toBe("2026-07-24T02:59:59.999Z");
  });
});

describe("computePeriodRange — today: caso Basic4u 2026-07-24", () => {
  it("instante 01:00Z (= 22:00 BRT do dia 23) → 'Hoje' ainda é o dia 24? não: é 23", () => {
    // Um lead criado 01:00Z pertence a 23/07 BRT. Se o usuário abre o dashboard
    // nesse instante, "Hoje" (BRT) é o dia 23 — não o 24 do UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T01:00:00.000Z"));
    const r = computePeriodRange("today", 7, 2026, null, SP);
    expect(r.start.toISOString()).toBe("2026-07-23T03:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-24T02:59:59.999Z");
    vi.useRealTimers();
  });
});

describe("computePeriodRange — week (dow derivado do fuso da org)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-07-24T01:00Z = 2026-07-23 22:00 BRT (quinta). No UTC seria sexta 24.
    vi.setSystemTime(new Date("2026-07-24T01:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("dow segue a data org-local (quinta = 4º dia), não a do browser", () => {
    const r = computePeriodRange("week", 7, 2026, null, SP);
    // segunda 2026-07-20 BRT → 03:00Z; domingo 2026-07-26 BRT → 02:59:59.999Z(27)
    expect(r.start.toISOString()).toBe("2026-07-20T03:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-27T02:59:59.999Z");
    expect(r.dayOfPeriod).toBe(4); // quinta; se derivasse do UTC (sexta) seria 5
    expect(r.daysTotal).toBe(7);
    expect(r.prevLabel).toBe("semana passada");
  });

  it("semana anterior = seg 13 → dom 19 BRT", () => {
    const r = computePeriodRange("week", 7, 2026, null, SP);
    expect(r.prevStart.toISOString()).toBe("2026-07-13T03:00:00.000Z");
    expect(r.prevEnd.toISOString()).toBe("2026-07-20T02:59:59.999Z");
  });
});

describe("computePeriodRange — invariância month/quarter (regressão UTC)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("month: bounds idênticos com e sem timeZone", () => {
    const utc = computePeriodRange("month", 7, 2026);
    const zoned = computePeriodRange("month", 7, 2026, null, SP);
    expect(zoned.start.toISOString()).toBe(utc.start.toISOString());
    expect(zoned.end.toISOString()).toBe(utc.end.toISOString());
    expect(zoned.prevStart.toISOString()).toBe(utc.prevStart.toISOString());
    expect(zoned.prevEnd.toISOString()).toBe(utc.prevEnd.toISOString());
    expect(zoned.dayOfPeriod).toBe(utc.dayOfPeriod);
    expect(zoned.daysTotal).toBe(utc.daysTotal);
  });

  it("quarter: bounds idênticos com e sem timeZone", () => {
    const utc = computePeriodRange("quarter", 7, 2026);
    const zoned = computePeriodRange("quarter", 7, 2026, null, SP);
    expect(zoned.start.toISOString()).toBe(utc.start.toISOString());
    expect(zoned.end.toISOString()).toBe(utc.end.toISOString());
    expect(zoned.prevStart.toISOString()).toBe(utc.prevStart.toISOString());
    expect(zoned.prevEnd.toISOString()).toBe(utc.prevEnd.toISOString());
  });

  it("custom: bounds em UTC, inalterados pelo timeZone", () => {
    const cr = { from: new Date(2026, 0, 6), to: new Date(2026, 0, 12) };
    const utc = computePeriodRange("custom", 7, 2026, cr);
    const zoned = computePeriodRange("custom", 7, 2026, cr, SP);
    expect(zoned.start.toISOString()).toBe(utc.start.toISOString());
    expect(zoned.end.toISOString()).toBe(utc.end.toISOString());
  });
});
