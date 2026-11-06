// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHECKOUT_CONSENT_VERSION, COPY, cancellationText, consentText, declineMessage, emailError, formatMoney,
  maskTaxId, recurrenceText, taxIdError, taxIdTail, terminalCopy,
} from "@/modules/billing/components/checkout/checkout-copy";
import { RECURRING_CONSENT_VERSION } from "../../supabase/functions/billing-checkout-subscription/flow";
import * as statusModule from "../../supabase/functions/billing-payment-status/status";
import { POLL_FAST_MS, POLL_SLOW_MS, POLL_FAST_WINDOW_MS, statusPollDelay } from "@/modules/billing/hooks/useCheckoutStatus";

describe("autorização", () => {
  it("a versão da tela é a do servidor: bundle e backend amarrados", () => {
    expect(CHECKOUT_CONSENT_VERSION).toBe(RECURRING_CONSENT_VERSION);
  });

  it("diz valor, recorrência, automático e cancelamento; não pressupõe cartão já digitado", () => {
    const text = consentText(1078380, "semiannual");
    expect(text).toContain("R$ 10.783,80");
    expect(text).toContain("a cada 6 meses");
    expect(text).toContain("automática");
    expect(text).toContain("até o cancelamento");
    expect(text).not.toContain("neste cartão");
  });

  it("cancelamento cita a data quando existe", () => {
    expect(cancellationText("4 de maio de 2027")).toContain("em 4 de maio de 2027");
    expect(cancellationText(null)).not.toContain(" em ");
  });
});

describe("formatadores", () => {
  it("money recebe centavos aqui, reais lá dentro", () => {
    expect(formatMoney(199700)).toBe("R$ 1.997,00");
  });

  it("máscara progressiva vira CNPJ no 12º dígito e aceita colagem pontuada", () => {
    expect(maskTaxId("529982")).toBe("529.982");
    expect(maskTaxId("52998224725")).toBe("529.982.247-25");
    expect(maskTaxId("112223330001")).toBe("11.222.333/0001");
    expect(maskTaxId("11.222.333/0001-81")).toBe("11.222.333/0001-81");
    expect(maskTaxId("112223330001819999")).toBe("11.222.333/0001-81");
  });

  it("resto do documento: só tipo e 2 últimos", () => {
    expect(taxIdTail("11.222.333/0001-81")).toEqual({ kind: "CNPJ", tail: "81" });
    expect(taxIdTail("52998224725")).toEqual({ kind: "CPF", tail: "25" });
  });

  it("recorrência desconhecida é null, e a tela vira indisponível", () => {
    expect(recurrenceText("monthly")).toBe("todo mês");
    expect(recurrenceText("annual")).toBe("todo ano");
    expect(recurrenceText("quarterly")).toBeNull();
  });
});

describe("validação campo a campo", () => {
  it("vazio, tamanho errado e dígito errado têm mensagens distintas e nenhuma ecoa o valor", () => {
    expect(taxIdError("")).toBe("Informe o CNPJ ou o CPF.");
    expect(taxIdError("123")).toContain("14 dígitos");
    expect(taxIdError("11.222.333/0001-82")).toBe("Documento inválido. Confira os dígitos.");
    expect(taxIdError("11.222.333/0001-81")).toBeNull();
    expect(emailError("")).toBe("Informe o e-mail.");
    expect(emailError("a@b")).toBe("E-mail inválido. Confira o endereço.");
    expect(emailError("financeiro@riofix.com.br")).toBeNull();
    for (const v of ["11222333000182", "ninguem@"]) {
      expect(taxIdError(v) ?? "").not.toContain(v);
      expect(emailError(v) ?? "").not.toContain(v);
    }
  });
});

describe("recusa", () => {
  it("decline_code vence code, e não mapeado cai no genérico; nunca a mensagem crua", () => {
    expect(declineMessage("card_declined", "insufficient_funds", 19900)).toContain("limite disponível");
    expect(declineMessage("expired_card", undefined, 1)).toContain("vencido");
    expect(declineMessage("card_declined", "do_not_honor", 1)).toContain("O banco recusou");
    expect(declineMessage(undefined, undefined, 1)).toContain("Nada foi cobrado");
  });
});

