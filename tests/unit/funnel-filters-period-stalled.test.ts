import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyPeriodShortcut,
  createInitialPeriodState,
  getDateRange,
  matchPeriodShortcut,
  revivePeriodState,
  type MetricsPeriodState,
} from "@/lib/metrics-period";
import {
  STALLED_BUCKETS,
  STALLED_ALL,
  getStalledBucket,
  stalledBucketLabel,
} from "@/modules/pipelines/lib/stalled-buckets";

/**
 * Os dois filtros de tempo do funil redesenhado. São independentes de propósito
 * — "criado" olha a entrada, "parado" olha a etapa atual — e ambos precisam
 * sobreviver a um round-trip por JSON, porque atravessam localStorage
 * (`usePersistedState`) e as visualizações salvas (coluna jsonb).
 */

const BASE = createInitialPeriodState();

describe("atalhos de 'Criados no período'", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T15:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("ida e volta: todo atalho é reconhecido pelo estado que ele mesmo produz", () => {
    for (const shortcut of ["7d", "30d", "90d", "month"] as const) {
      const state = applyPeriodShortcut(shortcut, BASE);
      expect(matchPeriodShortcut(state)).toBe(shortcut);
    }
  });

  it("'7 dias' inclui hoje — são 7 dias contados, não 8", () => {
    const range = getDateRange(applyPeriodShortcut("7d", BASE))!;
    const start = new Date(range.startStr);
    const end = new Date(range.endStr);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    expect(days).toBe(7); // 6 dias cheios + as duas pontas do mesmo dia
    expect(range.endStr.slice(0, 10)).toBe("2026-07-29");
    expect(range.startStr.slice(0, 10)).toBe("2026-07-23");
  });

  it("estado inicial não filtra nada", () => {
    expect(getDateRange(BASE)).toBeNull();
    expect(matchPeriodShortcut(BASE)).toBeNull();
  });

  it("intervalo livre não acende atalho nenhum", () => {
    const custom: MetricsPeriodState = {
      ...BASE,
      period: "custom",
      customRange: { from: new Date("2026-03-01"), to: new Date("2026-03-15") },
    };
    expect(matchPeriodShortcut(custom)).toBeNull();
    expect(getDateRange(custom)).not.toBeNull();
  });

  it("seleção pela metade (sem data final) ainda não filtra", () => {
    const half: MetricsPeriodState = {
      ...BASE,
      period: "custom",
      customRange: { from: new Date("2026-07-01"), to: undefined },
    };
    // É o que impede o badge de Filtros de acender sem nenhum card sair da tela.
    expect(getDateRange(half)).toBeNull();
  });

  it("mês passado não conta como 'Este mês'", () => {
    const lastMonth: MetricsPeriodState = { ...BASE, period: "month", month: 6, year: 2026 };
    expect(matchPeriodShortcut(lastMonth)).toBeNull();
  });
});

describe("round-trip por JSON (localStorage / views salvas)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T15:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  // Uma view salva volta do banco com as datas em string. Antes da coerção isso
  // derrubava a tela em `.getFullYear()` de uma string.
  const roundTrip = (s: MetricsPeriodState): MetricsPeriodState =>
    JSON.parse(JSON.stringify(s));

  it("getDateRange sobrevive a datas serializadas", () => {
    const state = applyPeriodShortcut("30d", BASE);
    const expected = getDateRange(state);
    expect(() => getDateRange(roundTrip(state))).not.toThrow();
    expect(getDateRange(roundTrip(state))).toEqual(expected);
  });

  it("matchPeriodShortcut sobrevive a datas serializadas", () => {
    const state = applyPeriodShortcut("7d", BASE);
    expect(matchPeriodShortcut(roundTrip(state))).toBe("7d");
  });

  it("revivePeriodState devolve Date de verdade pro Calendar", () => {
    const revived = revivePeriodState(roundTrip(applyPeriodShortcut("90d", BASE)));
    expect(revived.customRange?.from).toBeInstanceOf(Date);
    expect(revived.customRange?.to).toBeInstanceOf(Date);
  });

  it("revive não inventa data quando não há intervalo", () => {
    const revived = revivePeriodState(roundTrip(BASE));
    expect(revived.customRange).toBeNull();
    expect(revived.weekDate).toBeNull();
  });
});

describe("faixas de 'Parado há'", () => {
  it("cobrem a reta sem buraco nem sobreposição", () => {
    const ordered = [...STALLED_BUCKETS].sort((a, b) => a.minDays - b.minDays);
    expect(ordered[0].minDays).toBe(0);
    for (let i = 1; i < ordered.length; i++) {
      // O piso de cada faixa encosta no teto da anterior + 1: nenhum dia cai
      // fora de todas as faixas, e nenhum dia pertence a duas.
      expect(ordered[i].minDays).toBe((ordered[i - 1].maxDays ?? Infinity) + 1);
    }
    expect(ordered[ordered.length - 1].maxDays).toBeNull(); // última é aberta
  });

  it("'mais de 30 dias' começa em 31 — 30 ainda é a faixa anterior", () => {
    expect(getStalledBucket("30+")).toMatchObject({ minDays: 31, maxDays: null });
    expect(getStalledBucket("15-30")).toMatchObject({ minDays: 15, maxDays: 30 });
  });

  it("'all', vazio e id desconhecido não filtram", () => {
    expect(getStalledBucket(STALLED_ALL)).toBeNull();
    expect(getStalledBucket("")).toBeNull();
    expect(getStalledBucket("nao-existe")).toBeNull();
  });

  it("rótulo tem fallback pra id sem faixa", () => {
    expect(stalledBucketLabel("8-14")).toBe("8 a 14 dias");
    expect(stalledBucketLabel(STALLED_ALL)).toBe("Qualquer tempo");
  });
});
