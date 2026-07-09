import { describe, it, expect } from "vitest";
import {
  AUTO_CLOSE_DAYS,
  canClientTransition,
  isEligibleForAutoClose,
  isTerminal,
  nextStatus,
  type TicketEvent,
} from "./ticket-lifecycle";
import type { TicketStatus } from "./support-ticket-draft";

const at = (iso: string) => new Date(iso);

describe("nextStatus", () => {
  const ok = (from: TicketStatus, event: TicketEvent, to: TicketStatus) =>
    expect(nextStatus(from, event)).toEqual({ ok: true, status: to });

  const nope = (from: TicketStatus, event: TicketEvent) =>
    expect(nextStatus(from, event)).toMatchObject({ ok: false });

  it("o suporte pega o chamado e trabalha", () => {
    ok("aberto", "staff_start", "em_andamento");
    ok("em_andamento", "staff_await_customer", "aguardando_cliente");
    ok("aguardando_cliente", "customer_replied", "em_andamento");
    ok("em_andamento", "staff_resolve", "resolvido");
  });

  it("o suporte resolve direto de aberto", () => {
    ok("aberto", "staff_resolve", "resolvido");
  });

  // O staff move o chamado livremente entre os estados de trabalho — pode pedir
  // algo ao cliente antes de "pegar" o chamado. E' o que o trigger no banco
  // permite; um mapa mais estrito aqui seria uma restricao so da UI.
  it("o suporte pede algo ao cliente sem antes pegar o chamado", () => {
    ok("aberto", "staff_await_customer", "aguardando_cliente");
  });

  it("o suporte reabre o trabalho de um chamado que estava aguardando", () => {
    ok("aguardando_cliente", "staff_start", "em_andamento");
  });

  // `aberto` significa nao triado. Nao existe um estado `triado` — status a mais
  // e status que ninguem atualiza.
  it("resolvido pode voltar ao trabalho pelas mãos do staff", () => {
    ok("resolvido", "staff_start", "em_andamento");
  });

  it("reabrir devolve o chamado a aberto", () => {
    ok("resolvido", "reopen", "aberto");
  });

  // Fechado é terminal. Depois da janela, o cliente abre um chamado novo.
  it("fechado é terminal — nem reabrir, nem o suporte", () => {
    nope("fechado", "reopen");
    nope("fechado", "staff_start");
    nope("fechado", "staff_resolve");
    nope("fechado", "auto_close");
  });

  it("só um chamado resolvido fecha sozinho", () => {
    ok("resolvido", "auto_close", "fechado");
    nope("aberto", "auto_close");
    nope("em_andamento", "auto_close");
    nope("aguardando_cliente", "auto_close");
  });

  it("não se reabre o que não foi resolvido", () => {
    nope("aberto", "reopen");
    nope("em_andamento", "reopen");
    nope("aguardando_cliente", "reopen");
  });

  it("a transição inválida diz de onde para onde", () => {
    const result = nextStatus("fechado", "reopen");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.from).toBe("fechado");
      expect(result.event).toBe("reopen");
    }
  });
});

describe("canClientTransition", () => {
  // O cliente só reabre. Mudar para `em_andamento` ou `fechado` é do suporte —
  // e a RLS permite ao autor dar UPDATE no proprio chamado, entao a regra
  // precisa existir alem da policy.
  it("o cliente só reabre", () => {
    expect(canClientTransition("reopen")).toBe(true);
  });

  it("o cliente não trabalha o próprio chamado", () => {
    expect(canClientTransition("staff_start")).toBe(false);
    expect(canClientTransition("staff_resolve")).toBe(false);
    expect(canClientTransition("staff_await_customer")).toBe(false);
    expect(canClientTransition("customer_replied")).toBe(false);
  });

  it("o cliente não fecha o próprio chamado por decurso de prazo", () => {
    expect(canClientTransition("auto_close")).toBe(false);
  });
});

describe("isEligibleForAutoClose", () => {
  const agora = at("2026-07-20T12:00:00Z");

  it("um chamado resolvido há 7 dias fecha", () => {
    expect(isEligibleForAutoClose("resolvido", at("2026-07-13T11:59:00Z"), agora)).toBe(true);
  });

  it("um chamado resolvido há 6 dias não fecha", () => {
    expect(isEligibleForAutoClose("resolvido", at("2026-07-14T12:00:00Z"), agora)).toBe(false);
  });

  it("a janela é de 7 dias", () => {
    expect(AUTO_CLOSE_DAYS).toBe(7);
  });

  it("sem resolved_at, não fecha", () => {
    expect(isEligibleForAutoClose("resolvido", null, agora)).toBe(false);
  });

  it("só o resolvido fecha sozinho", () => {
    const antigo = at("2026-01-01T00:00:00Z");
    expect(isEligibleForAutoClose("aberto", antigo, agora)).toBe(false);
    expect(isEligibleForAutoClose("em_andamento", antigo, agora)).toBe(false);
    expect(isEligibleForAutoClose("aguardando_cliente", antigo, agora)).toBe(false);
    expect(isEligibleForAutoClose("fechado", antigo, agora)).toBe(false);
  });
});

describe("isTerminal", () => {
  it("só fechado é terminal", () => {
    expect(isTerminal("fechado")).toBe(true);
    expect(isTerminal("resolvido")).toBe(false);
    expect(isTerminal("aberto")).toBe(false);
  });
});