describe("referência da autorização, por versão", () => {
  // Mudar uma palavra sem subir CHECKOUT_CONSENT_VERSION quebra aqui. Quem subir a versão
  // acrescenta a linha nova e mantém a anterior: é o registro do que cada versão disse.
  const REFERENCIA: Record<string, { consent: string; cancel: string }> = {
    "2026-11-04": {
      consent: "Autorizo a Torque CRM a cobrar R$\u00a010.783,80 hoje, no cartão que vou informar a seguir, e R$\u00a010.783,80 a cada 6 meses, de forma automática, até o cancelamento.",
      cancel: "Para cancelar, fale com o time do Torque antes da próxima cobrança, em 4 de maio de 2027. O acesso segue até o fim do período já pago.",
    },
  };
  it("o texto renderizado com valores fixos é o desta versão", () => {
    const ref = REFERENCIA[CHECKOUT_CONSENT_VERSION];
    expect(ref, "versão nova exige linha nova nesta referência").toBeDefined();
    expect(consentText(1078380, "semiannual")).toBe(ref!.consent);
    expect(cancellationText("4 de maio de 2027")).toBe(ref!.cancel);
  });
});

describe("terminais", () => {
  it("afirmação de que nada foi cobrado só onde há prova: recusado antes de criar objeto", () => {
    const ids = ["not_found", "expired", "revoked", "already_paid", "not_supported", "org_subscribed", "unavailable", "offline", "rate_limited", "stale_bundle", "resume_unknown"] as const;
    const afirmam = ids.filter((id) => /nada foi cobrado/i.test(terminalCopy(id, "Riofix").body));
    expect(afirmam).toEqual(["org_subscribed"]);
  });

  it("volta do banco sem poder conferir: não afirma nada e oferece tentar de novo", () => {
    const c = terminalCopy("resume_unknown", null);
    expect(c.title).toBe("Não conseguimos confirmar o pagamento");
    expect(c.action).toBe("retry");
    expect(c.body).toContain("antes de fazer outro pagamento");
  });

  it("F1: revogado não afirma que nada foi cobrado: o banco testa revogado antes de pago", () => {
    expect(terminalCopy("revoked", null).body).not.toMatch(/Nada foi cobrado/i);
  });

  it("nenhum diz Ops nem promete canal que não existe", () => {
    for (const id of ["not_found", "expired", "revoked", "already_paid", "not_supported", "org_subscribed", "unavailable", "offline", "rate_limited", "stale_bundle"] as const) {
      const c = terminalCopy(id, "Riofix");
      expect(`${c.title} ${c.body}`).not.toMatch(/Ops|Algo deu errado|recibo|nota fiscal|reembolso/i);
    }
  });
  it("sem nome, o T6 não fica com buraco", () => {
    expect(terminalCopy("org_subscribed", null).title).toBe("Sua empresa já tem uma assinatura em andamento");
  });
});

describe("orçamento de polling", () => {
  it("os números são os que dimensionam o teto do endpoint", () => {
    expect(POLL_FAST_MS).toBe(statusModule.POLL_RAPIDO_MS);
    expect(POLL_SLOW_MS).toBe(statusModule.POLL_LENTO_MS);
    expect(POLL_FAST_WINDOW_MS).toBe(statusModule.POLL_JANELA_RAPIDA_MS);
    for (const t of [0, 119_999, 120_000, 500_000]) expect(statusPollDelay(t)).toBe(statusModule.intervaloDePoll(t));
  });
});

describe("declineMessage", () => {
  it("default de recusa só serve para recusa: há texto próprio para não confirmado", () => {
    expect(COPY.card.unconfirmed).toContain("não cobra duas vezes");
    expect(COPY.card.unconfirmed).not.toMatch(/Nada foi cobrado|recusou/);
  });
});

describe("arquivos", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

  it("Composer não oferece organização nova nem Pix: o servidor recusaria", () => {
    const src = read("src/modules/identity/master/components/PaymentLinkComposer.tsx");
    expect(src).not.toContain('"new_org"');
    expect(src).not.toContain('value: "pix"');
    expect(src).toContain('const PAYMENT_METHOD = "credit_card"');
  });

  it("rota pública, sem abertura, com tema travado e a tag de boot igual", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/checkout/:token"');
    expect(app).toContain('forcedTheme={IS_CHECKOUT_ROUTE ? "dark" : undefined}');
    expect(read("src/modules/platform/components/layout/TorqueIntro.tsx")).toContain('"/checkout"');
    expect(read("index.html")).toContain("isCheckout");
  });

  it("App não carrega Stripe fora do chunk lazy; só a tela usa o pure", () => {
    expect(read("src/App.tsx")).not.toContain("@stripe/");
    expect(read("src/modules/billing/index.ts")).not.toMatch(/@stripe|CheckoutPage|components\/checkout|stripe-env/);
    expect(read("src/modules/billing/components/checkout/CheckoutScreen.tsx")).toContain('from "@stripe/stripe-js/pure"');
  });

  it("copy não contém slug de plano", () => {
    const src = readFileSync(resolve(__dirname, "../../src/modules/billing/components/checkout/checkout-copy.ts"), "utf8");
    expect(src).not.toMatch(/torque-(1\.0|2\.0|v8)/);
  });
});
