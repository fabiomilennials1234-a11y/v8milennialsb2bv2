import { describe, it, expect } from "vitest";

import { TETO_DE_CARTOES, dispensar, empilhar, expirar } from "./pilha-de-cartoes";
import type { Aviso } from "./aviso-stream";

const AGORA = new Date("2026-08-31T17:00:00.000Z").getTime();

function aviso(over: Partial<Aviso> = {}): Aviso {
  return {
    id: "aviso-1",
    organization_id: "org",
    user_id: "user",
    type: "lead_message",
    title: "Marcos Andrade",
    description: "Consigo fechar hoje",
    link: "/chat",
    lead_id: "lead-1",
    entity_id: null,
    group_key: "msg:lead-1",
    event_count: 1,
    last_event_at: new Date(AGORA).toISOString(),
    created_at: new Date(AGORA).toISOString(),
    read_at: null,
    ...over,
  };
}

describe("pilha de cartões", () => {
  it("cinco mensagens do mesmo lead são um cartão que atualiza, nunca cinco", () => {
    let pilha = empilhar([], aviso(), AGORA, true).pilha;

    for (let i = 2; i <= 5; i += 1) {
      pilha = empilhar(
        pilha,
        aviso({ event_count: i, description: `mensagem ${i}` }),
        AGORA + i * 1000,
        true,
      ).pilha;
    }

    expect(pilha).toHaveLength(1);
    expect(pilha[0].eventCount).toBe(5);
    expect(pilha[0].descricao).toBe("mensagem 5");
  });

  it("o quarto cartão empurra o mais antigo e conta como excedente", () => {
    let pilha: ReturnType<typeof empilhar>["pilha"] = [];
    for (const lead of ["lead-1", "lead-2", "lead-3"]) {
      pilha = empilhar(pilha, aviso({ lead_id: lead, group_key: `msg:${lead}` }), AGORA, true).pilha;
    }

    const resultado = empilhar(
      pilha,
      aviso({ lead_id: "lead-4", group_key: "msg:lead-4" }),
      AGORA,
      true,
    );

    expect(resultado.pilha).toHaveLength(TETO_DE_CARTOES);
    expect(resultado.excedente).toBe(1);
    expect(resultado.pilha.map((c) => c.groupKey)).toEqual([
      "msg:lead-2",
      "msg:lead-3",
      "msg:lead-4",
    ]);
  });

  it("automação parada não perde a vez para uma mensagem", () => {
    let pilha = empilhar([], aviso({ type: "workflow_alert", group_key: "wf:1" }), AGORA, true).pilha;
    for (const lead of ["lead-1", "lead-2"]) {
      pilha = empilhar(pilha, aviso({ lead_id: lead, group_key: `msg:${lead}` }), AGORA, true).pilha;
    }

    const resultado = empilhar(
      pilha,
      aviso({ lead_id: "lead-9", group_key: "msg:lead-9" }),
      AGORA,
      true,
    );

    expect(resultado.pilha.map((c) => c.groupKey)).toContain("wf:1");
    expect(resultado.excedente).toBe(1);
  });

  it("mensagem some sozinha; automação parada fica até alguém agir", () => {
    let pilha = empilhar([], aviso(), AGORA, true).pilha;
    pilha = empilhar(pilha, aviso({ type: "workflow_alert", group_key: "wf:1" }), AGORA, true).pilha;

    const depois = expirar(pilha, AGORA + 9_000);

    expect(depois.map((c) => c.tipo)).toEqual(["workflow_alert"]);
  });

  it("a rajada renova a vida do cartão em vez de deixá-lo vencer no meio", () => {
    const primeira = empilhar([], aviso(), AGORA, true).pilha;
    const segunda = empilhar(primeira, aviso({ event_count: 2 }), AGORA + 7_000, true).pilha;

    expect(expirar(segunda, AGORA + 9_000)).toHaveLength(1);
  });

  it("com a aba escondida o cartão não entra — o som já chamou, e voltar para uma pilha é pior", () => {
    const resultado = empilhar([], aviso(), AGORA, false);

    expect(resultado.pilha).toHaveLength(0);
    expect(resultado.excedente).toBe(1);
  });

  it("dispensar tira só o cartão pedido", () => {
    let pilha = empilhar([], aviso(), AGORA, true).pilha;
    pilha = empilhar(pilha, aviso({ type: "workflow_alert", group_key: "wf:1" }), AGORA, true).pilha;

    expect(dispensar(pilha, "msg:lead-1").map((c) => c.groupKey)).toEqual(["wf:1"]);
  });
});
