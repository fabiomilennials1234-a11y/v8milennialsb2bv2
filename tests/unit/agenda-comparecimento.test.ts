/**
 * Resultado do compromisso: compareceu × não compareceu × sem registro.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * O pedido tem três regras que só se provam com dado, não com render:
 *
 *   1. vale para TODOS os tipos de agenda, sem implementação por tipo;
 *   2. quem não tem resultado registrado não conta nem de um lado nem do outro;
 *   3. trocar o resultado não pode contar duas vezes.
 *
 * A (1) é a que cala fácil: os cinco tipos do botão "Nova atividade" são todos
 * linhas de `meetings`, distinguidas por `event_type` — se alguém um dia
 * ramificar o resultado por tipo, o teste abaixo quebra.
 *
 * A (3) só é verdade porque a contagem é DERIVADA do estado atual, e não
 * acumulada. O teste percorre uma sequência de trocas e confere que o total
 * fecha em toda parada.
 */

import { describe, expect, it } from "vitest";

import type {
  AttendanceOutcome,
  UnifiedEvent,
} from "@/modules/engagement/components/agenda/agenda-helpers";
import {
  EVENT_TYPE_KEYS,
  outcomeOf,
  podeRegistrarResultado,
  resumirComparecimento,
  statusDoResultado,
  STATUS_SEM_RESULTADO,
} from "@/modules/engagement/components/agenda/agenda-helpers";

function evento(over: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    id: "meeting-1",
    title: "Reunião",
    start: new Date(2026, 7, 3, 16, 0),
    end: new Date(2026, 7, 3, 17, 0),
    allDay: false,
    source: "meeting",
    color: "hsl(47, 100%, 50%)",
    description: null,
    location: null,
    meetLink: null,
    leadId: null,
    leadName: null,
    leadCompany: null,
    creatorName: null,
    createdBy: null,
    status: "scheduled",
    eventType: "meeting",
    googleEventId: null,
    googleHtmlLink: null,
    googleCalendarOwnerId: null,
    googleCalendarColor: null,
    googleCalendarOwnerName: null,
    ...over,
  };
}

describe("o resultado vale para TODOS os tipos de agenda", () => {
  it("os cinco tipos do botão 'Nova atividade' aceitam resultado", () => {
    // reunião, ligação, follow-up, tarefa, outro — todos `meetings`.
    for (const eventType of EVENT_TYPE_KEYS) {
      expect(podeRegistrarResultado(evento({ eventType })), eventType).toBe(true);
    }
  });

  it("a leitura do resultado não olha o tipo — é uma implementação só", () => {
    for (const eventType of EVENT_TYPE_KEYS) {
      expect(outcomeOf(evento({ eventType, status: "completed" }))).toBe("compareceu");
      expect(outcomeOf(evento({ eventType, status: "no_show" }))).toBe("nao_compareceu");
      expect(outcomeOf(evento({ eventType, status: "scheduled" }))).toBeNull();
    }
  });

  it("as fontes que são leitura de outras telas NÃO recebem o controle", () => {
    // follow_ups é da tela de Follow-ups, pipe_confirmacao é etapa de kanban
    // (marcar ali moveria o card) e mensagem agendada não comparece a nada.
    for (const source of [
      "follow_up",
      "pipe_confirmacao",
      "scheduled_message",
      "google",
    ] as const) {
      expect(podeRegistrarResultado(evento({ source })), source).toBe(false);
    }
  });
});

describe("o status gravado é o que o CHECK da tabela aceita", () => {
  // `meetings_status_check` = scheduled | completed | cancelled | no_show.
  // Gravar fora disso estoura 23514 no banco, e o erro só apareceria em runtime.
  const PERMITIDOS = new Set(["scheduled", "completed", "cancelled", "no_show"]);

  it("compareceu vira completed, não compareceu vira no_show", () => {
    expect(statusDoResultado("compareceu")).toBe("completed");
    expect(statusDoResultado("nao_compareceu")).toBe("no_show");
  });

  it("desmarcar volta para scheduled", () => {
    expect(STATUS_SEM_RESULTADO).toBe("scheduled");
  });

  it("todo status que a tela grava é aceito pelo CHECK", () => {
    const gravados = [
      statusDoResultado("compareceu"),
      statusDoResultado("nao_compareceu"),
      STATUS_SEM_RESULTADO,
    ];
    for (const s of gravados) expect(PERMITIDOS.has(s), s).toBe(true);
  });

  it("ida e volta: o que se grava é o que se lê", () => {
    const resultados: AttendanceOutcome[] = ["compareceu", "nao_compareceu"];
    for (const r of resultados) {
      expect(outcomeOf(evento({ status: statusDoResultado(r) }))).toBe(r);
    }
    expect(outcomeOf(evento({ status: STATUS_SEM_RESULTADO }))).toBeNull();
  });
});

