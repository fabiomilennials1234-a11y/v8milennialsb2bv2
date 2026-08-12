/**
 * A decisão do webhook do gateway (SCRUM-287).
 *
 * As três asserções que mais importam, e o motivo de cada uma:
 *
 *  - PAGO é CONFIRMED **ou** RECEIVED. No cartão o RECEIVED chega 32 dias
 *    depois; no Pix o CONFIRMED nem existe. Errar aqui aparece como cliente
 *    pagando e não recebendo acesso — e demora um mês para alguém notar.
 *  - O estado NUNCA REBAIXA. A ordem de entrega só é garantida em
 *    SEQUENTIALLY; fora dele o RECEIVED pode chegar antes do CONFIRMED.
 *  - Tipo DESCONHECIDO é absorvido. Recusar pausaria a fila do provedor e
 *    derrubaria o recebimento de toda a receita, não só daquele evento.
 */

import { describe, it, expect } from "vitest";
import {
  decidir,
  proximoStatus,
  deveProvisionar,
} from "../../supabase/functions/asaas-webhook/decide.ts";

const evento = (tipo: string, extra: Record<string, unknown> = {}) => ({
  id: "evt_8f2c1a9b&c3d4e5f6",
  event: tipo,
  payment: {
    id: "pay_000001",
    subscription: "sub_000001",
    value: 199.9,
    billingType: "PIX",
    ...extra,
  },
});

describe("asaas-webhook — o que libera acesso", () => {
  it("PAYMENT_CONFIRMED provisiona — senão o cliente de PIX nunca seria liberado", () => {
    const d = decidir(evento("PAYMENT_CONFIRMED"));
    expect(d.status).toBe("confirmed");
    expect(d.provisiona).toBe(true);
    expect(d.registro).toBe("applied");
  });

  it("PAYMENT_RECEIVED provisiona — senão o cliente de CARTÃO esperaria 32 dias", () => {
    const d = decidir(evento("PAYMENT_RECEIVED"));
    expect(d.status).toBe("received");
    expect(d.provisiona).toBe(true);
  });

  it.each([
    ["PAYMENT_CREATED", "pending"],
    ["PAYMENT_OVERDUE", "overdue"],
    ["PAYMENT_DELETED", "cancelled"],
    ["PAYMENT_REFUNDED", "refunded"],
    ["PAYMENT_CHARGEBACK_REQUESTED", "refunded"],
  ])("%s NÃO provisiona (vira %s)", (tipo, esperado) => {
    const d = decidir(evento(tipo));
    expect(d.status).toBe(esperado);
    expect(d.provisiona).toBe(false);
  });
});

describe("asaas-webhook — o tipo desconhecido não pode derrubar a fila", () => {
  it("absorve tipo que não existe no mapa, com registro unknown_type", () => {
    const d = decidir(evento("PAYMENT_ALGO_QUE_A_ASAAS_INVENTOU_ONTEM"));
    expect(d.usavel).toBe(true);
    expect(d.status).toBeNull();
    expect(d.provisiona).toBe(false);
    expect(d.registro).toBe("unknown_type");
  });

  it("evento SEM id não é gravável — mas continua sendo um caso tratado, não uma exceção", () => {
    // Sem `evt_…` não há chave de idempotência, e sem ela a re-entrega viraria
    // linha duplicada no histórico financeiro. Recusa a gravar; quem chama
    // ainda responde 200, porque a fila não pode pausar por isto.
    const d = decidir({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1" } });
    expect(d.usavel).toBe(false);
    expect(d.eventId).toBeNull();
  });
});

describe("asaas-webhook — a escada de estado só sobe", () => {
  it("CONFIRMED atrasado NÃO rebaixa quem já está RECEIVED", () => {
    // O caso real: NON_SEQUENTIALLY entrega fora de ordem. Sem esta regra, a
    // tela diria "aguardando pagamento" para quem já pagou.
    expect(proximoStatus("received", "confirmed")).toBe("received");
  });

  it("RECEIVED sobe em cima de CONFIRMED", () => {
    expect(proximoStatus("confirmed", "received")).toBe("received");
  });

  it("sem estado anterior, o novo vale", () => {
    expect(proximoStatus(null, "pending")).toBe("pending");
  });

  it("estorno sobrepõe pagamento — é o único que anda para trás no dinheiro e para frente no tempo", () => {
    expect(proximoStatus("received", "refunded")).toBe("refunded");
  });

  it("overdue não rebaixa pagamento confirmado", () => {
    expect(proximoStatus("confirmed", "overdue")).toBe("confirmed");
  });
});

describe("asaas-webhook — provisionar é uma vez só", () => {
  it("o par CONFIRMED→RECEIVED do cartão provisiona UMA vez", () => {
    expect(deveProvisionar(null, "confirmed")).toBe(true);
    // Segundo evento da MESMA cobrança, 32 dias depois: não reprovisiona.
    expect(deveProvisionar("confirmed", "received")).toBe(false);
  });

  it("o PIX provisiona no RECEIVED, que é o primeiro que ele emite", () => {
    expect(deveProvisionar(null, "received")).toBe(true);
  });

  it("estado que não libera acesso nunca provisiona", () => {
    expect(deveProvisionar(null, "overdue")).toBe(false);
    expect(deveProvisionar(null, "refunded")).toBe(false);
  });
});

describe("asaas-webhook — o que o evento carrega para o histórico", () => {
  it("colhe fatura, recibo, forma de pagamento e a data do pagamento", () => {
    const d = decidir(evento("PAYMENT_RECEIVED", {
      invoiceUrl: "https://asaas.example/i/abc",
      transactionReceiptUrl: "https://asaas.example/r/abc",
      billingType: "CREDIT_CARD",
      confirmedDate: "2026-08-11",
    }));

    expect(d.invoiceUrl).toBe("https://asaas.example/i/abc");
    expect(d.receiptUrl).toBe("https://asaas.example/r/abc");
    expect(d.billingType).toBe("CREDIT_CARD");
    expect(d.paidAt).toBe("2026-08-11");
    expect(d.paymentId).toBe("pay_000001");
    expect(d.subscriptionId).toBe("sub_000001");
  });

  it("campo ausente vira nulo, não string vazia", () => {
    const d = decidir({ id: "evt_x", event: "PAYMENT_RECEIVED", payment: null });
    expect(d.paymentId).toBeNull();
    expect(d.invoiceUrl).toBeNull();
    expect(d.paidAt).toBeNull();
  });
});
