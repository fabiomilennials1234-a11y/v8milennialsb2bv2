import { describe, it, expect } from "vitest";
import {
  getPeriodRange,
  getPeriodLabel,
  nextPeriod,
  inRange,
  getDailyBuckets,
  TV_PERIODS,
} from "@/lib/tv-periods";

describe("tv-periods", () => {
  describe("getPeriodRange", () => {
    const now = new Date(2026, 4, 22, 15, 30, 0); // 22 Mai 2026 15:30

    it("hoje → meia-noite hoje até agora", () => {
      const { start, end } = getPeriodRange("hoje", now);
      expect(start.getHours()).toBe(0);
      expect(start.getDate()).toBe(22);
      expect(start.getMonth()).toBe(4);
      expect(end.getTime()).toBe(now.getTime());
    });

    it("7d → 7 dias atrás 00:00 até agora", () => {
      const { start, end } = getPeriodRange("7d", now);
      expect(start.getDate()).toBe(15);
      expect(start.getMonth()).toBe(4);
      expect(start.getHours()).toBe(0);
      expect(end.getTime()).toBe(now.getTime());
    });

    it("2sem → 14 dias atrás 00:00", () => {
      const { start } = getPeriodRange("2sem", now);
      expect(start.getDate()).toBe(8);
      expect(start.getMonth()).toBe(4);
    });

    it("mes → dia 1 do mês corrente (NUNCA rolling 30d)", () => {
      const { start } = getPeriodRange("mes", now);
      expect(start.getDate()).toBe(1);
      expect(start.getMonth()).toBe(4);
      expect(start.getHours()).toBe(0);
    });
  });

  describe("nextPeriod cycles", () => {
    it("cicla hoje → 7d → 2sem → mes → hoje", () => {
      expect(nextPeriod("hoje")).toBe("7d");
      expect(nextPeriod("7d")).toBe("2sem");
      expect(nextPeriod("2sem")).toBe("mes");
      expect(nextPeriod("mes")).toBe("hoje");
    });
  });

  describe("inRange", () => {
    const range = {
      start: new Date(2026, 4, 15, 0, 0, 0),
      end: new Date(2026, 4, 22, 23, 59, 59),
    };

    it("data dentro do range", () => {
      expect(inRange(new Date(2026, 4, 20), range)).toBe(true);
    });

    it("data fora do range", () => {
      expect(inRange(new Date(2026, 4, 10), range)).toBe(false);
    });

    it("null/undefined retornam false", () => {
      expect(inRange(null, range)).toBe(false);
      expect(inRange(undefined, range)).toBe(false);
    });

    it("string ISO funciona", () => {
      expect(inRange("2026-05-20T10:00:00Z", range)).toBe(true);
    });

    it("data inválida retorna false", () => {
      expect(inRange("not-a-date", range)).toBe(false);
    });
  });

  describe("getDailyBuckets", () => {
    it("gera 1 bucket pra hoje", () => {
      const start = new Date(2026, 4, 22, 0, 0, 0);
      const end = new Date(2026, 4, 22, 23, 59, 59);
      const buckets = getDailyBuckets({ start, end });
      expect(buckets.length).toBe(1);
      expect(buckets[0].key).toBe("2026-05-22");
    });

    it("gera 8 buckets pra 7 dias", () => {
      const start = new Date(2026, 4, 15, 0, 0, 0);
      const end = new Date(2026, 4, 22, 23, 59, 59);
      const buckets = getDailyBuckets({ start, end });
      expect(buckets.length).toBe(8);
      expect(buckets[0].key).toBe("2026-05-15");
      expect(buckets[7].key).toBe("2026-05-22");
    });
  });

  describe("labels", () => {
    it("retornam pt-BR", () => {
      expect(getPeriodLabel("hoje")).toBe("Hoje");
      expect(getPeriodLabel("7d")).toBe("Últimos 7 dias");
      expect(getPeriodLabel("2sem")).toBe("Últimas 2 semanas");
      expect(getPeriodLabel("mes")).toBe("Mês atual");
    });
  });

  it("TV_PERIODS contém todos os 4 períodos", () => {
    expect(TV_PERIODS).toHaveLength(4);
  });
});
