/**
 * Escopo de visibilidade e estado dos compromissos da Agenda.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * A tela "Atividades" recorta o que cada pessoa vê: usuário comum enxerga só os
 * próprios compromissos, admin enxerga os de todo mundo. O recorte parece um
 * `filter(e => e.createdBy === userId)` de uma linha — e essa linha estaria
 * errada.
 *
 * `get_agenda_events` une CINCO fontes e devolve a coluna `created_by` com DOIS
 * tipos de id diferentes conforme a linha:
 *
 *   meetings                 → m.created_by                       JOIN tm.user_id  → auth.users.id
 *   follow_ups               → fu.assigned_to                     JOIN tm2.id      → team_members.id
 *   scheduled_user_messages  → sm.created_by                      JOIN tm3.id      → team_members.id
 *   pipe_confirmacao         → COALESCE(pc.closer_id, pc.sdr_id)  JOIN tm.id       → team_members.id
 *   meeting_events           → me.pre_sale_responsible_id         JOIN tm5.id      → team_members.id
 *
 * ⚠️ Este cabeçalho dizia "QUATRO fontes / baseline de prod" e ficou defasado por
 * quase um mês: a 5ª (`meeting_events`, o funil mergeado) entrou no PROD à mão
 * em 2026-07-30 e só foi versionada em `20270901000000`. A contagem certa está
 * travada por `tests/unit/agenda-fontes-contract.test.ts`, que lê a definição
 * vigente em vez de confiar em prosa como esta.
 *
 * Comparar contra uma chave só casa UMA das cinco fontes e some, em silêncio,
 * com os follow-ups e as confirmações da própria pessoa. Daí `buildOwnerIdentity`
 * devolver um CONJUNTO de identidades, e não um id.
 *
 * O mesmo vale para "Finalizadas": `status` não é estado de conclusão nas cinco
 * fontes. `pipe_confirmacao.status` é a chave da etapa do kanban
 * (`reuniao_marcada`, `confirmar_d3`, `compareceu`, `perdido`), e
 * `scheduled_user_messages` já entra pré-filtrada a `('scheduled','sending')`
 * pela própria RPC — nunca pode cair em "Finalizadas".
 */

import { describe, expect, it } from "vitest";

import type { UnifiedEvent } from "@/modules/engagement/components/agenda/agenda-helpers";
import {
  buildOwnerIdentity,
  initialsOf,
  isFinishedEvent,
  isOwnedBy,
  matchesStatusFilter,
  rawEventId,
} from "@/modules/engagement/components/agenda/agenda-helpers";

const USER_ID = "11111111-1111-1111-1111-111111111111"; // auth.users.id
const TEAM_MEMBER_ID = "22222222-2222-2222-2222-222222222222"; // team_members.id
const OUTRO = "99999999-9999-9999-9999-999999999999";

