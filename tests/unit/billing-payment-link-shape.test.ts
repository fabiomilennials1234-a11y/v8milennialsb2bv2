/**
 * O recorte público do link de pagamento (SCRUM-289).
 *
 * A página é pública e a autorização é o conhecimento do token. Por isso o
 * teste que mais importa aqui é NEGATIVO: o que a resposta NÃO carrega.
 * `organization_id`, `link_id`, o `quote` cru e o eco do token ficaram de fora
 * por decisão do CTO, e uma lista branca só continua branca se alguém verificar.
 *
 * Os quatro estados são contrato fechado com o Fole: ele renderiza LAYOUT por
 * estado (ícone, ação, botão de voltar) e escreve a copy do lado dele. Renomear
 * qualquer um dos quatro quebra a tela em silêncio.
 */

import { describe, it, expect } from "vitest";
import {
  shapePublicLink,
  addMonthsUtc,
  PUBLIC_LINK_STATES,
} from "../../supabase/functions/billing-payment-link/shape.ts";

const AGORA = new Date("2026-08-11T18:00:00.000Z");

const QUOTE = {
  plan_id: "11111111-1111-4111-8111-111111111111",
  plan_name: "pro",
  billing_cycle: "semiannual",
  cycle_months: 6,
  seats: 5,
  subtotal_cents: 100_000,
  cycle_discount_cents: 10_000,
  coupon_discount_cents: 5_000,
  manual_discount_cents: 0,
  monthly_cents: 85_000,
  charge_cents: 510_000,
  coupon_id: "22222222-2222-4222-8222-222222222222",
};

const RESOLVIDO = {
  ok: true,
  code: "ok",
  link_id: "33333333-3333-4333-8333-333333333333",
  target_kind: "existing_org",
  organization_id: "44444444-4444-4444-8444-444444444444",
  new_org_name: null,
  quote: QUOTE,
  amount_cents: 510_000,
  expires_at: "2026-08-18T12:00:00.000Z",
};

const PLANO = { slug: "pro", name: "Torque Pro" };

describe("billing-payment-link — o que a resposta NÃO carrega", () => {
  it("não vaza organization_id, link_id, quote cru nem coupon_id", () => {
    const body = shapePublicLink(RESOLVIDO, PLANO, "Milennials", AGORA);
    const serializado = JSON.stringify(body);

    // Serializar e procurar o valor pega o vazamento em qualquer profundidade —
    // inclusive um campo que alguém acrescente depois dentro de `plan` ou
    // `totals`. Checar chave por chave só pegaria o que eu já esperava.
    expect(serializado).not.toContain(RESOLVIDO.organization_id);
    expect(serializado).not.toContain(RESOLVIDO.link_id);
    expect(serializado).not.toContain(QUOTE.coupon_id);
    expect(serializado).not.toContain(QUOTE.plan_id);
    expect(serializado).not.toContain("payment_method");
  });

  it("fixa o CONJUNTO de chaves em cada nível — a superfície não cresce sem alguém decidir", () => {
    // O teste de VALOR acima pega "um segredo conhecido vazou". Este pega outra
    // mutação: "a superfície CRESCEU". Um campo novo com dado interno e SEM
    // valor proibido — payment_method, included_seats, base_cents, seat_cents,
    // que ficaram de fora por escolha e não por proibição — passaria liso pelo
    // primeiro. Este quebra no dia em que alguém acrescenta campo, e a quebra é
    // o momento de decidir se aquele campo é público.
    const body = shapePublicLink(RESOLVIDO, PLANO, "Milennials", AGORA);

    expect(Object.keys(body).sort()).toEqual(["link", "state"]);
    expect(Object.keys(body.link!).sort()).toEqual([
      "amount_cents", "display_name", "expires_at", "next_charge_preview_at",
      "plan", "target_kind", "totals",
    ]);
    expect(Object.keys(body.link!.plan).sort()).toEqual([
      "billing_cycle", "cycle_months", "name", "seats", "slug",
    ]);
    expect(Object.keys(body.link!.totals).sort()).toEqual([
      "charge_cents", "coupon_discount_cents", "cycle_discount_cents",
      "manual_discount_cents", "monthly_cents", "subtotal_cents",
    ]);
  });

  it("não devolve `message` — a copy é do front", () => {
    const body = shapePublicLink({ ok: false, code: "link_expired" }, PLANO, null, AGORA);
    expect(body).toEqual({ state: "expired" });
    expect(Object.keys(body)).toEqual(["state"]);
  });
});

