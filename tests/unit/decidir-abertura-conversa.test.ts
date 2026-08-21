/**
 * Unit tests for `decidirAberturaConversa` — a regra que decide se o clique no
 * botão "falar com o lead" abre direto ou pergunta.
 *
 * Decisão 1 da spec (`.specs/features/conversa-do-lead/SPEC.md`): com mais de
 * uma caixa, o produto SEMPRE pergunta — mesmo que só uma tenha histórico.
 * Previsível vence economia de clique, e duas regras para a mesma pergunta é
 * como a prop `primaryInstanceId` morreu.
 */

import { describe, it, expect } from "vitest";
import { decidirAberturaConversa } from "@/modules/communication/lib/decidirAberturaConversa";
import type { ConversaDoLeadRow } from "@/modules/communication/lib/agruparConversasDoLead";

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

describe("decidirAberturaConversa", () => {
  it("uma caixa só → abre direto, sem perguntar", () => {
    expect(decidirAberturaConversa({ caixas: [caixa({ instanceId: "unica" })] })).toEqual({
      acao: "abrir",
      instanceId: "unica",
    });
  });

  it("duas caixas → pergunta, mesmo que só uma tenha conversa", () => {
    // É o coração da decisão 1. Só uma tem histórico, então a resposta parece
    // óbvia — e mesmo assim perguntamos, para a regra ser uma só.
    const decisao = decidirAberturaConversa({
      caixas: [
        caixa({ instanceId: "com", lastMessageAt: "2026-08-10T00:00:00Z" }),
        caixa({ instanceId: "sem" }),
      ],
    });

    expect(decisao).toEqual({ acao: "perguntar" });
  });

  it("nenhuma caixa → nada a abrir", () => {
    expect(decidirAberturaConversa({ caixas: [] })).toEqual({ acao: "sem-caixa" });
  });
});
