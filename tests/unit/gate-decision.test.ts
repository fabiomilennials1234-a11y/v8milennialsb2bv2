/**
 * gate-decision — decisão pura dos gates de entrada do agent-message quando o
 * inbound não vai gerar resposta (sem agente ativo / audience blocked).
 *
 * Critérios de aceite da feature auto_create_lead_on_inbound:
 *   - Flag OFF (default) → comportamento byte-a-byte de hoje (reasons legados,
 *     NÃO cria lead).
 *   - Flag ON → cria o lead e reporta reason distinto, mantendo o early-return
 *     (a IA nunca responde num contexto onde hoje não responderia).
 */

import { describe, it, expect, vi } from "vitest";

vi.stubGlobal("Deno", {
  env: { get: () => undefined, toObject: () => ({}) },
  serve: () => {},
});

const { decideBlockedInboundAction } = await import(
  "../../supabase/functions/agent-message/gate-decision.ts"
);

describe("decideBlockedInboundAction", () => {
  describe("flag OFF (retrocompat — comportamento de hoje)", () => {
    it("no_active_agents → não cria lead, reason legado 'no_active_agents'", () => {
      expect(decideBlockedInboundAction("no_active_agents", false)).toEqual({
        createLead: false,
        reason: "no_active_agents",
      });
    });

    it("audience_blocked → não cria lead, reason legado 'unknown_phone_blocked'", () => {
      expect(decideBlockedInboundAction("audience_blocked", false)).toEqual({
        createLead: false,
        reason: "unknown_phone_blocked",
      });
    });
  });

  describe("flag ON (cria lead, mantém early-return)", () => {
    it("no_active_agents → cria lead, reason 'lead_created_no_ai'", () => {
      expect(decideBlockedInboundAction("no_active_agents", true)).toEqual({
        createLead: true,
        reason: "lead_created_no_ai",
      });
    });

    it("audience_blocked → cria lead, reason 'lead_created_ai_blocked'", () => {
      expect(decideBlockedInboundAction("audience_blocked", true)).toEqual({
        createLead: true,
        reason: "lead_created_ai_blocked",
      });
    });
  });

  it("nunca sinaliza 'responder' — createLead é o único side-effect possível", () => {
    // A função só decide entre bailar e criar-lead-e-bailar; jamais habilita
    // uma resposta da IA. Garante que a flag não regride copilot/automação.
    for (const gate of ["no_active_agents", "audience_blocked"] as const) {
      for (const flag of [true, false]) {
        const d = decideBlockedInboundAction(gate, flag);
        expect(typeof d.createLead).toBe("boolean");
        expect(typeof d.reason).toBe("string");
        expect(d.createLead).toBe(flag);
      }
    }
  });
});
