import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { differenceInCalendarDays, startOfDay, subDays } from "date-fns";
import { getPresetDates, getComparisonDates } from "@/modules/analytics/hooks/useAnalyticsFilters";

// ─── Mocks required to import the hook file ───────────────────────────────────
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1" }),
}));
vi.mock("@/shared/hooks/usePersistedState", () => ({
  usePersistedState: () => [undefined, () => undefined, () => undefined],
}));

describe("getPresetDates", () => {
  const FIXED_NOW = new Date("2026-04-20T15:00:00-03:00");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hoje → início e fim do mesmo dia", () => {
    const { start, end } = getPresetDates("hoje");
    expect(differenceInCalendarDays(end, start)).toBe(0);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it("7d → cobre 7 dias (incluindo hoje)", () => {
    const { start, end } = getPresetDates("7d");
    expect(differenceInCalendarDays(end, start)).toBe(6);
  });

  it("14d → cobre 14 dias (incluindo hoje)", () => {
    const { start, end } = getPresetDates("14d");
    expect(differenceInCalendarDays(end, start)).toBe(13);
  });

  it("30d → cobre 30 dias (incluindo hoje)", () => {
    const { start, end } = getPresetDates("30d");
    expect(differenceInCalendarDays(end, start)).toBe(29);
  });

  it("90d → cobre 90 dias (incluindo hoje)", () => {
    const { start, end } = getPresetDates("90d");
    expect(differenceInCalendarDays(end, start)).toBe(89);
  });

  it("preset desconhecido cai em 30d (fallback)", () => {
    const { start, end } = getPresetDates("custom");
    expect(differenceInCalendarDays(end, start)).toBe(29);
  });

  it("end é o fim do dia (23:59:59.xxx)", () => {
    const { end } = getPresetDates("7d");
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("ranges diferentes produzem janelas distintas", () => {
    const r7 = getPresetDates("7d");
    const r14 = getPresetDates("14d");
    const r30 = getPresetDates("30d");
    expect(r7.start.getTime()).toBeGreaterThan(r14.start.getTime());
    expect(r14.start.getTime()).toBeGreaterThan(r30.start.getTime());
    expect(r7.end.getTime()).toBe(r14.end.getTime()); // mesmo dia final
    expect(r14.end.getTime()).toBe(r30.end.getTime());
  });
});

describe("getComparisonDates", () => {
  const FIXED_NOW = new Date("2026-04-20T15:00:00-03:00");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("janela comparativa de 7d tem 7 dias e precede sem overlap", () => {
    const current = getPresetDates("7d");
    const comp = getComparisonDates(current.start, current.end);
    expect(differenceInCalendarDays(comp.end, comp.start)).toBe(6);
    // fim do comparativo é o dia anterior ao início atual — sem overlap
    expect(differenceInCalendarDays(current.start, comp.end)).toBe(1);
  });

  it("janela comparativa de 14d tem 14 dias", () => {
    const current = getPresetDates("14d");
    const comp = getComparisonDates(current.start, current.end);
    expect(differenceInCalendarDays(comp.end, comp.start)).toBe(13);
    expect(differenceInCalendarDays(current.start, comp.end)).toBe(1);
  });

  it("janela comparativa de 30d tem 30 dias", () => {
    const current = getPresetDates("30d");
    const comp = getComparisonDates(current.start, current.end);
    expect(differenceInCalendarDays(comp.end, comp.start)).toBe(29);
    expect(differenceInCalendarDays(current.start, comp.end)).toBe(1);
  });

  it("preserva start-of-day / end-of-day", () => {
    const current = getPresetDates("7d");
    const comp = getComparisonDates(current.start, current.end);
    expect(comp.start.getHours()).toBe(0);
    expect(comp.start.getMinutes()).toBe(0);
    expect(comp.end.getHours()).toBe(23);
    expect(comp.end.getMinutes()).toBe(59);
  });

  it("range custom de 1 dia produz comparativo de 1 dia", () => {
    const start = startOfDay(subDays(FIXED_NOW, 5));
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const comp = getComparisonDates(start, end);
    expect(differenceInCalendarDays(comp.end, comp.start)).toBe(0);
    expect(differenceInCalendarDays(start, comp.end)).toBe(1);
  });
});
