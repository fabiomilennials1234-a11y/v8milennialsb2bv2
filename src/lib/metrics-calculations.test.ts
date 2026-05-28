import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calculatePipelineCoverage,
  calculateWinStreak,
  categorizeStaleLeads,
} from "./metrics-calculations";

describe("calculatePipelineCoverage", () => {
  it("retorna 'Sem meta' quando goal é null", () => {
    const result = calculatePipelineCoverage({ openPipelineValue: 50000, monthlyGoal: null });
    expect(result).toEqual({ ratio: null, label: "Sem meta", status: "no-goal" });
  });

  it("retorna 'Sem meta' quando goal é 0", () => {
    const result = calculatePipelineCoverage({ openPipelineValue: 50000, monthlyGoal: 0 });
    expect(result.status).toBe("no-goal");
  });

  it("healthy quando cobertura >= 3x", () => {
    const result = calculatePipelineCoverage({ openPipelineValue: 300000, monthlyGoal: 100000 });
    expect(result.ratio).toBe(3);
    expect(result.status).toBe("healthy");
    expect(result.label).toBe("3.0x");
  });

  it("warning quando cobertura entre 1.5x e 3x", () => {
    const result = calculatePipelineCoverage({ openPipelineValue: 200000, monthlyGoal: 100000 });
    expect(result.ratio).toBe(2);
    expect(result.status).toBe("warning");
  });

  it("critical quando cobertura < 1.5x", () => {
    const result = calculatePipelineCoverage({ openPipelineValue: 100000, monthlyGoal: 100000 });
    expect(result.ratio).toBe(1);
    expect(result.status).toBe("critical");
  });

  it("pipeline vazio = 0x = critical", () => {
    const result = calculatePipelineCoverage({ openPipelineValue: 0, monthlyGoal: 100000 });
    expect(result.ratio).toBe(0);
    expect(result.status).toBe("critical");
    expect(result.label).toBe("0.0x");
  });
});

describe("calculateWinStreak", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna 0 sem datas", () => {
    expect(calculateWinStreak({ dates: [] })).toBe(0);
  });

  it("retorna 0 se último dia não é hoje", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
    expect(calculateWinStreak({ dates: ["2026-05-27"] })).toBe(0);
  });

  it("retorna 1 se só tem hoje", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
    expect(calculateWinStreak({ dates: ["2026-05-28"] })).toBe(1);
  });

  it("conta dias consecutivos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
    expect(
      calculateWinStreak({
        dates: ["2026-05-28", "2026-05-27", "2026-05-26", "2026-05-25"],
      }),
    ).toBe(4);
  });

  it("para no gap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
    expect(
      calculateWinStreak({
        dates: ["2026-05-28", "2026-05-27", "2026-05-25"],
      }),
    ).toBe(2);
  });

  it("deduplica datas (múltiplas vendas no mesmo dia)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
    expect(
      calculateWinStreak({
        dates: ["2026-05-28", "2026-05-28", "2026-05-27", "2026-05-27"],
      }),
    ).toBe(2);
  });
});

describe("categorizeStaleLeads", () => {
  it("retorna zero sem leads", () => {
    expect(categorizeStaleLeads([])).toEqual({ total: 0, critical: 0, warning: 0 });
  });

  it("classifica warning (7-13 dias) e critical (14+ dias)", () => {
    const leads = [
      { days_inactive: 7 },
      { days_inactive: 10 },
      { days_inactive: 14 },
      { days_inactive: 21 },
    ];
    expect(categorizeStaleLeads(leads)).toEqual({ total: 4, critical: 2, warning: 2 });
  });

  it("todos critical quando todos >= 14 dias", () => {
    const leads = [{ days_inactive: 14 }, { days_inactive: 30 }];
    expect(categorizeStaleLeads(leads)).toEqual({ total: 2, critical: 2, warning: 0 });
  });
});
