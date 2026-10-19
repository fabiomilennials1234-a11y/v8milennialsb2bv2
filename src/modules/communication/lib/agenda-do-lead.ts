/**
 * Agenda do lead dentro da conversa: o que está por vir e o que ficou em atraso.
 *
 * A regra de atraso é a MESMA de `isOverdueEvent` da Agenda (não compareceu, ou
 * passou do horário sem resultado) — repetida aqui sobre `Meeting` porque o chat
 * lê a tabela `meetings` direto, sem passar pelo feed unificado. Se uma mudar,
 * a outra muda junto.
 *
 * Só `event_type = 'meeting'`: ligação, follow-up e tarefa têm o próprio lugar,
 * e comparecimento só existe para reunião (ver `podeRegistrarResultado`).
 */

import { isSameDay } from "date-fns";

/** O recorte de `Meeting` que o resumo lê — evita acoplar o chat ao tipo inteiro. */
export interface ReuniaoDoLead {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  event_type: string;
}

export type SituacaoNaAgenda = "atrasada" | "hoje" | "proxima";

export interface ItemAgendaDoLead {
  id: string;
  title: string;
  start: Date;
  situacao: SituacaoNaAgenda;
  /** `no_show` diz que a pessoa faltou; o outro atraso é "ninguém registrou". */
  faltou: boolean;
}

export interface AgendaDoLead {
  itens: ItemAgendaDoLead[];
  atrasadas: number;
  proxima: ItemAgendaDoLead | null;
}

export function resumirAgendaDoLead(
  reunioes: ReuniaoDoLead[],
  agora: Date = new Date(),
): AgendaDoLead {
  const itens: ItemAgendaDoLead[] = [];

  for (const r of reunioes) {
    if (r.event_type !== "meeting") continue;
    const status = (r.status ?? "").toLowerCase();
    if (status === "completed" || status === "cancelled" || status === "canceled") continue;

    const start = new Date(r.start_at);
    const end = new Date(r.end_at);
    const faltou = status === "no_show";
    const passou = end.getTime() < agora.getTime();

    let situacao: SituacaoNaAgenda;
    if (faltou || passou) situacao = "atrasada";
    else if (isSameDay(start, agora)) situacao = "hoje";
    else situacao = "proxima";

    itens.push({ id: r.id, title: r.title, start, situacao, faltou });
  }

  // O atraso vem primeiro (é o que pede ação), depois o que vem por aí em ordem.
  itens.sort((a, b) => {
    if ((a.situacao === "atrasada") !== (b.situacao === "atrasada")) {
      return a.situacao === "atrasada" ? -1 : 1;
    }
    return a.start.getTime() - b.start.getTime();
  });

  return {
    itens,
    atrasadas: itens.filter((i) => i.situacao === "atrasada").length,
    proxima: itens.find((i) => i.situacao !== "atrasada") ?? null,
  };
}
