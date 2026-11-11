/**
 * Catálogo da Stripe: o espelho de `subscription_plans` (planos ativos) em Product
 * e Price. Não há tabela de mapeamento: o `lookup_key` é a chave, e a resolução é
 * sempre por ele.
 *
 * Estes valores são cópia de `subscription_plans`, e cópia diverge. Quem impede é
 * tests/unit/stripe-billing-db.test.ts, que compara esta tabela com
 * `billing_quote_price` na matriz plano × ciclo × assentos.
 *
 * Desconto de ciclo fica embutido em `unit_amount`: o Coupon da Stripe não modela a
 * cascata multiplicativa do nosso motor.
 */

export type BillingCycle = "monthly" | "semiannual" | "annual";
export type CatalogPart = "plan" | "seat";

export const BILLING_CYCLES: Record<
  BillingCycle,
  { interval: "month" | "year"; interval_count: number; months: number; discount_pct: number }
> = {
  monthly: { interval: "month", interval_count: 1, months: 1, discount_pct: 0 },
  semiannual: { interval: "month", interval_count: 6, months: 6, discount_pct: 10 },
  annual: { interval: "year", interval_count: 1, months: 12, discount_pct: 15 },
};

interface CatalogPlan {
  slug: string;
  label: string;
  /** Null nos planos puros por assento: não existe Price de base. */
  base_monthly_cents: number | null;
  seat_monthly_cents: number;
}

export const CATALOG_PLANS: Record<string, CatalogPlan> = {
  "torque-v8": { slug: "v8", label: "Torque Copilot", base_monthly_cents: 199700, seat_monthly_cents: 12000 },
  "torque-2.0": { slug: "2_0", label: "Torque Automation", base_monthly_cents: null, seat_monthly_cents: 69700 },
  "torque-1.0": { slug: "1_0", label: "Torque Base", base_monthly_cents: null, seat_monthly_cents: 29700 },
};

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && Object.hasOwn(BILLING_CYCLES, value);
}

export function productId(plan: string, part: CatalogPart): string {
  return `torque_${CATALOG_PLANS[plan].slug}_${part}`;
}

export function lookupKey(plan: string, part: CatalogPart, cycle: BillingCycle): string {
  return `torque_${CATALOG_PLANS[plan].slug}_${part}_${cycle}`;
}

/** Mesmo arredondamento do motor: ROUND sobre o mensal e só depois multiplica pelos meses. */
export function cycleUnitCents(monthlyCents: number, cycle: BillingCycle): number {
  const { months, discount_pct } = BILLING_CYCLES[cycle];
  return (monthlyCents - Math.round((monthlyCents * discount_pct) / 100)) * months;
}

export interface CatalogProduct {
  id: string;
  name: string;
  metadata: Record<string, string>;
}

export function catalogProducts(): CatalogProduct[] {
  return Object.entries(CATALOG_PLANS).flatMap(([plan, def]) =>
    (["plan", "seat"] as CatalogPart[]).map((part) => ({
      id: productId(plan, part),
      name: `${def.label} (${part === "plan" ? "plano" : "assento"})`,
      metadata: { torque_plan: plan, torque_role: part },
    }))
  );
}

export interface CatalogPrice {
  lookup_key: string;
  product: string;
  unit_amount: number;
  currency: "brl";
  tax_behavior: "inclusive";
  recurring: { interval: "month" | "year"; interval_count: number };
  metadata: Record<string, string>;
}

export function catalogPrices(): CatalogPrice[] {
  const out: CatalogPrice[] = [];
  for (const [plan, def] of Object.entries(CATALOG_PLANS)) {
    for (const cycle of Object.keys(BILLING_CYCLES) as BillingCycle[]) {
      const { interval, interval_count } = BILLING_CYCLES[cycle];
      const push = (part: CatalogPart, monthly: number) =>
        out.push({
          lookup_key: lookupKey(plan, part, cycle),
          product: productId(plan, part),
          unit_amount: cycleUnitCents(monthly, cycle),
          currency: "brl",
          tax_behavior: "inclusive",
          recurring: { interval, interval_count },
          metadata: { torque_plan: plan, torque_role: part, torque_cycle: cycle },
        });
      if (def.base_monthly_cents !== null) push("plan", def.base_monthly_cents);
      push("seat", def.seat_monthly_cents);
    }
  }
  return out;
}

export interface CatalogUnit {
  part: CatalogPart;
  quantity: number;
  unit_amount: number;
}

/** Os itens de catálogo para um quote; null quando o plano não é vendável na Stripe. */
export function catalogUnits(
  plan: string,
  cycle: BillingCycle,
  quote: { seats: number; extra_seats: number },
): CatalogUnit[] | null {
  const def = Object.hasOwn(CATALOG_PLANS, plan) ? CATALOG_PLANS[plan] : null;
  if (!def) return null;
  const units: CatalogUnit[] = [];
  if (def.base_monthly_cents !== null) {
    units.push({ part: "plan", quantity: 1, unit_amount: cycleUnitCents(def.base_monthly_cents, cycle) });
    if (quote.extra_seats > 0) {
      units.push({ part: "seat", quantity: quote.extra_seats, unit_amount: cycleUnitCents(def.seat_monthly_cents, cycle) });
    }
  } else {
    units.push({ part: "seat", quantity: quote.seats, unit_amount: cycleUnitCents(def.seat_monthly_cents, cycle) });
  }
  return units;
}

// ── Sincronização ────────────────────────────────────────────────────────────

export interface RemoteProduct {
  id: string;
  name: string;
  active: boolean;
}

export interface RemotePrice {
  id: string;
  lookup_key: string | null;
  product: string;
  unit_amount: number | null;
  currency: string;
  tax_behavior: string | null;
  active: boolean;
  recurring: { interval: string; interval_count: number } | null;
}

export type CatalogOp =
  | { kind: "create_product"; product: CatalogProduct }
  | { kind: "activate_product"; product_id: string }
  | { kind: "create_price"; price: CatalogPrice; transfer_lookup_key: boolean }
  | { kind: "archive_price"; price_id: string };

/**
 * Compara o desejado com o que existe na conta. Puro, para o dry-run e o teste
 * valerem o mesmo que o --apply. Price é imutável na Stripe: valor novo é Price nova
 * com `transfer_lookup_key`, e a antiga é arquivada.
 */
export function planCatalogSync(
  remote: { products: RemoteProduct[]; prices: RemotePrice[] },
): CatalogOp[] {
  const ops: CatalogOp[] = [];

  for (const product of catalogProducts()) {
    const existente = remote.products.find((p) => p.id === product.id);
    if (!existente) ops.push({ kind: "create_product", product });
    else if (!existente.active) ops.push({ kind: "activate_product", product_id: product.id });
  }

  for (const price of catalogPrices()) {
    const existente = remote.prices.find((p) => p.lookup_key === price.lookup_key);
    if (!existente) {
      ops.push({ kind: "create_price", price, transfer_lookup_key: false });
      continue;
    }
    const igual = existente.active &&
      existente.product === price.product &&
      existente.unit_amount === price.unit_amount &&
      existente.currency === price.currency &&
      existente.tax_behavior === price.tax_behavior &&
      existente.recurring?.interval === price.recurring.interval &&
      existente.recurring?.interval_count === price.recurring.interval_count;
    if (!igual) {
      ops.push({ kind: "create_price", price, transfer_lookup_key: true });
      ops.push({ kind: "archive_price", price_id: existente.id });
    }
  }

  return ops;
}
