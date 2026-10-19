import { describe, expect, it } from "vitest";

import {
  resumirAgendaDoLead,
  type ReuniaoDoLead,
} from "@/modules/communication/lib/agenda-do-lead";

const agora = new Date(2026, 9, 19, 12, 0);

function reuniao(over: Partial<ReuniaoDoLead> & { dia: number; hora: number }): ReuniaoDoLead {
  const { dia, hora, ...resto } = over;
  return {
    id: `m-${dia}-${hora}`,
    title: "Visita",
    start_at: new Date(2026, 9, dia, hora).toISOString(),
    end_at: new Date(2026, 9, dia, hora + 1).toISOString(),
    status: "scheduled",
    event_type: "meeting",
    ...resto,
  };
}

describe("agenda do lead no chat", () => {
  it("separa atraso, hoje e próxima, com o atraso primeiro", () => {
    const r = resumirAgendaDoLead(
      [
        reuniao({ dia: 22, hora: 10 }),
        reuniao({ dia: 19, hora: 15 }),
        reuniao({ dia: 17, hora: 9, status: "no_show" }),
        reuniao({ dia: 18, hora: 9 }),
      ],
      agora,
    );
    expect(r.itens.map((i) => i.situacao)).toEqual(["atrasada", "atrasada", "hoje", "proxima"]);
    expect(r.atrasadas).toBe(2);
    expect(r.proxima?.situacao).toBe("hoje");
    expect(r.itens[0].faltou).toBe(true);
  });

  it("concluída, cancelada e outros tipos ficam de fora", () => {
    const r = resumirAgendaDoLead(
      [
        reuniao({ dia: 18, hora: 9, status: "completed" }),
        reuniao({ dia: 22, hora: 9, status: "cancelled" }),
        reuniao({ dia: 22, hora: 11, event_type: "call" }),
      ],
      agora,
    );
    expect(r.itens).toEqual([]);
    expect(r.proxima).toBeNull();
  });

  it("sem reunião: tudo vazio", () => {
    expect(resumirAgendaDoLead([], agora)).toEqual({ itens: [], atrasadas: 0, proxima: null });
  });
});
