import { describe, expect, it } from "vitest";
import type { LeadDeal } from "@/modules/leads";
import { negocioEmDestaque } from "./negocioEmDestaque";

function deal(over: Partial<LeadDeal>): LeadDeal {
  return {
    id: "e1",
    leadId: "l1",
    title: "Negócio de out/2026",
    funnelName: "Funil de Vendas",
    funnelColor: "#000",
    pipelineId: "p1",
    pipelineSlug: "vendas",
    isSystem: false,
    stageKey: "conversa",
    stageName: "Em conversa",
    stagePosition: 1,
    stageIndex: 1,
    stageCount: 5,
    outcome: "open",
    won: false,
    value: 0,
    meetingDate: null,
    enteredAt: "2026-09-01T00:00:00Z",
    stageChangedAt: "2026-09-01T00:00:00Z",
    daysInStage: 1,
    ...over,
  };
}

describe("negocioEmDestaque", () => {
  it("sem negócio, sem destaque", () => {
    expect(negocioEmDestaque([])).toBeNull();
    expect(negocioEmDestaque(undefined)).toBeNull();
  });

  it("aberto vence fechado, mesmo o fechado sendo mais recente", () => {
    const r = negocioEmDestaque([
      deal({ id: "ganho", outcome: "won", won: true, stageChangedAt: "2026-10-01T00:00:00Z" }),
      deal({ id: "aberto", stageChangedAt: "2026-08-01T00:00:00Z" }),
    ]);
    expect(r?.negocio.id).toBe("aberto");
  });

  it("entre abertos, o que se mexeu por último — e conta os outros", () => {
    const r = negocioEmDestaque([
      deal({ id: "velho", stageChangedAt: "2026-08-01T00:00:00Z" }),
      deal({ id: "novo", stageChangedAt: "2026-09-20T00:00:00Z" }),
      deal({ id: "meio", stageChangedAt: null, enteredAt: "2026-09-10T00:00:00Z" }),
    ]);
    expect(r?.negocio.id).toBe("novo");
    expect(r?.outrosAbertos).toBe(2);
  });

  it("sem aberto, mostra o fechado mais recente", () => {
    const r = negocioEmDestaque([
      deal({ id: "perdido-antigo", outcome: "lost", stageChangedAt: "2026-07-01T00:00:00Z" }),
      deal({ id: "ganho-recente", outcome: "won", won: true, stageChangedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(r?.negocio.id).toBe("ganho-recente");
    expect(r?.outrosAbertos).toBe(0);
  });

  it("venda histórica nunca é destaque", () => {
    expect(negocioEmDestaque([deal({ id: "h", historicalSale: true, outcome: "won" })])).toBeNull();
  });
});
