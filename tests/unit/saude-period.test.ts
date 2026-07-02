import { describe, it, expect } from "vitest";
import { computeSaudePeriodRange } from "@/modules/analytics/lib/saude-period";
import { startOfUTCDay, endOfUTCDay } from "@/modules/analytics/lib/utc-day";

/**
 * Semântica: fronteiras de dia em UTC a partir dos componentes locais da
 * data — mesma do computePeriodRange (useCommandMetrics). Semana = ISO
 * seg→dom; mês = calendário corrente.
 */
describe("saude-period", () => {
  // Quarta-feira, 1 Jul 2026, 15:30 local
  const now = new Date(2026, 6, 1, 15, 30, 0);

  describe("utc-day helpers", () => {
    it("startOfUTCDay → 00:00:00.000Z dos componentes locais", () => {
      expect(startOfUTCDay(now).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    });

    it("endOfUTCDay → 23:59:59.999Z dos componentes locais", () => {
      expect(endOfUTCDay(now).toISOString()).toBe("2026-07-01T23:59:59.999Z");
    });
  });

  describe("today", () => {
    it("dia corrente 00:00 → 23:59:59.999 UTC", () => {
      const r = computeSaudePeriodRange("today", null, now)!;
      expect(r.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-07-01T23:59:59.999Z");
    });
  });

  describe("week (ISO seg→dom, igual computePeriodRange)", () => {
    it("quarta 1 Jul 2026 → seg 29 Jun a dom 5 Jul", () => {
      const r = computeSaudePeriodRange("week", null, now)!;
      expect(r.start.toISOString()).toBe("2026-06-29T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-07-05T23:59:59.999Z");
    });

    it("segunda-feira → semana começa no próprio dia", () => {
      const monday = new Date(2026, 5, 29, 9, 0, 0); // seg 29 Jun 2026
      const r = computeSaudePeriodRange("week", null, monday)!;
      expect(r.start.toISOString()).toBe("2026-06-29T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-07-05T23:59:59.999Z");
    });

    it("domingo → semana ainda é a corrente (seg anterior → o próprio domingo)", () => {
      const sunday = new Date(2026, 6, 5, 22, 0, 0); // dom 5 Jul 2026
      const r = computeSaudePeriodRange("week", null, sunday)!;
      expect(r.start.toISOString()).toBe("2026-06-29T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-07-05T23:59:59.999Z");
    });

    it("semana cruzando virada de ano", () => {
      const wed = new Date(2025, 11, 31, 12, 0, 0); // qua 31 Dez 2025
      const r = computeSaudePeriodRange("week", null, wed)!;
      expect(r.start.toISOString()).toBe("2025-12-29T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-01-04T23:59:59.999Z");
    });
  });

  describe("month (calendário corrente, UTC)", () => {
    it("julho 2026 → 1 a 31 Jul UTC", () => {
      const r = computeSaudePeriodRange("month", null, now)!;
      expect(r.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-07-31T23:59:59.999Z");
    });

    it("fevereiro bissexto → 1 a 29 Fev", () => {
      const feb = new Date(2028, 1, 10, 8, 0, 0);
      const r = computeSaudePeriodRange("month", null, feb)!;
      expect(r.start.toISOString()).toBe("2028-02-01T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2028-02-29T23:59:59.999Z");
    });

    it("dezembro → fim no dia 31, sem vazar pro ano seguinte", () => {
      const dec = new Date(2026, 11, 15, 8, 0, 0);
      const r = computeSaudePeriodRange("month", null, dec)!;
      expect(r.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-12-31T23:59:59.999Z");
    });
  });

  describe("custom", () => {
    it("from + to → from 00:00 UTC até to 23:59:59.999 UTC", () => {
      const r = computeSaudePeriodRange(
        "custom",
        { from: new Date(2026, 5, 10, 14, 0), to: new Date(2026, 5, 20, 9, 0) },
        now,
      )!;
      expect(r.start.toISOString()).toBe("2026-06-10T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-06-20T23:59:59.999Z");
    });

    it("dia único (from === to) → intervalo de 1 dia", () => {
      const d = new Date(2026, 5, 15);
      const r = computeSaudePeriodRange("custom", { from: d, to: d }, now)!;
      expect(r.start.toISOString()).toBe("2026-06-15T00:00:00.000Z");
      expect(r.end.toISOString()).toBe("2026-06-15T23:59:59.999Z");
    });

    it("incompleto (só from) → null, caller mantém último range válido", () => {
      expect(
        computeSaudePeriodRange("custom", { from: new Date(2026, 5, 10) }, now),
      ).toBeNull();
    });

    it("sem range → null", () => {
      expect(computeSaudePeriodRange("custom", null, now)).toBeNull();
    });
  });
});
