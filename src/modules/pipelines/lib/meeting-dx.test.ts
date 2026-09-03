import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calcularEtapaPorDataDaReuniao, podeAplicarDx, DX_TARGET_KEYS } from "./meeting-dx";

/**
 * Porte 1:1 do `calculateStatusByDate` da página velha de Confirmação
 * (SCRUM-637). Dias de CALENDÁRIO, não períodos de 24h — reunião amanhã às 8h
 * é D-1 mesmo faltando menos de 24 horas.
 */
describe("calcularEtapaPorDataDaReuniao", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T15:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  const d = (s: string) => new Date(s);

  it("sem data → null (nada a recalcular)", () => {
    expect(calcularEtapaPorDataDaReuniao(null, "reuniao_marcada")).toBeNull();
  });

  it("dias de calendário, não 24h: amanhã de manhã é D-1", () => {
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-02T08:00:00"), "reuniao_marcada")).toBe("confirmar_d1");
  });

  it("mapa completo do trilho", () => {
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-01T18:00:00"), "reuniao_marcada")).toBe("confirmacao_no_dia");
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-03T10:00:00"), "reuniao_marcada")).toBe("confirmar_d2");
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-04T10:00:00"), "reuniao_marcada")).toBe("confirmar_d3");
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-05T10:00:00"), "reuniao_marcada")).toBe("confirmar_d5");
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-06T10:00:00"), "reuniao_marcada")).toBe("confirmar_d5");
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-10T10:00:00"), "confirmar_d5")).toBe("reuniao_marcada");
  });

  it("reunião no passado → remarcar", () => {
    expect(calcularEtapaPorDataDaReuniao(d("2026-08-30T10:00:00"), "confirmar_d1")).toBe("remarcar");
  });

  it("etapas terminais nunca recalculam", () => {
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-02T10:00:00"), "compareceu")).toBeNull();
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-02T10:00:00"), "perdido")).toBeNull();
  });

  it("remarcar SAI do lugar quando a data foi movida pra frente", () => {
    expect(calcularEtapaPorDataDaReuniao(d("2026-09-03T10:00:00"), "remarcar")).toBe("confirmar_d2");
    // …mas fica, enquanto continua vencida.
    expect(calcularEtapaPorDataDaReuniao(d("2026-08-20T10:00:00"), "remarcar")).toBeNull();
  });
});

describe("podeAplicarDx — só move pra coluna que o funil TEM", () => {
  it("funil com o trilho completo aplica", () => {
    const keys = new Set<string>(DX_TARGET_KEYS);
    expect(podeAplicarDx(keys, "confirmar_d2")).toBe(true);
  });

  it("funil custom sem a coluna devolvida NÃO aplica — nada de move pra etapa inexistente", () => {
    const keys = new Set(["reuniao", "compareceu"]);
    expect(podeAplicarDx(keys, "confirmar_d2")).toBe(false);
    expect(podeAplicarDx(keys, null)).toBe(false);
  });
});
