import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computePeriodRange,
  type CommandCustomRange,
} from "@/modules/analytics/hooks/useCommandMetrics";

/**
 * Preset "Personalizado" (period === "custom") do filtro global do Comando.
 *
 * Cobre: fronteiras UTC do intervalo escolhido, janela anterior de mesma
 * duração (pros deltas), daysTotal/dayOfPeriod, e o fallback non-null pro mês
 * quando o range está incompleto/ausente (callers derreferenciam range.start
 * sem guard — nunca pode retornar null).
 *
 * "Agora" congelado em 2026-07-14 12:00 local pra determinismo.
 */
describe("computePeriodRange — custom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const range = (from: Date, to?: Date): CommandCustomRange => ({ from, to });

  it("range completo (passado) → fronteiras UTC start/end corretas", () => {
    // seg 6 → dom 12 jan 2026 (7 dias)
    const r = computePeriodRange("custom", 7, 2026, range(new Date(2026, 0, 6), new Date(2026, 0, 12)));
    expect(r.start.toISOString()).toBe("2026-01-06T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-01-12T23:59:59.999Z");
    expect(r.daysTotal).toBe(7);
    // range todo no passado → dayOfPeriod clampado ao total
    expect(r.dayOfPeriod).toBe(7);
    expect(r.prevLabel).toBe("período anterior");
  });

  it("prev = janela imediatamente anterior de MESMA duração", () => {
    const r = computePeriodRange("custom", 7, 2026, range(new Date(2026, 0, 6), new Date(2026, 0, 12)));
    // 7 dias antes: 30 dez 2025 → 5 jan 2026
    expect(r.prevStart.toISOString()).toBe("2025-12-30T00:00:00.000Z");
    expect(r.prevEnd.toISOString()).toBe("2026-01-05T23:59:59.999Z");
    // mesma duração da janela atual
    const durAtual = r.end.getTime() - r.start.getTime();
    const durPrev = r.prevEnd.getTime() - r.prevStart.getTime();
    expect(durPrev).toBe(durAtual);
  });

  it("range de um único dia → daysTotal 1, prev = dia anterior", () => {
    const r = computePeriodRange("custom", 7, 2026, range(new Date(2026, 2, 15), new Date(2026, 2, 15)));
    expect(r.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-03-15T23:59:59.999Z");
    expect(r.daysTotal).toBe(1);
    expect(r.prevStart.toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(r.prevEnd.toISOString()).toBe("2026-03-14T23:59:59.999Z");
    expect(r.dayOfPeriod).toBe(1);
  });

  it("range corrente → dayOfPeriod = dias decorridos (1-based)", () => {
    // 10 → 20 jul 2026 (11 dias); hoje = 14 jul → 5º dia
    const r = computePeriodRange("custom", 7, 2026, range(new Date(2026, 6, 10), new Date(2026, 6, 20)));
    expect(r.daysTotal).toBe(11);
    expect(r.dayOfPeriod).toBe(5);
  });

  it("range todo no futuro → dayOfPeriod clampado a 1", () => {
    const r = computePeriodRange("custom", 7, 2026, range(new Date(2026, 7, 1), new Date(2026, 7, 7)));
    expect(r.daysTotal).toBe(7);
    expect(r.dayOfPeriod).toBe(1);
  });

  it("range incompleto (só from) → fallback pro mês, non-null", () => {
    const fb = computePeriodRange("custom", 3, 2026, range(new Date(2026, 2, 10)));
    const month = computePeriodRange("month", 3, 2026);
    expect(fb).not.toBeNull();
    expect(fb.start.toISOString()).toBe(month.start.toISOString());
    expect(fb.end.toISOString()).toBe(month.end.toISOString());
    expect(fb.daysTotal).toBe(month.daysTotal);
    expect(fb.prevLabel).toBe(month.prevLabel);
  });

  it("customRange null/ausente → fallback pro mês, non-null", () => {
    const nullRange = computePeriodRange("custom", 3, 2026, null);
    const noArg = computePeriodRange("custom", 3, 2026);
    const month = computePeriodRange("month", 3, 2026);
    expect(nullRange.start.toISOString()).toBe(month.start.toISOString());
    expect(nullRange.end.toISOString()).toBe(month.end.toISOString());
    expect(noArg.start.toISOString()).toBe(month.start.toISOString());
    expect(noArg.end.toISOString()).toBe(month.end.toISOString());
  });
});
