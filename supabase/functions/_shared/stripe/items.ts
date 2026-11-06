/**
 * Do quote congelado do link para os itens da assinatura. Regra única:
 *
 *   1. Units de catálogo, soma == charge e Price com esse valor: usa a Price.
 *   2. Soma igual, Price ausente ou diferente: price_data com os mesmos units.
 *   3. Soma diferente (cupom, preço negociado): price_data; assento com unit por
 *      floor proporcional, resto no item plan.
 *   4. Afirma soma == charge; senão price_mismatch antes de falar com a Stripe.
 *
 * O valor cobrado é sempre `charge`, nunca o catálogo: o preço é do nosso motor.
 */

import {
  BILLING_CYCLES,
  catalogUnits,
  isBillingCycle,
  lookupKey,
  productId,
  type BillingCycle,
  type CatalogPart,
} from "./catalog.ts";

export interface StripeItem {
  price?: string;
  price_data?: {
    currency: "brl";
    product: string;
    unit_amount: number;
    tax_behavior: "inclusive";
    recurring: { interval: "month" | "year"; interval_count: number };
  };
  quantity: number;
}

export type BuildItemsResult =
  | { ok: true; rule: 1 | 2 | 3; items: StripeItem[] }
  | { ok: false; code: "price_mismatch" };

export interface PriceLookupEntry {
  id: string;
  unit_amount: number | null;
}

const RECUSA: BuildItemsResult = { ok: false, code: "price_mismatch" };

const inteiro = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) ? v : 0);

export function buildSubscriptionItems(
  quote: Record<string, unknown>,
  chargeCents: number,
  prices: ReadonlyMap<string, PriceLookupEntry>,
): BuildItemsResult {
  const plan = quote.plan_name;
  const cycle = quote.billing_cycle;
  const seats = inteiro(quote.seats);
  const extraSeats = inteiro(quote.extra_seats);

  if (typeof plan !== "string" || !isBillingCycle(cycle)) return RECUSA;
  if (!Number.isInteger(chargeCents) || chargeCents <= 0) return RECUSA;

  const units = catalogUnits(plan, cycle, { seats, extra_seats: extraSeats });
  if (!units || units.some((u) => u.quantity <= 0)) return RECUSA;

  const dataItem = (part: CatalogPart, quantity: number, unit_amount: number): StripeItem => ({
    quantity,
    price_data: {
      currency: "brl",
      product: productId(plan, part),
      unit_amount,
      tax_behavior: "inclusive",
      recurring: {
        interval: BILLING_CYCLES[cycle].interval,
        interval_count: BILLING_CYCLES[cycle].interval_count,
      },
    },
  });

  const somaCatalogo = units.reduce((acc, u) => acc + u.unit_amount * u.quantity, 0);

  let items: StripeItem[];
  let rule: 1 | 2 | 3;

  if (somaCatalogo === chargeCents) {
    let todasDoCatalogo = true;
    items = units.map((u) => {
      const price = prices.get(lookupKey(plan, u.part, cycle as BillingCycle));
      if (price && price.unit_amount === u.unit_amount) return { price: price.id, quantity: u.quantity };
      todasDoCatalogo = false;
      return dataItem(u.part, u.quantity, u.unit_amount);
    });
    rule = todasDoCatalogo ? 1 : 2;
  } else {
    items = proporcional(quote, plan, chargeCents, seats, extraSeats, dataItem);
    rule = 3;
  }

  const soma = items.reduce((acc, it) => {
    const unit = it.price_data?.unit_amount ??
      [...prices.values()].find((p) => p.id === it.price)?.unit_amount ?? NaN;
    return acc + unit * it.quantity;
  }, 0);
  if (soma !== chargeCents || items.length === 0) return RECUSA;

  return { ok: true, rule, items };
}

function proporcional(
  quote: Record<string, unknown>,
  plan: string,
  chargeCents: number,
  seats: number,
  extraSeats: number,
  dataItem: (part: CatalogPart, quantity: number, unit: number) => StripeItem,
): StripeItem[] {
  const temBase = inteiro(quote.base_cents) > 0;
  const quantidade = temBase ? extraSeats : seats;
  const subtotal = inteiro(quote.subtotal_cents);
  const brutoAssentos = inteiro(quote.seat_cents);

  // Conta em inteiros: `charge * bruto` cabe em 2^53 para qualquer preço real.
  const unitAssento = quantidade > 0 && subtotal > 0
    ? Math.floor((chargeCents * brutoAssentos) / subtotal / quantidade)
    : 0;

  const items: StripeItem[] = [];
  if (unitAssento > 0) items.push(dataItem("seat", quantidade, unitAssento));

  const resto = chargeCents - unitAssento * quantidade;
  if (resto > 0) items.unshift(dataItem("plan", 1, resto));

  return items;
}