describe("contagem", () => {
  it("sem resultado não conta para nenhum dos dois lados", () => {
    const r = resumirComparecimento([
      evento({ id: "meeting-a", status: "scheduled" }),
      evento({ id: "meeting-b", status: "scheduled" }),
    ]);
    expect(r).toEqual({ compareceu: 0, naoCompareceu: 0, semRegistro: 2 });
  });

  it("separa os dois totais", () => {
    const r = resumirComparecimento([
      evento({ id: "meeting-a", status: "completed" }),
      evento({ id: "meeting-b", status: "completed" }),
      evento({ id: "meeting-c", status: "no_show" }),
      evento({ id: "meeting-d", status: "scheduled" }),
    ]);
    expect(r).toEqual({ compareceu: 2, naoCompareceu: 1, semRegistro: 1 });
  });

  it("cada evento cai em exatamente UM balde — nunca dobra", () => {
    const eventos = [
      evento({ id: "meeting-a", status: "completed" }),
      evento({ id: "meeting-b", status: "no_show" }),
      evento({ id: "meeting-c", status: "scheduled" }),
      evento({ id: "meeting-d", status: "cancelled" }),
    ];
    const r = resumirComparecimento(eventos);
    expect(r.compareceu + r.naoCompareceu + r.semRegistro).toBe(eventos.length);
  });

  it("trocar o resultado MOVE de balde, não soma", () => {
    // É a regressão que este teste existe para pegar: contagem acumulada
    // (incrementar no clique) dobraria aqui; derivada do estado atual, não.
    const sequencia: Array<[string, { c: number; n: number; s: number }]> = [
      ["scheduled", { c: 0, n: 0, s: 1 }],
      ["completed", { c: 1, n: 0, s: 0 }],
      ["no_show", { c: 0, n: 1, s: 0 }],
      ["completed", { c: 1, n: 0, s: 0 }],
      ["scheduled", { c: 0, n: 0, s: 1 }],
    ];
    for (const [status, esperado] of sequencia) {
      const r = resumirComparecimento([evento({ status })]);
      expect(r, status).toEqual({
        compareceu: esperado.c,
        naoCompareceu: esperado.n,
        semRegistro: esperado.s,
      });
    }
  });

  it("ignora o que não pode ter resultado — senão 'sem registro' viraria ruído", () => {
    const r = resumirComparecimento([
      evento({ id: "meeting-a", status: "completed" }),
      evento({ id: "follow_up-b", source: "follow_up", status: "scheduled" }),
      evento({ id: "pipe_confirmacao-c", source: "pipe_confirmacao", status: "confirmar_d3" }),
      evento({ id: "scheduled_message-d", source: "scheduled_message", status: "scheduled" }),
      evento({ id: "google-e", source: "google", status: "confirmed" }),
    ]);
    expect(r).toEqual({ compareceu: 1, naoCompareceu: 0, semRegistro: 0 });
  });

  it("lista vazia devolve tudo zero, sem explodir", () => {
    expect(resumirComparecimento([])).toEqual({
      compareceu: 0,
      naoCompareceu: 0,
      semRegistro: 0,
    });
  });

  it("status desconhecido conta como sem registro, nunca como comparecido", () => {
    const r = resumirComparecimento([evento({ status: "algo_novo_do_futuro" })]);
    expect(r.semRegistro).toBe(1);
    expect(r.compareceu).toBe(0);
  });
});

describe("'concluído' de outra fonte NÃO é 'compareceu'", () => {
  it("follow-up concluído não vira comparecimento", () => {
    // A RPC fabrica `completed` para follow_up a partir de `completed_at`.
    // Sem a guarda por fonte, todo follow-up concluído ganhava ✓ verde.
    const fu = evento({
      id: "follow_up-1",
      source: "follow_up",
      eventType: "follow_up",
      status: "completed",
    });
    expect(outcomeOf(fu)).toBeNull();
    expect(resumirComparecimento([fu]).compareceu).toBe(0);
  });

  it("etapa de kanban 'compareceu' não vaza como resultado desta tela", () => {
    const pc = evento({
      id: "pipe_confirmacao-1",
      source: "pipe_confirmacao",
      status: "compareceu",
    });
    expect(outcomeOf(pc)).toBeNull();
  });

  it("mensagem agendada e Google nunca têm resultado", () => {
    expect(outcomeOf(evento({ source: "scheduled_message", status: "completed" }))).toBeNull();
    expect(outcomeOf(evento({ source: "google", status: "completed" }))).toBeNull();
  });
});
