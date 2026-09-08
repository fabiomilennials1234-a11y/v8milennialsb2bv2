import { describe, expect, it } from "vitest";
import { studioInterval } from "./metrics-studio-interval";
import { periodoAtual, periodoAnterior } from "./metrics-studio-period";
import { zonedDateParts } from "@/shared/time/zoned-day";
describe("Estúdio — calendário do motor no fuso da organização", () => {
  it("setembro começa em setembro, às 00h BRT", () => {
    const range = studioInterval("month", new Date("2026-09-04T12:00:00Z"), "America/Sao_Paulo");
    expect(range.start.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-01T02:59:59.999Z");
    expect(range.dayOfPeriod).toBe(4);
  });
  it("a virada do mês é da org, não UTC nem browser", () => {
    expect(studioInterval("month", new Date("2026-09-01T01:00:00Z"), "America/Sao_Paulo").start.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });
  it("semana começa na segunda, inclusive mudança de ano", () => {
    expect(studioInterval("week", new Date("2027-01-01T12:00:00Z"), "America/Sao_Paulo").start.toISOString()).toBe("2026-12-28T03:00:00.000Z");
  });
  it("intervalo personalizado mantém datas-calendário nas transições DST", () => {
    const range = studioInterval("custom", new Date("2026-03-10T12:00:00Z"), "America/New_York", { from: "2026-03-07", to: "2026-03-09" });
    expect(range.start.toISOString()).toBe("2026-03-07T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-03-10T03:59:59.999Z");
    expect(range.daysTotal).toBe(3);
  });
  it("não inventa intervalo incompleto", () => {
    expect(() => studioInterval("custom", new Date(), "UTC")).toThrow("duas datas");
  });
  it("o motor usa o mês da org mesmo quando o browser está em outro mês", () => {
    const now = new Date("2026-09-01T02:00:00Z");
    expect(periodoAtual("month", now, null, "Asia/Tokyo").ref).toBe("2026-09-01");
    expect(periodoAtual("month", now, null, "America/Los_Angeles").ref).toBe("2026-08-31");
    expect(periodoAnterior("month", now, null, "Asia/Tokyo").ref).toBe("2026-08-01");
  });
  it.each(["2026-09-01T01:00:00Z", "2027-01-01T01:00:00Z", "2026-03-09T02:00:00Z"])("motor e templates concordam na data da org: %s", (instant) => {
    const now = new Date(instant);
    const timezone = "America/Sao_Paulo";
    const { y, m, d } = zonedDateParts(now, timezone);
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    expect(periodoAtual("month", now, null, timezone).ref).toBe(iso);
    const fixed = studioInterval("quarter", now, timezone);
    const atual = periodoAtual("quarter", now, null, timezone);
    const anterior = periodoAnterior("quarter", now, null, timezone);
    const dateOf = (date: Date) => {
      const parts = zonedDateParts(date, timezone);
      return `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
    };
    expect([dateOf(fixed.start), dateOf(fixed.end)]).toEqual([atual.start, atual.end]);
    expect([dateOf(fixed.prevStart), dateOf(fixed.prevEnd)]).toEqual([anterior.start, anterior.end]);
  });
});
