/**
 * Tests for _shared/erp/sync/full-sweep.ts — a varredura completa diária das
 * cobranças do Toth.
 *
 * O Toth omite título pago da resposta (Chamado 065e4890). Com janela, a
 * ausência só prova baixa para quem vence dentro dela; título vencido há mais
 * de 45 dias e pago depois só fecha numa volta SEM janela. Esta volta roda
 * todo dia, com cursor próprio — dividir o cursor com o sync de janela fazia
 * cada um cobrir só parte da base.
 */
import { describe, it, expect } from "vitest";
import {
  DAILY_FULL_SWEEP_MIN_INTERVAL_HOURS,
  dailyFullSweepDue,
  endOfRunCursorPatch,
  sweepCursor,
} from "../../supabase/functions/_shared/erp/sync/full-sweep";

const NOW = new Date("2026-10-15T05:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("dailyFullSweepDue", () => {
  it("roda quando nunca houve volta completa", () => {
    expect(dailyFullSweepDue({ fullCursor: null, lastSweepAt: null }, NOW)).toBe(true);
  });

  it("NÃO roda de novo na mesma madrugada depois que a volta fechou", () => {
    // Fechou às 05:40 de hoje; o cron segue disparando até 06:55.
    expect(dailyFullSweepDue({ fullCursor: null, lastSweepAt: hoursAgo(0.5) }, NOW)).toBe(false);
  });

  it("roda na madrugada seguinte", () => {
    expect(dailyFullSweepDue({ fullCursor: null, lastSweepAt: hoursAgo(23) }, NOW)).toBe(true);
  });

  it(`o limite é ${DAILY_FULL_SWEEP_MIN_INTERVAL_HOURS}h`, () => {
    const h = DAILY_FULL_SWEEP_MIN_INTERVAL_HOURS;
    expect(dailyFullSweepDue({ fullCursor: null, lastSweepAt: hoursAgo(h - 0.01) }, NOW)).toBe(false);
    expect(dailyFullSweepDue({ fullCursor: null, lastSweepAt: hoursAgo(h) }, NOW)).toBe(true);
  });

  it("🔴 volta pela metade SEMPRE continua — mesmo que a anterior tenha fechado há pouco", () => {
    // ERP caiu no meio da madrugada: o cursor ficou parado. A próxima execução
    // tem que retomar, não esperar 20h.
    expect(dailyFullSweepDue({ fullCursor: "c-123", lastSweepAt: hoursAgo(1) }, NOW)).toBe(true);
  });

  it("data ilegível não trava a varredura para sempre", () => {
    expect(dailyFullSweepDue({ fullCursor: null, lastSweepAt: "não é data" }, NOW)).toBe(true);
  });
});

describe("sweepCursor — cada modo lê o SEU cursor", () => {
  const conn = { cobrancas_cursor: "janela-7", cobrancas_full_cursor: "full-3" };

  it("janela lê cobrancas_cursor", () => {
    expect(sweepCursor("window", conn)).toBe("janela-7");
  });

  it("full lê cobrancas_full_cursor", () => {
    expect(sweepCursor("full", conn)).toBe("full-3");
  });

  it("cursor ausente é null", () => {
    expect(sweepCursor("full", { cobrancas_cursor: "x" })).toBeNull();
  });
});

describe("endOfRunCursorPatch — cada modo escreve só o SEU cursor", () => {
  const NOW_ISO = "2026-10-15T05:40:00.000Z";

  it("janela com mais adiante guarda onde parou", () => {
    expect(endOfRunCursorPatch("window", "c-9", NOW_ISO)).toEqual({ cobrancas_cursor: "c-9" });
  });

  it("janela que terminou a volta zera o cursor dela", () => {
    expect(endOfRunCursorPatch("window", null, NOW_ISO)).toEqual({ cobrancas_cursor: null });
  });

  it("full com mais adiante guarda onde parou, sem marcar a volta", () => {
    expect(endOfRunCursorPatch("full", "c-9", NOW_ISO)).toEqual({ cobrancas_full_cursor: "c-9" });
  });

  it("full que terminou a volta zera o cursor e marca quando fechou", () => {
    expect(endOfRunCursorPatch("full", null, NOW_ISO)).toEqual({
      cobrancas_full_cursor: null,
      last_cobrancas_full_sweep_at: NOW_ISO,
    });
  });
});
