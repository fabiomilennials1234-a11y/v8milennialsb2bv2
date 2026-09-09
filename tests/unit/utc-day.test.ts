import { describe, it, expect } from "vitest";
import { startOfUTCDay, endOfUTCDay } from "@/shared/time/utc-day";

/**
 * Fronteiras de dia em UTC a partir dos componentes locais da data — base de
 * datas do computePeriodRange (useCommandMetrics).
 */
describe("utc-day helpers", () => {
  // Quarta-feira, 1 Jul 2026, 15:30 local
  const now = new Date(2026, 6, 1, 15, 30, 0);

  it("startOfUTCDay → 00:00:00.000Z dos componentes locais", () => {
    expect(startOfUTCDay(now).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("endOfUTCDay → 23:59:59.999Z dos componentes locais", () => {
    expect(endOfUTCDay(now).toISOString()).toBe("2026-07-01T23:59:59.999Z");
  });
});
