/**
 * O card do Negócio lê a reunião que a Agenda marcou (S6 — leitor do Negócio).
 *
 * ── O DEFEITO QUE ISTO TRAVA ──────────────────────────────────────────────
 * Medido em prod em 03/09/2026: a Agenda gravava a reunião em `public.meetings`
 * e o card do Negócio lia `pipeline_entries.metadata.meeting_date`. Não havia
 * fio entre as duas — marcar reunião na Agenda NUNCA aparecia no card. O S6
 * põe um gatilho de espelho projetando `meetings` dentro do metadata; este
 * arquivo cobre o lado que LÊ.
 *
 * ── POR QUE OS TRÊS CASOS, E NÃO SÓ O FELIZ ───────────────────────────────
 * As duas fontes existem ao mesmo tempo e vão continuar existindo (os
 * escritores do funil não são aposentados no S6). Então há três mundos, e cada
 * um tem uma regressão própria a evitar:
 *
 *   1. **só metadata** — 93 negócios de prod estão nesse estado hoje. Se o
 *      leitor passasse a exigir linha em `meetings`, a reunião SUMIRIA da tela
 *      deles. É a regressão mais cara da fatia;
 *   2. **só meetings** — reunião da Agenda cuja projeção ainda não chegou. Sem
 *      queda, o card fica cego para uma reunião que existe;
 *   3. **os dois** — o caso normal depois do espelho. A DATA tem de sair da
 *      projeção (é onde as duas origens se encontram) e o DESFECHO de
 *      `meetings`, que é o único que sabe se aconteceu.
 */
import { describe, it, expect } from "vitest";

import {
  escolherReuniaoDaAgenda,
  montarReuniaoDoNegocio,
  situacaoDaReuniao,
  type ReuniaoDaAgenda,
} from "@/modules/leads/components/deal-card/reuniao-do-negocio";

/** 03/09/2026 12:00Z — o "agora" de todo caso, para o teste não depender do relógio. */
const AGORA = new Date("2026-09-03T12:00:00.000Z").getTime();

const FUTURA: ReuniaoDaAgenda = {
  id: "80ebb72c-b595-423b-b138-4883909d0af7",
  start_at: "2026-09-07T14:00:00.000Z",
  status: "scheduled",
  meet_link: "https://meet.google.com/abc-defg-hij",
};

const PASSADA: ReuniaoDaAgenda = {
  id: "11111111-1111-1111-1111-111111111111",
  start_at: "2026-08-20T13:00:00.000Z",
  status: "completed",
  meet_link: null,
};

describe("reunião do Negócio — de onde vem cada campo", () => {
  it("1) SÓ metadata: a reunião continua na tela, sem linha em `meetings`", () => {
    const r = montarReuniaoDoNegocio(
      { meeting_date: "2026-09-10T16:00:00.000Z", is_confirmed: true, meet_link: "https://x.y/z" },
      [],
      AGORA,
    );

    expect(r).toEqual({
      data: "2026-09-10T16:00:00.000Z",
      confirmada: true,
      link: "https://x.y/z",
      // Sem linha em `meetings` NINGUÉM pôde marcar desfecho pela Agenda — e é
      // esse par de nulos que faz o card renderizar igual ao de antes do S6.
      status: null,
      meetingId: null,
    });
  });

  it("2) SÓ meetings: a reunião da Agenda aparece mesmo sem projeção no metadata", () => {
    const r = montarReuniaoDoNegocio({}, [FUTURA], AGORA);

    expect(r?.data).toBe(FUTURA.start_at);
    expect(r?.meetingId).toBe(FUTURA.id);
    expect(r?.status).toBe("scheduled");
    expect(r?.link).toBe(FUTURA.meet_link);
  });

  it("3) OS DOIS: a data sai da projeção, o desfecho sai de `meetings`", () => {
    /**
     * A projeção diverge do `start_at` de propósito: é o caso em que alguém
     * remarcou pelo card do funil, que continua escrevendo direto no metadata.
     * Quem manda na data é a projeção — precedência invertida em relação à
     * leitura ingênua, e é ela que evita "editei no card e não mudou".
     */
    const r = montarReuniaoDoNegocio(
      {
        meeting_date: "2026-09-08T18:30:00.000Z",
        is_confirmed: false,
        agenda_espelho: { meeting_id: FUTURA.id, rev: "r1", start_at: FUTURA.start_at },
      },
      [FUTURA],
      AGORA,
    );

    expect(r?.data).toBe("2026-09-08T18:30:00.000Z");
    expect(r?.confirmada).toBe(false);
    expect(r?.status).toBe("scheduled");
    expect(r?.meetingId).toBe(FUTURA.id);
  });

  it("sem data em lugar nenhum, não há bloco de reunião", () => {
    expect(montarReuniaoDoNegocio({}, [], AGORA)).toBeNull();
  });

  it("`meetings` nunca sobrepõe a data que já está na projeção", () => {
    const r = montarReuniaoDoNegocio(
      { meeting_date: "2026-09-01T09:00:00.000Z" },
      [FUTURA],
      AGORA,
    );
    expect(r?.data).toBe("2026-09-01T09:00:00.000Z");
  });
});

