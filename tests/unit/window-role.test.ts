/**
 * Contrato de compatibilidade do vocabulário gravado em
 * `WorkflowBehaviorWindow.action` → papel da janela.
 *
 * Esta tabela É o contrato. Toda definição viva em prod tem uma linha aqui;
 * mudar qualquer mapeamento muda o comportamento de um workflow real.
 */

import { describe, it, expect } from "vitest";
import {
  resolveWindowRole,
  isSendWindow,
  type WindowRole,
} from "../../supabase/functions/_shared/workflow-window-role";

describe("resolveWindowRole — tabela de compatibilidade", () => {
  const cases: Array<{
    action: string | undefined | null;
    expected: WindowRole;
    why: string;
  }> = [
    // ── Envio explícito ────────────────────────────────────────────────────
    { action: "pass", expected: { kind: "send" }, why: "vocabulário atual da UI" },

    // ── Ausência / vazio ───────────────────────────────────────────────────
    { action: "", expected: { kind: "send" }, why: "string vazia" },
    { action: "   ", expected: { kind: "send" }, why: "só espaços" },
    { action: undefined, expected: { kind: "send" }, why: "campo ausente" },
    { action: null, expected: { kind: "send" }, why: "campo nulo" },

    // ── Legado com alvo VAZIO → envio (Chique: 7 workflows em prod) ────────
    { action: "hold_until:", expected: { kind: "send" }, why: "Chique — alvo vazio é a janela de trabalho" },
    { action: "hold_until:   ", expected: { kind: "send" }, why: "alvo só com espaços" },
    { action: "  hold_until:  ", expected: { kind: "send" }, why: "action com espaços em volta" },

    // ── Legado com alvo NOMEADO → blackout (Bertin) ───────────────────────
    {
      action: "hold_until:Comercial",
      expected: { kind: "blackout", resumeHint: "Comercial" },
      why: "Bertin — janela de sáb/dom que resume em Comercial",
    },
    {
      action: "hold_until:Horário Comercial",
      expected: { kind: "blackout", resumeHint: "Horário Comercial" },
      why: "alvo com espaço no meio sobrevive",
    },
    {
      action: "hold_until:Turno A:B",
      expected: { kind: "blackout", resumeHint: "Turno A:B" },
      why: "alvo com ':' — split(':')[1] truncaria para 'Turno A'",
    },

    // ── Route (Happyneis: workflow ATIVO, 3 janelas) ──────────────────────
    {
      action: "route:Horário Comercial",
      expected: { kind: "route", key: "Horário Comercial" },
      why: "Happyneis — janela 1",
    },
    {
      action: "route:Fora do Horário Comercial",
      expected: { kind: "route", key: "Fora do Horário Comercial" },
      why: "Happyneis — janela 2",
    },
    {
      action: "route:Final de semana",
      expected: { kind: "route", key: "Final de semana" },
      why: "Happyneis — janela 3",
    },
    {
      action: "route:weekend_branch",
      expected: { kind: "route", key: "weekend_branch" },
      why: "chave estilo slug",
    },
    {
      action: "route:a:b",
      expected: { kind: "route", key: "a:b" },
      why: "chave com ':' — split(':')[1] truncaria para 'a'",
    },

    // ── Route com chave VAZIA → envio (não pode estrangular a org) ────────
    { action: "route:", expected: { kind: "send" }, why: "chave vazia" },
    { action: "route:   ", expected: { kind: "send" }, why: "chave só com espaços" },

    // ── Desconhecido → envio, nunca falha ────────────────────────────────
    { action: "hold", expected: { kind: "send" }, why: "valor legado solto" },
    { action: "send", expected: { kind: "send" }, why: "nome que nunca foi gravado" },
    { action: "lixo aleatório", expected: { kind: "send" }, why: "texto arbitrário" },
    { action: "HOLD_UNTIL:Comercial", expected: { kind: "send" }, why: "case-sensitive — prefixo não casa" },
  ];

  for (const { action, expected, why } of cases) {
    it(`${JSON.stringify(action)} → ${expected.kind} (${why})`, () => {
      expect(resolveWindowRole(action)).toEqual(expected);
    });
  }

  it("nunca lança, qualquer que seja a entrada", () => {
    const hostile = [
      undefined, null, "", ":", "::", "hold_until", "route",
      "hold_until::", "route::", "\n", "pass ",
      // deno-lint-ignore no-explicit-any
      123 as any, {} as any, [] as any,
    ];
    for (const a of hostile) {
      expect(() => resolveWindowRole(a)).not.toThrow();
      expect(["send", "route", "blackout"]).toContain(resolveWindowRole(a).kind);
    }
  });

  it("tipos não-string caem em send", () => {
    // deno-lint-ignore no-explicit-any
    expect(resolveWindowRole(42 as any)).toEqual({ kind: "send" });
    // deno-lint-ignore no-explicit-any
    expect(resolveWindowRole({} as any)).toEqual({ kind: "send" });
  });
});

describe("isSendWindow", () => {
  it("cobre exatamente os papéis de envio", () => {
    expect(isSendWindow("pass")).toBe(true);
    expect(isSendWindow("hold_until:")).toBe(true);
    expect(isSendWindow(undefined)).toBe(true);
    expect(isSendWindow("hold_until:Comercial")).toBe(false);
    expect(isSendWindow("route:x")).toBe(false);
  });
});
