// @vitest-environment node
/**
 * send-window — guard de janela de envio automático por organização.
 *
 * Motivação: automações enviavam texto/áudio 2h-3h da madrugada (feedback
 * Sorvfoods). O guard adia envio automático fora da janela p/ a próxima
 * abertura; envio manual nunca é afetado.
 *
 * Fuso de referência: America/Sao_Paulo = UTC-3 (sem DST desde 2019).
 * Local 02:00 ↔ 05:00Z, local 08:00 ↔ 11:00Z, local 10:00 ↔ 13:00Z.
 * 2026-06-25 é quinta-feira (weekday 4).
 */

import { describe, it, expect, beforeEach } from "vitest";

const {
  isAutomaticSource,
  evaluateSendWindow,
  loadOrgSendWindow,
  guardAutomaticSend,
  _resetSendWindowCache,
} = await import("../../supabase/functions/_shared/send-window.ts");

const TZ = "America/Sao_Paulo";
const WIN = {
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  fromMinutes: 8 * 60, // 08:00
  toMinutes: 21 * 60, // 21:00
  timezone: TZ,
};

/** Mock do client Supabase que devolve `row` no maybeSingle da tabela organizations. */
function mockSupabase(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  _resetSendWindowCache();
});

describe("isAutomaticSource", () => {
  it("classifica fontes automáticas por prefixo", () => {
    expect(isAutomaticSource("copilot-outbound")).toBe(true);
    expect(isAutomaticSource("copilot-outbound-audio")).toBe(true);
    expect(isAutomaticSource("workflow")).toBe(true);
    expect(isAutomaticSource("campaign")).toBe(true);
    expect(isAutomaticSource("pipe")).toBe(true);
    expect(isAutomaticSource("mass")).toBe(true);
  });

  it("nunca trata manual / ausente / desconhecido como automático", () => {
    expect(isAutomaticSource("manual")).toBe(false);
    expect(isAutomaticSource(undefined)).toBe(false);
    expect(isAutomaticSource(null)).toBe(false);
    expect(isAutomaticSource("")).toBe(false);
    expect(isAutomaticSource("human-chat")).toBe(false);
  });
});

describe("evaluateSendWindow", () => {
  it("libera dentro da janela (10:00 local)", () => {
    const d = evaluateSendWindow(WIN, new Date("2026-06-25T13:00:00Z")); // 10:00 BRT
    expect(d.allowed).toBe(true);
    expect(d.nextValidAt).toBeNull();
  });

  it("aceita exatamente a abertura (meio-aberta [from, to))", () => {
    const d = evaluateSendWindow(WIN, new Date("2026-06-25T11:00:00Z")); // 08:00 BRT
    expect(d.allowed).toBe(true);
  });

  it("bloqueia 02:00 da madrugada e reagenda p/ 08:00 do mesmo dia", () => {
    const d = evaluateSendWindow(WIN, new Date("2026-06-25T05:00:00Z")); // 02:00 BRT
    expect(d.allowed).toBe(false);
    expect(d.nextValidAt?.toISOString()).toBe("2026-06-25T11:00:00.000Z"); // 08:00 BRT
  });

  it("bloqueia após o fecho (22:00) e reagenda p/ 08:00 do dia seguinte", () => {
    const d = evaluateSendWindow(WIN, new Date("2026-06-26T01:00:00Z")); // 22:00 BRT do dia 25
    expect(d.allowed).toBe(false);
    expect(d.nextValidAt?.toISOString()).toBe("2026-06-26T11:00:00.000Z"); // 08:00 BRT dia 26
  });

  it("trata exatamente o fecho (21:00) como fora", () => {
    const d = evaluateSendWindow(WIN, new Date("2026-06-26T00:00:00Z")); // 21:00 BRT dia 25
    expect(d.allowed).toBe(false);
    expect(d.nextValidAt?.toISOString()).toBe("2026-06-26T11:00:00.000Z");
  });

  it("pula dia da semana excluído", () => {
    // Janela só seg-sex (1..5). Sáb 2026-06-27 10:00 BRT → seg 2026-06-29 08:00.
    const weekdaysOnly = { ...WIN, days: [1, 2, 3, 4, 5] };
    const d = evaluateSendWindow(weekdaysOnly, new Date("2026-06-27T13:00:00Z")); // sáb 10:00 BRT
    expect(d.allowed).toBe(false);
    expect(d.nextValidAt?.toISOString()).toBe("2026-06-29T11:00:00.000Z"); // seg 08:00 BRT
  });

  it("libera quando desativada (madrugada passa)", () => {
    const d = evaluateSendWindow({ ...WIN, enabled: false }, new Date("2026-06-25T05:00:00Z"));
    expect(d.allowed).toBe(true);
    expect(d.nextValidAt).toBeNull();
  });

  it("libera quando nenhum dia configurado (misconfig → não bloqueia)", () => {
    const d = evaluateSendWindow({ ...WIN, days: [] }, new Date("2026-06-25T05:00:00Z"));
    expect(d.allowed).toBe(true);
  });
});

describe("loadOrgSendWindow", () => {
  it("mapeia colunas da org e reutiliza timezone", async () => {
    const sb = mockSupabase({
      timezone: TZ,
      auto_send_window_enabled: true,
      auto_send_window_from_minutes: 540,
      auto_send_window_to_minutes: 1080,
      auto_send_window_days: [1, 2, 3, 4, 5],
    });
    const win = await loadOrgSendWindow(sb, "org-1");
    expect(win).toEqual({
      enabled: true,
      days: [1, 2, 3, 4, 5],
      fromMinutes: 540,
      toMinutes: 1080,
      timezone: TZ,
    });
  });

  it("fail-open: erro de leitura → enabled=false (não bloqueia)", async () => {
    const throwing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error("db down");
            },
          }),
        }),
      }),
    };
    const win = await loadOrgSendWindow(throwing, "org-err");
    expect(win.enabled).toBe(false);
  });

  it("fail-open: org sem colunas (null) → enabled=false", async () => {
    const win = await loadOrgSendWindow(mockSupabase(null), "org-null");
    expect(win.enabled).toBe(false);
  });
});

describe("guardAutomaticSend", () => {
  it("libera manual sem tocar no banco", async () => {
    const throwing = {
      from: () => {
        throw new Error("não deveria consultar p/ fonte manual");
      },
    };
    const d = await guardAutomaticSend(throwing, "org-x", "manual");
    expect(d.allowed).toBe(true);
  });

  it("bloqueia copilot-outbound de madrugada", async () => {
    const sb = mockSupabase({
      timezone: TZ,
      auto_send_window_enabled: true,
      auto_send_window_from_minutes: 480,
      auto_send_window_to_minutes: 1260,
      auto_send_window_days: [0, 1, 2, 3, 4, 5, 6],
    });
    const d = await guardAutomaticSend(sb, "org-night", "copilot-outbound", new Date("2026-06-25T05:00:00Z"));
    expect(d.allowed).toBe(false);
    expect(d.nextValidAt?.toISOString()).toBe("2026-06-25T11:00:00.000Z");
  });

  it("libera copilot-outbound dentro da janela", async () => {
    const sb = mockSupabase({
      timezone: TZ,
      auto_send_window_enabled: true,
      auto_send_window_from_minutes: 480,
      auto_send_window_to_minutes: 1260,
      auto_send_window_days: [0, 1, 2, 3, 4, 5, 6],
    });
    const d = await guardAutomaticSend(sb, "org-day", "copilot-outbound", new Date("2026-06-25T13:00:00Z"));
    expect(d.allowed).toBe(true);
  });
});
