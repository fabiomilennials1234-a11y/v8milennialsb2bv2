import { describe, expect, it } from "vitest";
import { studioInterval } from "./metrics-studio-interval";
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
});