describe("billing-payment-link — os quatro estados", () => {
  it.each([
    ["link_expired", "expired"],
    ["link_already_paid", "already_paid"],
    ["link_revoked", "revoked"],
    ["link_not_found", "not_found"],
  ])("traduz %s para %s", (code, state) => {
    expect(shapePublicLink({ ok: false, code }, PLANO, null, AGORA).state).toBe(state);
  });

  it("código desconhecido cai em not_found — na dúvida, o estado que conta menos", () => {
    expect(shapePublicLink({ ok: false, code: "link_algo_novo" }, PLANO, null, AGORA).state)
      .toBe("not_found");
  });

  it("o enum tem exatamente os cinco valores do contrato", () => {
    // Renomear quebra a tela do Fole em silêncio; acrescentar é permitido
    // (ele renderiza fallback genérico). Esta asserção protege o RENOMEAR.
    expect([...PUBLIC_LINK_STATES]).toEqual([
      "valid", "expired", "already_paid", "revoked", "not_found",
    ]);
  });
});

describe("billing-payment-link — o pacote que a página exibe", () => {
  it("devolve a lista branca inteira para link válido", () => {
    const body = shapePublicLink(RESOLVIDO, PLANO, "Milennials", AGORA);

    expect(body.state).toBe("valid");
    expect(body.link).toEqual({
      amount_cents: 510_000,
      expires_at: "2026-08-18T12:00:00.000Z",
      target_kind: "existing_org",
      display_name: "Milennials",
      next_charge_preview_at: "2027-02-11T18:00:00.000Z",
      plan: {
        slug: "pro",
        name: "Torque Pro",
        billing_cycle: "semiannual",
        cycle_months: 6,
        seats: 5,
      },
      totals: {
        subtotal_cents: 100_000,
        cycle_discount_cents: 10_000,
        coupon_discount_cents: 5_000,
        manual_discount_cents: 0,
        monthly_cents: 85_000,
        charge_cents: 510_000,
      },
    });
  });

  it("organização NOVA usa new_org_name e ignora o nome vindo do banco", () => {
    const body = shapePublicLink(
      { ...RESOLVIDO, target_kind: "new_org", organization_id: null, new_org_name: "Padaria Aurora" },
      PLANO,
      "Não deveria aparecer",
      AGORA,
    );
    expect(body.link?.display_name).toBe("Padaria Aurora");
  });

  it("sem nome dos dois lados, display_name é nulo — e não string vazia", () => {
    const body = shapePublicLink(
      { ...RESOLVIDO, new_org_name: "" },
      PLANO,
      null,
      AGORA,
    );
    expect(body.link?.display_name).toBeNull();
  });

  it("quote sem cycle_months não inventa próxima cobrança", () => {
    const body = shapePublicLink(
      { ...RESOLVIDO, quote: { ...QUOTE, cycle_months: null } },
      PLANO,
      "Milennials",
      AGORA,
    );
    expect(body.link?.next_charge_preview_at).toBeNull();
    expect(body.link?.plan.cycle_months).toBeNull();
  });
});

describe("billing-payment-link — a data da próxima cobrança", () => {
  it("amarra no fim do mês: 31/jan + 1 mês é 28/fev, não 03/mar", () => {
    // A aritmética ingênua transborda e a página anunciaria uma data que não
    // existe no calendário. Este é o motivo de a conta ser do servidor.
    expect(addMonthsUtc(new Date("2026-01-31T12:00:00.000Z"), 1).toISOString())
      .toBe("2026-02-28T12:00:00.000Z");
  });

  it("respeita ano bissexto: 31/jan + 1 mês em 2028 é 29/fev", () => {
    expect(addMonthsUtc(new Date("2028-01-31T12:00:00.000Z"), 1).toISOString())
      .toBe("2028-02-29T12:00:00.000Z");
  });

  it("atravessa a virada do ano no ciclo anual", () => {
    expect(addMonthsUtc(new Date("2026-08-11T18:00:00.000Z"), 12).toISOString())
      .toBe("2027-08-11T18:00:00.000Z");
  });

  it("preserva a hora em UTC — sem passeio por fuso do servidor", () => {
    const r = addMonthsUtc(new Date("2026-08-11T23:30:00.000Z"), 1);
    expect(r.getUTCHours()).toBe(23);
    expect(r.getUTCMinutes()).toBe(30);
    expect(r.toISOString()).toBe("2026-09-11T23:30:00.000Z");
  });
});
