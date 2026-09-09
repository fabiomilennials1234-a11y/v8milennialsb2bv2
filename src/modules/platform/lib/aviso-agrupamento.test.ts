import { describe, it, expect } from "vitest";

import { agruparPorTempo, contarPorFamilia, filtrarPorFamilia } from "./aviso-agrupamento";
import type { Aviso } from "./aviso-stream";

function aviso(tipo: string, over: Partial<Aviso> = {}): Aviso {
  return {
    id: `aviso-${tipo}-${over.id ?? "1"}`,
    organization_id: "org",
    user_id: "user",
    type: tipo,
    title: tipo,
    description: null,
    link: null,
    lead_id: null,
    entity_id: null,
    group_key: null,
    event_count: 1,
    last_event_at: "2026-08-31T12:00:00.000Z",
    created_at: "2026-08-31T12:00:00.000Z",
    read_at: null,
    ...over,
  };
}

describe("famílias do sino", () => {
  const lista = [
    aviso("lead_message"),
    aviso("lead_message", { id: "2" }),
    aviso("lead_new"),
    aviso("meeting_booked"),
    aviso("meeting_soon"),
    aviso("follow_up_overdue"),
    aviso("workflow_alert"),
    aviso("um_tipo_que_ainda_nao_existe"),
  ];

  it("conta por família, e o tipo desconhecido cai em Sistema em vez de sumir", () => {
    expect(contarPorFamilia(lista)).toEqual({
      tudo: 8,
      mensagens: 2,
      leads: 1,
      agenda: 3,
      sistema: 2,
    });
  });

  it("filtra pela família escolhida", () => {
    expect(filtrarPorFamilia(lista, "agenda").map((a) => a.type)).toEqual([
      "meeting_booked",
      "meeting_soon",
      "follow_up_overdue",
    ]);
    expect(filtrarPorFamilia(lista, "tudo")).toHaveLength(8);
  });
});

describe("agrupamento por tempo", () => {
  const agora = new Date("2026-08-31T15:00:00.000Z");

  it("separa o que acabou de acontecer, o que é de hoje e o resto", () => {
    const lista = [
      aviso("lead_message", { id: "recente", last_event_at: "2026-08-31T14:40:00.000Z" }),
      aviso("lead_new", { id: "de-manha", last_event_at: "2026-08-31T08:00:00.000Z" }),
      aviso("workflow_alert", { id: "ontem", last_event_at: "2026-08-30T22:00:00.000Z" }),
    ];

    const grupos = agruparPorTempo(lista, agora);

    expect(grupos.map((g) => g.rotulo)).toEqual(["Agora", "Hoje", "Antes"]);
    expect(grupos.map((g) => g.avisos.map((a) => a.id))).toEqual([
      ["recente"],
      ["de-manha"],
      ["ontem"],
    ]);
  });

  it("não devolve grupo vazio — rótulo sem conteúdo é ruído na lista", () => {
    const lista = [aviso("lead_message", { last_event_at: "2026-08-31T14:59:00.000Z" })];

    expect(agruparPorTempo(lista, agora).map((g) => g.rotulo)).toEqual(["Agora"]);
  });

  it("ordena o Aviso sem last_event_at pela criação, em vez de descartá-lo", () => {
    const lista = [
      aviso("transfer_to_human", {
        id: "legado",
        last_event_at: null,
        created_at: "2026-08-31T14:50:00.000Z",
      }),
    ];

    const grupos = agruparPorTempo(lista, agora);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].rotulo).toBe("Agora");
  });
});
