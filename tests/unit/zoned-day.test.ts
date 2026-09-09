import { describe, it, expect } from "vitest";
import {
  zonedDayStart,
  zonedDayEnd,
  zonedDateParts,
  zonedDayStartOfYMD,
  zonedDayEndOfYMD,
} from "@/shared/time/zoned-day";
import { startOfUTCDay, endOfUTCDay } from "@/shared/time/utc-day";

/**
 * Cortes de dia no fuso da org (DST-safe). Cobre a borda BRT que motivou o fix
 * (lead de 21:00–23:59 BRT = 00:00–03:00 UTC caía no dia errado), uma zona com
 * DST (America/New_York) amostrada dentro e fora do horário de verão, e uma
 * zona sem DST de offset diferente de BRT (America/Manaus, UTC-4).
 */
describe("zoned-day — America/Sao_Paulo (UTC-3, sem DST em 2026)", () => {
  const SP = "America/Sao_Paulo";

  it("instante 01:00Z pertence ao dia ANTERIOR no fuso BRT", () => {
    const instant = new Date("2026-07-24T01:00:00.000Z"); // = 2026-07-23 22:00 BRT
    const parts = zonedDateParts(instant, SP);
    expect(parts.y).toBe(2026);
    expect(parts.m).toBe(7);
    expect(parts.d).toBe(23); // não 24
  });

  it("zonedDayStart de 01:00Z = meia-noite BRT do dia 23 = 2026-07-23T03:00Z", () => {
    const instant = new Date("2026-07-24T01:00:00.000Z");
    expect(zonedDayStart(instant, SP).toISOString()).toBe("2026-07-23T03:00:00.000Z");
  });

  it("zonedDayStart/End de um instante ao meio-dia UTC", () => {
    const instant = new Date("2026-07-24T12:00:00.000Z"); // = 2026-07-24 09:00 BRT
    expect(zonedDayStart(instant, SP).toISOString()).toBe("2026-07-24T03:00:00.000Z");
    expect(zonedDayEnd(instant, SP).toISOString()).toBe("2026-07-25T02:59:59.999Z");
  });

  it("zonedDayStartOfYMD/EndOfYMD respeitam a data explícita org-local", () => {
    expect(zonedDayStartOfYMD(2026, 7, 23, SP).toISOString()).toBe("2026-07-23T03:00:00.000Z");
    expect(zonedDayEndOfYMD(2026, 7, 23, SP).toISOString()).toBe("2026-07-24T02:59:59.999Z");
  });

  it("weekdayMon0: 2026-07-23 é quinta (segunda = 0 → quinta = 3)", () => {
    const instant = new Date("2026-07-23T12:00:00.000Z");
    expect(zonedDateParts(instant, SP).weekdayMon0).toBe(3);
  });
});

describe("zoned-day — America/New_York (DST)", () => {
  const NY = "America/New_York";

  it("verão (EDT, UTC-4): meia-noite local = 04:00Z", () => {
    const summer = new Date("2026-07-15T12:00:00.000Z"); // 08:00 EDT
    expect(zonedDayStart(summer, NY).toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("inverno (EST, UTC-5): meia-noite local = 05:00Z", () => {
    const winter = new Date("2026-01-15T12:00:00.000Z"); // 07:00 EST
    expect(zonedDayStart(winter, NY).toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("offset amostrado difere entre verão e inverno (prova DST-safe)", () => {
    const summer = new Date("2026-07-15T12:00:00.000Z");
    const winter = new Date("2026-01-15T12:00:00.000Z");
    const summerOffsetH =
      (Date.UTC(2026, 6, 15) - zonedDayStart(summer, NY).getTime()) / 3_600_000;
    const winterOffsetH =
      (Date.UTC(2026, 0, 15) - zonedDayStart(winter, NY).getTime()) / 3_600_000;
    expect(summerOffsetH).toBe(-4);
    expect(winterOffsetH).toBe(-5);
    expect(summerOffsetH).not.toBe(winterOffsetH);
  });
});

describe("zoned-day — fuso inválido (hardening multi-tenant)", () => {
  // organizations.timezone pode ter um IANA que o Intl do runtime rejeita
  // (divergência Postgres/ICU). Nunca pode lançar (white-screen da org) — cai no
  // corte UTC de utc-day.ts. Comparamos contra os próprios helpers UTC pra ficar
  // determinístico independente do fuso da máquina de teste.
  const BAD = "Not/AZone";
  const instant = new Date("2026-07-24T12:00:00.000Z");

  it("os helpers não lançam com tz desconhecido", () => {
    expect(() => zonedDayStart(instant, BAD)).not.toThrow();
    expect(() => zonedDayEnd(instant, BAD)).not.toThrow();
    expect(() => zonedDateParts(instant, BAD)).not.toThrow();
    expect(() => zonedDayStartOfYMD(2026, 7, 24, BAD)).not.toThrow();
    expect(() => zonedDayEndOfYMD(2026, 7, 24, BAD)).not.toThrow();
  });

  it("zonedDayStart/End caem no bound UTC de fallback", () => {
    expect(zonedDayStart(instant, BAD).toISOString()).toBe(startOfUTCDay(instant).toISOString());
    expect(zonedDayEnd(instant, BAD).toISOString()).toBe(endOfUTCDay(instant).toISOString());
  });

  it("zonedDayStartOfYMD/EndOfYMD caem no bound UTC da data explícita", () => {
    expect(zonedDayStartOfYMD(2026, 7, 24, BAD).toISOString()).toBe(
      startOfUTCDay(new Date(2026, 6, 24)).toISOString(),
    );
    expect(zonedDayEndOfYMD(2026, 7, 24, BAD).toISOString()).toBe(
      endOfUTCDay(new Date(2026, 6, 24)).toISOString(),
    );
  });
});

describe("zoned-day — America/Manaus (UTC-4, sem DST)", () => {
  const MAO = "America/Manaus";

  it("instante 01:00Z pertence ao dia anterior; day start = 04:00Z", () => {
    const instant = new Date("2026-07-24T01:00:00.000Z"); // = 2026-07-23 21:00 -04
    expect(zonedDateParts(instant, MAO).d).toBe(23);
    expect(zonedDayStart(instant, MAO).toISOString()).toBe("2026-07-23T04:00:00.000Z");
    expect(zonedDayEnd(instant, MAO).toISOString()).toBe("2026-07-24T03:59:59.999Z");
  });
});
