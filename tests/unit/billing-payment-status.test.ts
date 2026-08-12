/**
 * SCRUM-289, Fatia 8 — o estado de pagamento que a tela vê.
 *
 * As asserções que mandam são as de PRECEDÊNCIA. Cada uma delas descreve um
 * desfecho que já é conhecido do domínio e que, errado, aparece como cliente
 * pagando e não recebendo acesso — ou pior, como cliente pagando e a tela
 * dizendo que expirou.
 */

import { describe, it, expect } from "vitest";
import {
  resolverStatusDeTela,
  intervaloDePoll,
  ehTerminal,
  POLL_RAPIDO_MS,
  POLL_LENTO_MS,
} from "../../supabase/functions/billing-payment-status/status";

const AGORA = new Date("2026-08-12T12:00:00.000Z");
const DAQUI_A_UM_DIA = "2026-08-13T12:00:00.000Z";
const ONTEM = "2026-08-11T12:00:00.000Z";

function entrada(over: Partial<Parameters<typeof resolverStatusDeTela>[0]> = {}) {
  return {
    linkCode: "ok",
    expiresAt: DAQUI_A_UM_DIA,
    eventos: [],
    now: AGORA,
    ...over,
  };
}

describe("resolverStatusDeTela — o que a tela mostra", () => {
  it("sem evento nenhum é pending — é o único estado em que a página segue perguntando", () => {
    expect(resolverStatusDeTela(entrada())).toEqual({ state: "pending" });
  });

  it("PAYMENT_RECEIVED é paid — o caminho do Pix, que PULA o CONFIRMED", () => {
    const r = resolverStatusDeTela(entrada({
      eventos: [{ event_id: "evt_PAYMENT_RECEIVED", event_type: "PAYMENT_RECEIVED", paid_at: "2026-08-12T11:59:00.000Z" }],
    }));
    expect(r.state).toBe("paid");
    expect(r.paid_at).toBe("2026-08-12T11:59:00.000Z");
  });

  it("PAYMENT_CONFIRMED sozinho JÁ é paid — o cartão só recebe o RECEIVED 32 dias depois, e esperar por ele deixaria o cliente um mês sem acesso", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [{ event_id: "evt_PAYMENT_CONFIRMED", event_type: "PAYMENT_CONFIRMED" }],
    })).state).toBe("paid");
  });

  it("CONFIRMED que chega DEPOIS do RECEIVED não rebaixa — a escada só sobe, e a ordem de entrega não é garantida", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [
        { event_id: "evt_PAYMENT_RECEIVED", event_type: "PAYMENT_RECEIVED" },
        { event_id: "evt_PAYMENT_CONFIRMED", event_type: "PAYMENT_CONFIRMED" },
      ],
    })).state).toBe("paid");
  });

  it("PRECEDÊNCIA: pago vence VENCIDO — o cliente que paga o Pix nos últimos segundos não pode ver 'expirado' porque o webhook chegou depois do relógio", () => {
    expect(resolverStatusDeTela(entrada({
      linkCode: "link_expired",
      expiresAt: ONTEM,
      eventos: [{ event_id: "evt_PAYMENT_RECEIVED", event_type: "PAYMENT_RECEIVED" }],
    })).state).toBe("paid");
  });

  it("PRECEDÊNCIA: pago vence link REVOGADO — se o dinheiro entrou, revogar depois não desfaz o fato", () => {
    expect(resolverStatusDeTela(entrada({
      linkCode: "link_revoked",
      eventos: [{ event_id: "evt_PAYMENT_CONFIRMED", event_type: "PAYMENT_CONFIRMED" }],
    })).state).toBe("paid");
  });

  it("estorno é failed, NÃO paid — vem depois do pagamento e o substitui, então a tela tem que dizer que não deu", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [
        { event_id: "evt_PAYMENT_RECEIVED", event_type: "PAYMENT_RECEIVED" },
        { event_id: "evt_PAYMENT_REFUNDED", event_type: "PAYMENT_REFUNDED" },
      ],
    })).state).toBe("failed");
  });

  it("reprovado na análise de risco é failed", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [{ event_id: "evt_PAYMENT_REPROVED_BY_RISK_ANALYSIS", event_type: "PAYMENT_REPROVED_BY_RISK_ANALYSIS" }],
    })).state).toBe("failed");
  });

  it("OVERDUE do gateway NÃO fecha a proposta — quem decide vencimento aqui é o nosso expires_at, não o do provedor", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [{ event_id: "evt_PAYMENT_OVERDUE", event_type: "PAYMENT_OVERDUE" }],
    })).state).toBe("pending");
  });

  it("evento em análise de risco continua pending — o cliente ainda está esperando, e a página tem que continuar perguntando", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [{ event_id: "evt_PAYMENT_AWAITING_RISK_ANALYSIS", event_type: "PAYMENT_AWAITING_RISK_ANALYSIS" }],
    })).state).toBe("pending");
  });

  it("tipo DESCONHECIDO não derruba a tela nem inventa desfecho — absorve e segue pending", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [{ event_id: "evt_PAYMENT_INVENTADO_AMANHA", event_type: "PAYMENT_INVENTADO_AMANHA" }],
    })).state).toBe("pending");
  });

  it("link vencido pelo relógio, sem evento, é expired mesmo quando o código ainda diz ok — o relógio anda entre o resolve e a pergunta", () => {
    expect(resolverStatusDeTela(entrada({
      linkCode: "ok",
      expiresAt: ONTEM,
    })).state).toBe("expired");
  });

  it("proposta inexistente ou revogada é failed, não expired — expirar é relógio, estes dois são decisão de alguém", () => {
    expect(resolverStatusDeTela(entrada({ linkCode: "link_not_found" })).state).toBe("failed");
    expect(resolverStatusDeTela(entrada({ linkCode: "link_revoked" })).state).toBe("failed");
  });

  it("NENHUM estado da tela carrega vocabulário do gateway — confirmed e received não vazam para o navegador", () => {
    const estados = [
      resolverStatusDeTela(entrada({ eventos: [{ event_id: "evt_PAYMENT_CONFIRMED", event_type: "PAYMENT_CONFIRMED" }] })).state,
      resolverStatusDeTela(entrada({ eventos: [{ event_id: "evt_PAYMENT_RECEIVED", event_type: "PAYMENT_RECEIVED" }] })).state,
    ];
    expect(estados).toEqual(["paid", "paid"]);
    expect(estados).not.toContain("confirmed");
    expect(estados).not.toContain("received");
  });

  it("paid_at é o PRIMEIRO informado, não o último — é a hora em que o cliente pagou, e o par CONFIRMED/RECEIVED do cartão traz duas", () => {
    expect(resolverStatusDeTela(entrada({
      eventos: [
        { event_id: "evt_PAYMENT_RECEIVED", event_type: "PAYMENT_RECEIVED", paid_at: "2026-08-12T11:59:00.000Z" },
        { event_id: "evt_PAYMENT_CONFIRMED", event_type: "PAYMENT_CONFIRMED", paid_at: "2026-08-12T10:00:00.000Z" },
      ],
    })).paid_at).toBe("2026-08-12T10:00:00.000Z");
  });

  it("pago sem data informada continua paid, e sem inventar data", () => {
    const r = resolverStatusDeTela(entrada({ eventos: [{ event_id: "evt_PAYMENT_RECEIVED", event_type: "PAYMENT_RECEIVED" }] }));
    expect(r).toEqual({ state: "paid" });
  });
});

describe("orçamento de pergunta", () => {
  it("rápido nos primeiros 2 minutos, devagar depois", () => {
    expect(intervaloDePoll(0)).toBe(POLL_RAPIDO_MS);
    expect(intervaloDePoll(119_999)).toBe(POLL_RAPIDO_MS);
    expect(intervaloDePoll(120_000)).toBe(POLL_LENTO_MS);
  });

  it("só pending faz a página perguntar de novo — desfecho fechado gasta requisição do teto sem chance de mudar", () => {
    expect(ehTerminal("pending")).toBe(false);
    expect(ehTerminal("paid")).toBe(true);
    expect(ehTerminal("expired")).toBe(true);
    expect(ehTerminal("failed")).toBe(true);
  });
});
