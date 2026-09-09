import { describe, it, expect } from "vitest";

import { decidirEntrega, type ContextoDeEntrega } from "./decisao-de-entrega";
import { resolverPreferencias } from "./preferencias-de-aviso";
import type { Aviso } from "./aviso-stream";

const AGORA = new Date("2026-08-31T17:00:00.000Z").getTime();

function aviso(tipo: string, over: Partial<Aviso> = {}): Aviso {
  return {
    id: "aviso-1",
    organization_id: "org",
    user_id: "user",
    type: tipo,
    title: "Marcos Andrade",
    description: null,
    link: null,
    lead_id: "lead-1",
    entity_id: null,
    group_key: `msg:${over.lead_id ?? "lead-1"}`,
    event_count: 1,
    last_event_at: new Date(AGORA).toISOString(),
    created_at: new Date(AGORA).toISOString(),
    read_at: null,
    ...over,
  };
}

function contexto(over: Partial<ContextoDeEntrega> = {}): ContextoDeEntrega {
  return {
    preferencias: resolverPreferencias(null),
    abaVisivel: true,
    conversaAbertaLeadId: null,
    ultimoSomPorChave: {},
    horaLocal: 14,
    agora: AGORA,
    ...over,
  };
}

describe("decisão de entrega", () => {
  it("Aviso novo toca o timbre do seu tipo", () => {
    expect(decidirEntrega(aviso("lead_message"), "INSERT", contexto()).som).toBe("mensagem");
    expect(decidirEntrega(aviso("lead_new"), "INSERT", contexto()).som).toBe("lead");
    expect(decidirEntrega(aviso("meeting_booked"), "INSERT", contexto()).som).toBe("reuniao");
    expect(decidirEntrega(aviso("workflow_alert"), "INSERT", contexto()).som).toBe("erro");
    expect(decidirEntrega(aviso("um_tipo_novo"), "INSERT", contexto()).som).toBe("sistema");
  });

  it("a rajada toca uma vez: o repique dentro de 60s cala", () => {
    const conversa = aviso("lead_message");
    const ctx = contexto({ ultimoSomPorChave: { "msg:lead-1": AGORA - 20_000 } });

    expect(decidirEntrega(conversa, "UPDATE", ctx).motivo).toBe("repique-recente");
    expect(decidirEntrega(conversa, "UPDATE", ctx).som).toBeNull();
  });

  it("o lead que voltou a falar depois de um tempo toca de novo", () => {
    const conversa = aviso("lead_message");
    const ctx = contexto({ ultimoSomPorChave: { "msg:lead-1": AGORA - 90_000 } });

    expect(decidirEntrega(conversa, "UPDATE", ctx).som).toBe("mensagem");
  });

  it("nada toca pela conversa que já está aberta na tela", () => {
    const decisao = decidirEntrega(
      aviso("lead_message"),
      "INSERT",
      contexto({ conversaAbertaLeadId: "lead-1" }),
    );

    expect(decisao).toEqual({ som: null, cartao: false, motivo: "conversa-aberta" });
  });

  it("o horário silencioso cala tudo, menos automação parada", () => {
    const preferencias = resolverPreferencias({ quiet_hours_start: 19, quiet_hours_end: 8 });
    const madrugada = contexto({ preferencias, horaLocal: 2 });

    expect(decidirEntrega(aviso("lead_message"), "INSERT", madrugada).motivo).toBe(
      "horario-silencioso",
    );
    expect(decidirEntrega(aviso("workflow_alert"), "INSERT", madrugada).som).toBe("erro");
  });

  it("silêncio que cruza a meia-noite vale nas duas metades da noite", () => {
    const preferencias = resolverPreferencias({ quiet_hours_start: 19, quiet_hours_end: 8 });

    const antesDaMeiaNoite = contexto({ preferencias, horaLocal: 22 });
    const depoisDaMeiaNoite = contexto({ preferencias, horaLocal: 3 });
    const expediente = contexto({ preferencias, horaLocal: 10 });

    expect(decidirEntrega(aviso("lead_new"), "INSERT", antesDaMeiaNoite).som).toBeNull();
    expect(decidirEntrega(aviso("lead_new"), "INSERT", depoisDaMeiaNoite).som).toBeNull();
    expect(decidirEntrega(aviso("lead_new"), "INSERT", expediente).som).toBe("lead");
  });

  it("som mestre desligado cala tudo, inclusive automação parada", () => {
    const preferencias = resolverPreferencias({ sound_enabled: false });

    const decisao = decidirEntrega(aviso("workflow_alert"), "INSERT", contexto({ preferencias }));

    expect(decisao.som).toBeNull();
    expect(decisao.motivo).toBe("som-desligado");
  });

  it("aba em segundo plano continua ouvindo — quem está no Excel precisa ser chamado", () => {
    const decisao = decidirEntrega(
      aviso("lead_message"),
      "INSERT",
      contexto({ abaVisivel: false }),
    );

    expect(decisao.som).toBe("mensagem");
  });

  it("cartão só para o que exige reação em minutos; reunião fica no sino", () => {
    expect(decidirEntrega(aviso("lead_message"), "INSERT", contexto()).cartao).toBe(true);
    expect(decidirEntrega(aviso("workflow_alert"), "INSERT", contexto()).cartao).toBe(true);
    expect(decidirEntrega(aviso("meeting_booked"), "INSERT", contexto()).cartao).toBe(false);
    expect(decidirEntrega(aviso("follow_up_overdue"), "INSERT", contexto()).cartao).toBe(false);
  });

  it("tipo silenciado nas preferências não toca, mas ainda pode aparecer", () => {
    const preferencias = resolverPreferencias({
      overrides: { workflow_alert: { som: false } },
    });

    const decisao = decidirEntrega(aviso("workflow_alert"), "INSERT", contexto({ preferencias }));

    expect(decisao.som).toBeNull();
    expect(decisao.motivo).toBe("tipo-sem-som");
    expect(decisao.cartao).toBe(true);
  });
});
