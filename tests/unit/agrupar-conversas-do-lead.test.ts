/**
 * Unit tests for `agruparConversasDoLead` — os dois grupos do seletor de
 * Conversa do Lead, conforme `.specs/features/conversa-do-lead/SPEC.md`.
 */

import { describe, it, expect } from "vitest";
import {
  agruparConversasDoLead,
  type ConversaDoLeadRow,
} from "@/modules/communication/lib/agruparConversasDoLead";

function caixa(over: Partial<ConversaDoLeadRow> & { instanceId: string }): ConversaDoLeadRow {
  return {
    instanceName: `Caixa ${over.instanceId}`,
    instanceStatus: "connected",
    lastMessageAt: null,
    lastMessageContent: null,
    lastMessageDirection: null,
    ...over,
  };
}

describe("agruparConversasDoLead", () => {
  it("separa caixas com conversa das sem conversa", () => {
    const { comConversa, semConversa } = agruparConversasDoLead({
      rows: [
        caixa({ instanceId: "a", lastMessageAt: "2026-08-10T12:00:00Z" }),
        caixa({ instanceId: "b" }),
      ],
    });

    expect(comConversa.map((r) => r.instanceId)).toEqual(["a"]);
    expect(semConversa.map((r) => r.instanceId)).toEqual(["b"]);
  });

  it("com conversa: mais recente primeiro", () => {
    const { comConversa } = agruparConversasDoLead({
      rows: [
        caixa({ instanceId: "antiga", lastMessageAt: "2026-01-01T00:00:00Z" }),
        caixa({ instanceId: "recente", lastMessageAt: "2026-08-16T00:00:00Z" }),
        caixa({ instanceId: "meio", lastMessageAt: "2026-05-01T00:00:00Z" }),
      ],
    });

    expect(comConversa.map((r) => r.instanceId)).toEqual(["recente", "meio", "antiga"]);
  });

  it("sem conversa: a preferência do usuário vem primeiro", () => {
    const { semConversa } = agruparConversasDoLead({
      rows: [caixa({ instanceId: "outra" }), caixa({ instanceId: "preferida" })],
      preferredInstanceId: "preferida",
    });

    expect(semConversa.map((r) => r.instanceId)).toEqual(["preferida", "outra"]);
  });

  it("sem conversa: conectada ganha de desconectada", () => {
    // Começar um primeiro contato por uma caixa caída não é opção — e essa é a
    // decisão mais cara do fluxo, porque define o dono da conversa.
    const { semConversa } = agruparConversasDoLead({
      rows: [
        caixa({ instanceId: "caida", instanceStatus: "disconnected" }),
        caixa({ instanceId: "no-ar", instanceStatus: "connected" }),
      ],
    });

    expect(semConversa.map((r) => r.instanceId)).toEqual(["no-ar", "caida"]);
  });

  it("preferência vence status: caixa preferida desconectada ainda vem primeiro", () => {
    // A escolha explícita do usuário pesa mais que a heurística de status —
    // senão a lista pula debaixo do dedo quando um número cai.
    const { semConversa } = agruparConversasDoLead({
      rows: [
        caixa({ instanceId: "no-ar", instanceStatus: "connected" }),
        caixa({ instanceId: "preferida-caida", instanceStatus: "disconnected" }),
      ],
      preferredInstanceId: "preferida-caida",
    });

    expect(semConversa.map((r) => r.instanceId)).toEqual(["preferida-caida", "no-ar"]);
  });

  it("empate resolve por nome, para a lista não dançar entre renders", () => {
    const { semConversa } = agruparConversasDoLead({
      rows: [
        caixa({ instanceId: "z", instanceName: "Zebra" }),
        caixa({ instanceId: "a", instanceName: "Alfa" }),
      ],
    });

    expect(semConversa.map((r) => r.instanceName)).toEqual(["Alfa", "Zebra"]);
  });

  // Chamados 52df972e / b7941f5e: admin e master enxergam TODAS as caixas e,
  // sem preferência salva, a lista caía em ordem alfabética — a caixa de outra
  // vendedora aparecia no topo e era aberta no lugar da do próprio usuário.
  describe("caixa de quem atende vem antes das outras", () => {
    const rows = [
      caixa({ instanceId: "carolini", instanceName: "Envase Carolini" }),
      caixa({ instanceId: "fernanda", instanceName: "FERNANDA-TELEVENDAS" }),
      caixa({ instanceId: "isabelle", instanceName: "ISABELLE-TELEVENDAS" }),
    ];

    it("caixa vinculada ao usuário sobe acima da ordem alfabética", () => {
      const { semConversa } = agruparConversasDoLead({ rows, minhasInstanceIds: ["fernanda"] });
      expect(semConversa.map((r) => r.instanceId)).toEqual(["fernanda", "carolini", "isabelle"]);
    });

    it("caixa do responsável do lead vem depois das minhas e antes das demais", () => {
      const { semConversa } = agruparConversasDoLead({
        rows,
        minhasInstanceIds: ["fernanda"],
        doResponsavelInstanceIds: ["isabelle"],
      });
      expect(semConversa.map((r) => r.instanceId)).toEqual(["fernanda", "isabelle", "carolini"]);
    });

    it("master sem caixa própria: a do responsável do lead lidera", () => {
      const { semConversa } = agruparConversasDoLead({
        rows,
        minhasInstanceIds: [],
        doResponsavelInstanceIds: ["isabelle"],
      });
      expect(semConversa[0].instanceId).toBe("isabelle");
    });

    it("preferência salva continua vencendo a caixa vinculada", () => {
      const { semConversa } = agruparConversasDoLead({
        rows,
        preferredInstanceId: "isabelle",
        minhasInstanceIds: ["fernanda"],
      });
      expect(semConversa.map((r) => r.instanceId)).toEqual(["isabelle", "fernanda", "carolini"]);
    });
  });

  it("lista vazia devolve os dois grupos vazios, sem estourar", () => {
    expect(agruparConversasDoLead({ rows: [] })).toEqual({
      comConversa: [],
      semConversa: [],
    });
  });
});
