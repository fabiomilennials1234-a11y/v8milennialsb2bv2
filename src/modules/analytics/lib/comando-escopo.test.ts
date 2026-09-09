import { describe, it, expect } from "vitest";
import {
  escopoDoUsuario,
  linhaVisivel,
  eventoDaAgendaEhMeu,
  eventoDaAgendaVisivel,
} from "./comando-escopo";

const EU = "tm-eu";
const OUTRO = "tm-outro";

describe("escopoDoUsuario", () => {
  it("admin vê tudo, o resto vê o próprio", () => {
    expect(escopoDoUsuario(true)).toBe("tudo");
    expect(escopoDoUsuario(false)).toBe("meu");
  });

  it("nasce fechado enquanto a identidade não resolveu", () => {
    // `useIdentity` devolve `isAdmin: false` durante o loading. O escopo tem de
    // nascer "meu": abrir e encolher mostraria dado alheio a quem não podia,
    // mesmo que por meio segundo.
    expect(escopoDoUsuario(false)).toBe("meu");
  });
});

describe("linhaVisivel — a regra dos 3 blocos", () => {
  it("escopo 'tudo' não esconde nada", () => {
    expect(linhaVisivel(OUTRO, EU, "tudo")).toBe(true);
    expect(linhaVisivel(null, EU, "tudo")).toBe(true);
  });

  it("no escopo 'meu', a minha linha aparece", () => {
    expect(linhaVisivel(EU, EU, "meu")).toBe(true);
  });

  it("no escopo 'meu', a linha de OUTRO some — é o ponto do pedido", () => {
    expect(linhaVisivel(OUTRO, EU, "meu")).toBe(false);
  });

  it("linha SEM DONO aparece para todo mundo", () => {
    // Não é generosidade, é medição: no PROD 61% das reuniões de confirmação,
    // 21% dos follow-ups e 40% das conversas não têm responsável. Escondê-las
    // apagaria a maior parte da operação da tela do vendedor — e registro órfão
    // não é "dado de outro usuário", que é o que o pedido manda proteger.
    expect(linhaVisivel(null, EU, "meu")).toBe(true);
    expect(linhaVisivel(undefined, EU, "meu")).toBe(true);
    expect(linhaVisivel("", EU, "meu")).toBe(true);
  });

  it("sem saber quem eu sou, só passa o que não é de ninguém", () => {
    // `meuTeamMemberId` é null para master e gestor (id virtual). Na prática
    // eles são sempre admin e caem no ramo 'tudo'; se algum dia um deles cair
    // aqui, o comportamento seguro é não vazar linha de dono conhecido.
    expect(linhaVisivel(OUTRO, null, "meu")).toBe(false);
    expect(linhaVisivel(null, null, "meu")).toBe(true);
  });
});

describe("agenda — os DOIS espaços de id", () => {
  // 🔴 `created_by` mistura auth.users.id (source=meeting) com team_members.id
  // (as outras 4). Comparar contra um único id devolve resultado silenciosamente
  // errado — some metade da agenda sem erro nenhum. Estes testes travam isso.
  const MEU_TM = "tm-eu";
  const MEU_UID = "uid-eu";

  it("source=meeting compara contra auth.users.id, NÃO contra team_members.id", () => {
    expect(
      eventoDaAgendaEhMeu({ source: "meeting", created_by: MEU_UID }, MEU_TM, MEU_UID),
    ).toBe(true);
    // O mesmo id, no espaço errado, não pode casar.
    expect(
      eventoDaAgendaEhMeu({ source: "meeting", created_by: MEU_TM }, MEU_TM, MEU_UID),
    ).toBe(false);
  });

  it.each(["follow_up", "scheduled_message", "pipe_confirmacao", "meeting_event"])(
    "source=%s compara contra team_members.id",
    (source) => {
      expect(
        eventoDaAgendaEhMeu({ source, created_by: MEU_TM }, MEU_TM, MEU_UID),
      ).toBe(true);
      expect(
        eventoDaAgendaEhMeu({ source, created_by: MEU_UID }, MEU_TM, MEU_UID),
      ).toBe(false);
    },
  );

  it("meeting_event existe — são CINCO fontes no PROD, não quatro", () => {
    // A quinta entrou na RPC em 2026-07-30 e o tipo do front nunca soube.
    // São 836 linhas no PROD; tratá-la como fonte desconhecida a esconderia.
    expect(
      eventoDaAgendaVisivel(
        { source: "meeting_event", created_by: MEU_TM },
        MEU_TM,
        MEU_UID,
        "meu",
      ),
    ).toBe(true);
  });

  it("compromisso sem dono aparece; o de outro não", () => {
    expect(
      eventoDaAgendaVisivel(
        { source: "pipe_confirmacao", created_by: null },
        MEU_TM,
        MEU_UID,
        "meu",
      ),
    ).toBe(true);
    expect(
      eventoDaAgendaVisivel(
        { source: "pipe_confirmacao", created_by: OUTRO },
        MEU_TM,
        MEU_UID,
        "meu",
      ),
    ).toBe(false);
  });

  it("admin vê o de todo mundo", () => {
    expect(
      eventoDaAgendaVisivel(
        { source: "meeting", created_by: "uid-outro" },
        MEU_TM,
        MEU_UID,
        "tudo",
      ),
    ).toBe(true);
  });
});
