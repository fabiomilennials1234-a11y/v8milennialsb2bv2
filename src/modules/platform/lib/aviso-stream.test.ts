import { describe, it, expect } from "vitest";

import { aplicarEventoDeAviso, contarNaoLidos, type Aviso } from "./aviso-stream";

const ORG = "org-ativa";

function aviso(over: Partial<Aviso> = {}): Aviso {
  return {
    id: "aviso-1",
    organization_id: ORG,
    user_id: "user-1",
    type: "lead_message",
    title: "Marcos Andrade",
    description: "Consigo fechar hoje",
    link: "/chat",
    lead_id: "lead-1",
    entity_id: "lead-1",
    group_key: "msg:lead-1",
    event_count: 1,
    last_event_at: "2026-08-31T12:00:00.000Z",
    created_at: "2026-08-31T12:00:00.000Z",
    read_at: null,
    ...over,
  };
}

describe("aplicarEventoDeAviso", () => {
  it("põe o Aviso novo no topo, ordenado pelo último evento", () => {
    const antigo = aviso({
      id: "aviso-antigo",
      group_key: "msg:lead-9",
      last_event_at: "2026-08-31T09:00:00.000Z",
    });
    const chegando = aviso({
      id: "aviso-novo",
      group_key: "msg:lead-2",
      last_event_at: "2026-08-31T15:00:00.000Z",
    });

    const lista = aplicarEventoDeAviso([antigo], { tipo: "INSERT", aviso: chegando }, ORG);

    expect(lista.map((a) => a.id)).toEqual(["aviso-novo", "aviso-antigo"]);
  });
  it("atualiza o Aviso que engordou sem duplicá-lo, e o traz para cima", () => {
    const conversa = aviso({ id: "aviso-1", last_event_at: "2026-08-31T09:00:00.000Z" });
    const outro = aviso({
      id: "aviso-2",
      group_key: "lead:lead-7",
      last_event_at: "2026-08-31T10:00:00.000Z",
    });

    const engordou = { ...conversa, event_count: 4, last_event_at: "2026-08-31T11:00:00.000Z" };
    const lista = aplicarEventoDeAviso([outro, conversa], { tipo: "UPDATE", aviso: engordou }, ORG);

    expect(lista).toHaveLength(2);
    expect(lista[0].id).toBe("aviso-1");
    expect(lista[0].event_count).toBe(4);
  });

  it("ignora Aviso nascido em outra organização", () => {
    const deOutraOrg = aviso({ id: "aviso-de-fora", organization_id: "outra-org" });

    const lista = aplicarEventoDeAviso([], { tipo: "INSERT", aviso: deOutraOrg }, ORG);

    expect(lista).toEqual([]);
  });

  it("remove o Aviso apagado", () => {
    const existente = aviso({ id: "aviso-1" });

    const lista = aplicarEventoDeAviso([existente], { tipo: "DELETE", aviso: { id: "aviso-1" } }, ORG);

    expect(lista).toEqual([]);
  });

  it("mantém o Aviso lido na lista, mas fora da contagem do badge", () => {
    const naoLido = aviso({ id: "aviso-1" });
    const lido = aviso({ id: "aviso-2", group_key: "lead:lead-3", read_at: "2026-08-31T13:00:00.000Z" });

    const lista = aplicarEventoDeAviso([naoLido], { tipo: "UPDATE", aviso: lido }, ORG);

    expect(lista).toHaveLength(2);
    expect(contarNaoLidos(lista)).toBe(1);
  });
});
