// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CATALOG_PLANS,
  BILLING_CYCLES,
  catalogProducts,
  catalogPrices,
  catalogUnits,
  lookupKey,
  planCatalogSync,
} from "../../supabase/functions/_shared/stripe/catalog.ts";

describe("catálogo — unit por ciclo (tabela do desenho)", () => {
  it.each([
    ["torque-v8", "plan", 199700, 1078380, 2036940],
    ["torque-v8", "seat", 12000, 64800, 122400],
    ["torque-2.0", "seat", 69700, 376380, 710940],
    ["torque-1.0", "seat", 29700, 160380, 302940],
  ])("%s %s", (plan, part, m, s, a) => {
    const price = (cycle: string) =>
      catalogPrices().find((p) => p.lookup_key === lookupKey(plan, part as "plan" | "seat", cycle as "monthly"))!;
    expect(price("monthly").unit_amount).toBe(m);
    expect(price("semiannual").unit_amount).toBe(s);
    expect(price("annual").unit_amount).toBe(a);
  });

  it("recorrência: mensal month/1, semestral month/6, anual year/1", () => {
    expect(BILLING_CYCLES.monthly).toMatchObject({ interval: "month", interval_count: 1, months: 1 });
    expect(BILLING_CYCLES.semiannual).toMatchObject({ interval: "month", interval_count: 6, months: 6 });
    expect(BILLING_CYCLES.annual).toMatchObject({ interval: "year", interval_count: 1, months: 12 });
  });

  it("toda Price é BRL, tax inclusive, com lookup_key único", () => {
    const prices = catalogPrices();
    expect(prices).toHaveLength(12);
    expect(new Set(prices.map((p) => p.lookup_key)).size).toBe(12);
    for (const p of prices) {
      expect(p.currency).toBe("brl");
      expect(p.tax_behavior).toBe("inclusive");
      expect(p.lookup_key).toMatch(/^torque_[a-z0-9_]+_(plan|seat)_(monthly|semiannual|annual)$/);
    }
  });

  it("produtos: plan e seat por plano ativo", () => {
    expect(catalogProducts().map((p) => p.id).sort()).toEqual([
      "torque_1_0_plan", "torque_1_0_seat",
      "torque_2_0_plan", "torque_2_0_seat",
      "torque_v8_plan", "torque_v8_seat",
    ]);
    expect(Object.keys(CATALOG_PLANS).sort()).toEqual(["torque-1.0", "torque-2.0", "torque-v8"]);
  });

  it("catalogUnits monta os itens do quote", () => {
    expect(catalogUnits("torque-v8", "monthly", { seats: 5, extra_seats: 2 })).toEqual([
      { part: "plan", quantity: 1, unit_amount: 199700 },
      { part: "seat", quantity: 2, unit_amount: 12000 },
    ]);
    expect(catalogUnits("torque-v8", "annual", { seats: 3, extra_seats: 0 })).toEqual([
      { part: "plan", quantity: 1, unit_amount: 2036940 },
    ]);
    expect(catalogUnits("torque-2.0", "semiannual", { seats: 7, extra_seats: 7 })).toEqual([
      { part: "seat", quantity: 7, unit_amount: 376380 },
    ]);
    expect(catalogUnits("pro", "monthly", { seats: 1, extra_seats: 0 })).toBeNull();
  });
});

describe("planCatalogSync — idempotência", () => {
  const remoto = () => ({
    products: catalogProducts().map((p) => ({ id: p.id, name: p.name, active: true })),
    prices: catalogPrices().map((p) => ({
      id: `price_${p.lookup_key}`,
      lookup_key: p.lookup_key,
      product: p.product,
      unit_amount: p.unit_amount,
      currency: "brl",
      tax_behavior: "inclusive",
      active: true,
      recurring: { interval: p.recurring.interval, interval_count: p.recurring.interval_count },
    })),
  });

  it("conta vazia: cria 6 produtos e 12 prices", () => {
    const ops = planCatalogSync({ products: [], prices: [] });
    expect(ops.filter((o) => o.kind === "create_product")).toHaveLength(6);
    expect(ops.filter((o) => o.kind === "create_price")).toHaveLength(12);
  });

  it("segunda execução: zero mudanças", () => {
    expect(planCatalogSync(remoto())).toEqual([]);
  });

  it("valor mudou: nova Price com transfer_lookup_key e a antiga arquivada", () => {
    const r = remoto();
    r.prices[0].unit_amount += 100;
    const ops = planCatalogSync(r);
    expect(ops).toHaveLength(2);
    const criar = ops.find((o) => o.kind === "create_price");
    expect(criar).toMatchObject({ kind: "create_price", transfer_lookup_key: true });
    expect(ops.find((o) => o.kind === "archive_price")).toMatchObject({ price_id: r.prices[0].id });
  });

  it("produto arquivado é reativado, nunca duplicado", () => {
    const r = remoto();
    r.products[0].active = false;
    expect(planCatalogSync(r)).toEqual([{ kind: "activate_product", product_id: r.products[0].id }]);
  });
});
