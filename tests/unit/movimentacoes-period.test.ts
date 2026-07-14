import { describe, it, expect } from "vitest";
import {
  resolveMovimentacoesRange,
  customRangeFromState,
  DEFAULT_MOVIMENTACOES_PERIOD,
  MOVIMENTACOES_PRESETS,
  type MovimentacoesPeriodState,
} from "@/modules/analytics/lib/movimentacoes-period";

// Âncora fixa: 2026-07-14 (terça) 15:30 local.
const NOW = new Date(2026, 6, 14, 15, 30, 0);

describe("resolveMovimentacoesRange", () => {
  it("today → dia corrente 00:00 → 23:59:59.999 UTC", () => {
    const r = resolveMovimentacoesRange("today", null, NOW)!;
    expect(r.start.toISOString()).toBe("2026-07-14T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-14T23:59:59.999Z");
  });

  it("7d → últimos 7 dias (hoje inclusive)", () => {
    const r = resolveMovimentacoesRange("7d", null, NOW)!;
    // 14 - 6 = 8
    expect(r.start.toISOString()).toBe("2026-07-08T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-14T23:59:59.999Z");
  });

  it("30d → últimos 30 dias (hoje inclusive), cruzando mês", () => {
    const r = resolveMovimentacoesRange("30d", null, NOW)!;
    // 14 jul - 29 dias = 15 jun
    expect(r.start.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-14T23:59:59.999Z");
  });

  it("month → mês-calendário corrente", () => {
    const r = resolveMovimentacoesRange("month", null, NOW)!;
    expect(r.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-31T23:59:59.999Z");
  });

  it("custom completo → from 00:00 → to 23:59:59.999 UTC", () => {
    const r = resolveMovimentacoesRange(
      "custom",
      { from: new Date(2026, 5, 3), to: new Date(2026, 5, 20) },
      NOW,
    )!;
    expect(r.start.toISOString()).toBe("2026-06-03T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-06-20T23:59:59.999Z");
  });

  it("custom incompleto (sem to) → null (não dispara query)", () => {
    expect(resolveMovimentacoesRange("custom", { from: new Date(2026, 5, 3) }, NOW)).toBeNull();
    expect(resolveMovimentacoesRange("custom", null, NOW)).toBeNull();
  });

  it("default é preset month", () => {
    expect(DEFAULT_MOVIMENTACOES_PERIOD.preset).toBe("month");
  });

  it("presets expostos na ordem Hoje/7 dias/30 dias/Mês/Custom", () => {
    expect(MOVIMENTACOES_PRESETS.map((p) => p.label)).toEqual([
      "Hoje",
      "7 dias",
      "30 dias",
      "Mês",
      "Custom",
    ]);
  });
});

describe("customRangeFromState", () => {
  it("hidrata ISO strings em Dates", () => {
    const state: MovimentacoesPeriodState = {
      preset: "custom",
      customFrom: "2026-06-03T00:00:00.000Z",
      customTo: "2026-06-20T00:00:00.000Z",
    };
    const c = customRangeFromState(state)!;
    expect(c.from.toISOString()).toBe("2026-06-03T00:00:00.000Z");
    expect(c.to?.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  });

  it("customFrom null → null", () => {
    expect(customRangeFromState(DEFAULT_MOVIMENTACOES_PERIOD)).toBeNull();
  });

  it("só from (to null) → range parcial sem to", () => {
    const c = customRangeFromState({
      preset: "custom",
      customFrom: "2026-06-03T00:00:00.000Z",
      customTo: null,
    })!;
    expect(c.from.toISOString()).toBe("2026-06-03T00:00:00.000Z");
    expect(c.to).toBeUndefined();
  });
});