function evento(over: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    id: "meeting-1",
    title: "Reunião",
    start: new Date("2026-08-24T13:00:00Z"),
    end: new Date("2026-08-24T14:00:00Z"),
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

describe("escopo de visibilidade da Agenda", () => {
  const eu = buildOwnerIdentity(USER_ID, TEAM_MEMBER_ID);

  it("casa reunião, cujo created_by é o id de AUTH", () => {
    const e = evento({ source: "meeting", createdBy: USER_ID });
    expect(isOwnedBy(e, eu)).toBe(true);
  });

  it("casa follow-up, confirmação e mensagem agendada, cujo created_by é o id de TEAM_MEMBER", () => {
    for (const source of [
      "follow_up",
      "pipe_confirmacao",
      "scheduled_message",
    ] as const) {
      const e = evento({ source, createdBy: TEAM_MEMBER_ID });
      expect(isOwnedBy(e, eu), source).toBe(true);
    }
  });

  it("uma chave só NÃO bastaria — é a regressão que este teste existe para pegar", () => {
    const soAuth = buildOwnerIdentity(USER_ID, null);
    const followUpMeu = evento({ source: "follow_up", createdBy: TEAM_MEMBER_ID });
    expect(isOwnedBy(followUpMeu, soAuth)).toBe(false);
    expect(isOwnedBy(followUpMeu, eu)).toBe(true);
  });

  it("não casa compromisso de outra pessoa", () => {
    expect(isOwnedBy(evento({ createdBy: OUTRO }), eu)).toBe(false);
  });

  it("compromisso SEM dono continua visível — esconder apagaria o que eu mesmo criei", () => {
    // `follow_ups.assigned_to` é nulável e a UI grava follow-up sem
    // responsável; em `pipe_confirmacao` o dono é COALESCE(closer, sdr), nulo
    // em boa parte da base. Compromisso de ninguém não é "de outra pessoa".
    expect(isOwnedBy(evento({ createdBy: null }), eu)).toBe(true);
    expect(isOwnedBy(evento({ source: "follow_up", createdBy: null }), eu)).toBe(true);
    expect(
      isOwnedBy(evento({ source: "pipe_confirmacao", createdBy: null }), eu),
    ).toBe(true);
  });

  it("reunião marcada POR outra pessoa COM você entra pela lista de participações", () => {
    const convite = evento({
      id: "meeting-abc-123",
      source: "meeting",
      createdBy: OUTRO,
    });
    expect(isOwnedBy(convite, eu)).toBe(false);
    expect(isOwnedBy(convite, eu, new Set(["abc-123"]))).toBe(true);
  });

  it("evento do Google entra sempre: é o calendário que a própria pessoa conectou", () => {
    const g = evento({ source: "google", createdBy: null });
    expect(isOwnedBy(g, eu)).toBe(true);
  });

  it("identidade vazia (sessão ainda carregando) não abre o que tem dono", () => {
    const nenhuma = buildOwnerIdentity(null, null);
    expect(nenhuma.size).toBe(0);
    expect(isOwnedBy(evento({ createdBy: USER_ID }), nenhuma)).toBe(false);
  });
});

describe("rawEventId", () => {
  it("tira o prefixo de fonte sem comer os hifens do uuid", () => {
    expect(rawEventId(evento({ id: "meeting-abc-123-def" }))).toBe("abc-123-def");
    expect(
      rawEventId(evento({ source: "follow_up", id: "follow_up-abc-123" })),
    ).toBe("abc-123");
    expect(
      rawEventId(evento({ source: "pipe_confirmacao", id: "pipe_confirmacao-xyz" })),
    ).toBe("xyz");
  });

  it("id que não casa com a fonte volta inteiro, em vez de ser mutilado", () => {
    expect(rawEventId(evento({ source: "meeting", id: "follow_up-abc" }))).toBe(
      "follow_up-abc",
    );
  });
});

describe("estado do compromisso (pendente × finalizado)", () => {
  it("reconhece os terminais de meetings", () => {
    for (const status of ["completed", "cancelled", "no_show"]) {
      expect(isFinishedEvent(evento({ status })), status).toBe(true);
    }
    expect(isFinishedEvent(evento({ status: "scheduled" }))).toBe(false);
  });

  it("reconhece os terminais de pipe_confirmacao, que são chaves de ETAPA", () => {
    const finalizadas = ["compareceu", "perdido"];
    const pendentes = [
      "reuniao_marcada",
      "confirmar_d5",
      "confirmar_d3",
      "confirmar_d1",
      "confirmacao_no_dia",
      "remarcar",
    ];
    for (const status of finalizadas) {
      expect(
        isFinishedEvent(evento({ source: "pipe_confirmacao", status })),
        status,
      ).toBe(true);
    }
    for (const status of pendentes) {
      expect(
        isFinishedEvent(evento({ source: "pipe_confirmacao", status })),
        status,
      ).toBe(false);
    }
  });

  it("status desconhecido conta como pendente — nada some da aba de trabalho", () => {
    expect(isFinishedEvent(evento({ status: "algo_novo_do_futuro" }))).toBe(false);
    expect(isFinishedEvent(evento({ status: "" }))).toBe(false);
  });

  it("mensagem agendada nunca finaliza: a RPC só devolve scheduled/sending", () => {
    for (const status of ["scheduled", "sending"]) {
      expect(
        isFinishedEvent(evento({ source: "scheduled_message", status })),
      ).toBe(false);
    }
  });

  it("a aba 'Todas' não filtra nada", () => {
    expect(matchesStatusFilter(evento({ status: "completed" }), "all")).toBe(true);
    expect(matchesStatusFilter(evento({ status: "scheduled" }), "all")).toBe(true);
  });

  it("'Pendentes' e 'Finalizadas' são complementares", () => {
    const feito = evento({ status: "completed" });
    const aberto = evento({ status: "scheduled" });
    expect(matchesStatusFilter(feito, "done")).toBe(true);
    expect(matchesStatusFilter(feito, "pending")).toBe(false);
    expect(matchesStatusFilter(aberto, "done")).toBe(false);
    expect(matchesStatusFilter(aberto, "pending")).toBe(true);
  });
});

describe("iniciais do responsável", () => {
  it("usa o primeiro e o último nome", () => {
    expect(initialsOf("Lucas Martins")).toBe("LM");
    expect(initialsOf("Ana Paula de Souza")).toBe("AS");
  });

  it("aguenta nome único e vazio", () => {
    expect(initialsOf("Lucas")).toBe("L");
    expect(initialsOf("")).toBe("");
    expect(initialsOf(null)).toBe("");
    expect(initialsOf(undefined)).toBe("");
  });
});
