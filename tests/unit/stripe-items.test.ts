// @vitest-environment node
/** Critério 7: soma dos itens == charge_cents em toda a matriz, com cupom e preço negociado. */
import { describe, it, expect } from "vitest";
import { buildSubscriptionItems, type StripeItem } from "../../supabase/functions/_shared/stripe/items.ts";
import { catalogPrices, BILLING_CYCLES } from "../../supabase/functions/_shared/stripe/catalog.ts";

const CATALOGO = new Map(catalogPrices().map((p) => [p.lookup_key, { id: `price_${p.lookup_key}`, unit_amount: p.unit_amount }]));
const quote = (over: Record<string, unknown>) => ({
  plan_name: "torque-v8", billing_cycle: "monthly", seats: 3, extra_seats: 0,
  base_cents: 199700, seat_cents: 0, subtotal_cents: 199700, ...over,
});
const soma = (items: StripeItem[], lookup = CATALOGO) =>
  items.reduce((acc, it) => {
    const unit = it.price
      ? [...lookup.values()].find((p) => p.id === it.price)!.unit_amount
      : it.price_data!.unit_amount;
    return acc + unit * it.quantity;
  }, 0);

describe("regra 1: catálogo bate", () => {
  it("v8 com extras usa as duas Prices", () => {
    const q = quote({ seats: 5, extra_seats: 2, seat_cents: 24000, subtotal_cents: 223700 });
    const r = buildSubscriptionItems(q, 223700, CATALOGO);
    expect(r).toMatchObject({ ok: true, rule: 1 });
    if (!r.ok) throw new Error();
    expect(r.items).toEqual([
      { price: "price_torque_v8_plan_monthly", quantity: 1 },
      { price: "price_torque_v8_seat_monthly", quantity: 2 },
    ]);
  });
});

describe("regra 2: soma igual, Price ausente ou diferente", () => {
  it("Price ausente vira price_data com o mesmo unit", () => {
    const q = quote({ plan_name: "torque-2.0", seats: 5, extra_seats: 5, base_cents: 0, seat_cents: 348500, subtotal_cents: 348500 });
    const r = buildSubscriptionItems(q, 348500, new Map());
    expect(r).toMatchObject({ ok: true, rule: 2 });
    if (!r.ok) throw new Error();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ quantity: 5 });
    expect(r.items[0].price_data).toMatchObject({
      currency: "brl", product: "torque_2_0_seat", unit_amount: 69700, tax_behavior: "inclusive",
      recurring: { interval: "month", interval_count: 1 },
    });
  });
  it("Price com valor diferente não é usada", () => {
    const l = new Map(CATALOGO);
    l.set("torque_v8_plan_monthly", { id: "price_x", unit_amount: 1 });
    const r = buildSubscriptionItems(quote({}), 199700, l);
    expect(r).toMatchObject({ ok: true, rule: 2 });
    if (r.ok) expect(r.items[0].price).toBeUndefined();
  });
});

describe("regra 3: soma diferente (cupom, manual)", () => {
  it("v8 com desconto: assento floor proporcional, resto no plan", () => {
    const q = quote({ billing_cycle: "annual", seats: 6, extra_seats: 3, seat_cents: 36000, subtotal_cents: 235700 });
    const charge = 1999999;
    const r = buildSubscriptionItems(q, charge, CATALOGO);
    expect(r).toMatchObject({ ok: true, rule: 3 });
    if (!r.ok) throw new Error();
    const seat = r.items.find((i) => i.price_data?.product === "torque_v8_seat")!;
    expect(seat.quantity).toBe(3);
    expect(seat.price_data!.unit_amount).toBe(Math.floor((charge * 36000) / 235700 / 3));
    expect(soma(r.items)).toBe(charge);
    expect(r.items.every((i) => i.price_data?.recurring?.interval === "year")).toBe(true);
  });
  it("por assento com resto: item plan carrega o resto", () => {
    const q = quote({ plan_name: "torque-1.0", seats: 3, extra_seats: 3, base_cents: 0, seat_cents: 89100, subtotal_cents: 89100 });
    const r = buildSubscriptionItems(q, 80000, CATALOGO);
    if (!r.ok) throw new Error();
    expect(soma(r.items)).toBe(80000);
    const plan = r.items.find((i) => i.price_data?.product === "torque_1_0_plan")!;
    expect(plan.price_data!.unit_amount).toBe(80000 - Math.floor(80000 / 3) * 3);
    expect(plan.quantity).toBe(1);
  });
  it("por assento sem resto: não cria item plan zerado", () => {
    const q = quote({ plan_name: "torque-1.0", seats: 2, extra_seats: 2, base_cents: 0, seat_cents: 59400, subtotal_cents: 59400 });
    const r = buildSubscriptionItems(q, 50000, CATALOGO);
    if (!r.ok) throw new Error();
    expect(r.items).toHaveLength(1);
  });
});

describe("regra 4: recusa antes de falar com a Stripe", () => {
  it.each([
    ["plano fora do catálogo", quote({ plan_name: "pro" }), 100],
    ["ciclo inválido", quote({ billing_cycle: "weekly" }), 100],
    ["valor zero", quote({}), 0],
    ["valor negativo", quote({}), -1],
    ["valor fracionado", quote({}), 10.5],
    ["assentos inválidos", quote({ plan_name: "torque-1.0", seats: 0, extra_seats: 0, base_cents: 0, seat_cents: 0, subtotal_cents: 0 }), 100],
  ])("%s", (_n, q, c) => {
    expect(buildSubscriptionItems(q, c as number, CATALOGO)).toEqual({ ok: false, code: "price_mismatch" });
  });
});

describe("critério 7: matriz inteira", () => {
  const planos = [
    { nome: "torque-v8", base: 199700, seat: 12000, incl: 3, min: 3 },
    { nome: "torque-2.0", base: 0, seat: 69700, incl: 0, min: 5 },
    { nome: "torque-1.0", base: 0, seat: 29700, incl: 0, min: 2 },
  ];
  const ciclos = Object.keys(BILLING_CYCLES);
  for (const p of planos) for (const ciclo of ciclos) for (const seats of [p.min, p.min + 1, p.min + 7, 40]) {
    const extra = p.base ? Math.max(seats - p.incl, 0) : seats;
    const subtotal = p.base + extra * p.seat;
    const meses = BILLING_CYCLES[ciclo as "monthly"].months;
    const pct = BILLING_CYCLES[ciclo as "monthly"].discount_pct;
    const mensal = subtotal - Math.round((subtotal * pct) / 100);
    const q = { plan_name: p.nome, billing_cycle: ciclo, seats, extra_seats: extra, base_cents: p.base, seat_cents: extra * p.seat, subtotal_cents: subtotal };
    const casos = [
      mensal * meses,
      Math.round(mensal * 0.65) * meses,
      Math.round(mensal * 0.333) * meses + 7,
      12345 * meses,
      51,
    ];
    for (const charge of casos) {
      it(`${p.nome} ${ciclo} ${seats} assentos cobra ${charge}`, () => {
        const r = buildSubscriptionItems(q, charge, CATALOGO);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(soma(r.items)).toBe(charge);
          for (const i of r.items) {
            expect(Number.isInteger(i.quantity) && i.quantity > 0).toBe(true);
            if (i.price_data) expect(Number.isInteger(i.price_data.unit_amount) && i.price_data.unit_amount >= 0).toBe(true);
          }
        }
      });
    }
  }
});