describe("qual das reuniões do negócio o card está mostrando", () => {
  it("o carimbo do espelho decide, mesmo havendo outra mais próxima", () => {
    const escolhida = escolherReuniaoDaAgenda([FUTURA, PASSADA], PASSADA.id, AGORA);
    expect(escolhida?.id).toBe(PASSADA.id);
  });

  it("sem carimbo, a PRÓXIMA que ainda vai acontecer", () => {
    const escolhida = escolherReuniaoDaAgenda([PASSADA, FUTURA], null, AGORA);
    expect(escolhida?.id).toBe(FUTURA.id);
  });

  it("sem carimbo e sem futura, a mais recente que já passou", () => {
    const antiga: ReuniaoDaAgenda = { ...PASSADA, id: "antiga", start_at: "2026-01-04T10:00:00.000Z" };
    const escolhida = escolherReuniaoDaAgenda([antiga, PASSADA], null, AGORA);
    expect(escolhida?.id).toBe(PASSADA.id);
  });
});

describe("o que o card DIZ sobre a reunião", () => {
  const base = { data: "2026-09-07T14:00:00.000Z", confirmada: false, link: null };

  it("reunião da Agenda é anunciada como tal", () => {
    const s = situacaoDaReuniao({ ...base, status: "scheduled", meetingId: "m1" }, AGORA);
    expect(s.daAgenda).toBe(true);
    expect(s.passou).toBe(false);
  });

  it("data digitada no funil NÃO se anuncia como Agenda", () => {
    const s = situacaoDaReuniao({ ...base, status: null, meetingId: null }, AGORA);
    expect(s.daAgenda).toBe(false);
    expect(s.rotulo).toBe("sem confirmação");
  });

  it("passada e sem desfecho é a única que acende — é o no-show que ninguém registrou", () => {
    const s = situacaoDaReuniao(
      { data: "2026-08-20T13:00:00.000Z", confirmada: true, link: null, status: "scheduled", meetingId: "m1" },
      AGORA,
    );
    expect(s.passou).toBe(true);
    expect(s.tom).toBe("alerta");
    expect(s.rotulo).toBe("já passou, sem desfecho");
  });

  it("desfecho marcado na Agenda vira o rótulo da linha", () => {
    const passada = { data: PASSADA.start_at, confirmada: true, link: null, meetingId: PASSADA.id };
    expect(situacaoDaReuniao({ ...passada, status: "completed" }, AGORA).rotulo).toBe("compareceu");
    expect(situacaoDaReuniao({ ...passada, status: "no_show" }, AGORA).rotulo).toBe(
      "não compareceu",
    );
    expect(situacaoDaReuniao({ ...passada, status: "cancelled" }, AGORA).rotulo).toBe("cancelada");
  });
});
