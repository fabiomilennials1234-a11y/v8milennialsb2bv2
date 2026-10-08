import { describe, expect, it } from "vitest";
import {
  costsConfigured,
  listPriceCents,
  orgCost,
  orgFinance,
  sumFinance,
  type CostSettings,
  type OrgFinanceFacts,
  type PlanPricing,
} from "./org-finance";

// Planos como estão em prod (medido 2026-10-08).
const V8: PlanPricing = {
  name: "torque-v8",
  price_monthly: 1997,
  base_price_monthly: 1997,
  price_per_user_monthly: null,
  included_users: 3,
  extra_user_price: 120,
  min_users: 3,
};
const T2: PlanPricing = {
  name: "torque-2.0",
  price_monthly: 3485,
  base_price_monthly: null,
  price_per_user_monthly: 697,
  included_users: 0,
  extra_user_price: 697,
  min_users: 5,
};
const PRO: PlanPricing = {
  name: "pro",
  price_monthly: 197,
  base_price_monthly: null,
  price_per_user_monthly: null,
  included_users: 0,
  extra_user_price: 0,
  min_users: null,
};

const SETTINGS: CostSettings = {
  chip_monthly_cents: 5000,
  infra_fixed_monthly_cents: 100_000,
  payroll_monthly_cents: 0,
  llm_input_usd_per_mtok: 0.4,
  llm_output_usd_per_mtok: 1.6,
  usd_brl: 5,
};

const facts = (over: Partial<OrgFinanceFacts> = {}): OrgFinanceFacts => ({
  organization_id: "o1",
  monthly_fee_cents: null,
  fee_notes: null,
  fee_updated_at: null,
  uazapi_chips: 0,
  llm_input_tokens_30d: 0,
  llm_output_tokens_30d: 0,
  client_revenue_30d: 0,
  client_sales_30d: 0,
  ...over,
});

describe("listPriceCents", () => {
  it("base + excedente: usuários inclusos não pagam extra", () => {
    expect(listPriceCents(V8, 2)).toBe(199_700);
    expect(listPriceCents(V8, 3)).toBe(199_700);
    expect(listPriceCents(V8, 5)).toBe(199_700 + 2 * 12_000);
  });

  it("por usuário respeita o mínimo", () => {
    expect(listPriceCents(T2, 1)).toBe(5 * 69_700);
    expect(listPriceCents(T2, 7)).toBe(7 * 69_700);
  });

  it("plano antigo usa o preço fixo", () => {
    expect(listPriceCents(PRO, 10)).toBe(19_700);
  });
});

describe("orgCost", () => {
  it("soma chips, LLM convertido e infra rateada", () => {
    const c = orgCost(
      { uazapi_chips: 2, llm_input_tokens_30d: 10_000_000, llm_output_tokens_30d: 1_000_000 },
      SETTINGS,
      true,
      4,
    );
    expect(c.chipsCents).toBe(10_000);
    // (10 × 0,40 + 1 × 1,60) US$ × 5 = R$ 28
    expect(c.llmCents).toBe(2_800);
    expect(c.infraCents).toBe(25_000);
    expect(c.totalCents).toBe(37_800);
  });

  it("org fora de uso não absorve infra nem salários", () => {
    const c = orgCost(
      { uazapi_chips: 1, llm_input_tokens_30d: 0, llm_output_tokens_30d: 0 },
      { ...SETTINGS, payroll_monthly_cents: 4_000_000 },
      false,
      4,
    );
    expect(c.infraCents).toBe(0);
    expect(c.payrollCents).toBe(0);
  });

  it("salários são rateados entre as orgs em uso, como a infra", () => {
    const c = orgCost(
      { uazapi_chips: 0, llm_input_tokens_30d: 0, llm_output_tokens_30d: 0 },
      { ...SETTINGS, payroll_monthly_cents: 4_000_000 },
      true,
      40,
    );
    // R$ 40.000 ÷ 40 = R$ 1.000; infra R$ 1.000 ÷ 40 = R$ 25
    expect(c.payrollCents).toBe(100_000);
    expect(c.totalCents).toBe(100_000 + 2_500);
  });

  it("tokens sem câmbio: LLM fica null e fora do total", () => {
    const c = orgCost(
      { uazapi_chips: 0, llm_input_tokens_30d: 1_000_000, llm_output_tokens_30d: 0 },
      { ...SETTINGS, usd_brl: 0 },
      false,
      0,
    );
    expect(c.llmCents).toBeNull();
    expect(c.totalCents).toBe(0);
  });
});

describe("orgFinance", () => {
  it("contrato vence a tabela", () => {
    const f = orgFinance({ facts: facts({ monthly_fee_cents: 150_000 }), plan: V8, users: 3, settings: SETTINGS, inUse: false, orgsInUse: 1 });
    expect(f.feeSource).toBe("contrato");
    expect(f.feeCents).toBe(150_000);
  });

  it("sem contrato estima pela tabela; sem plano fica zero", () => {
    expect(orgFinance({ facts: facts(), plan: V8, users: 3, settings: SETTINGS, inUse: false, orgsInUse: 1 }).feeSource).toBe("tabela");
    const semPlano = orgFinance({ facts: undefined, plan: undefined, users: 0, settings: SETTINGS, inUse: false, orgsInUse: 1 });
    expect(semPlano.feeSource).toBe("sem_plano");
    expect(semPlano.marginPct).toBeNull();
  });

  it("margem = mensalidade − custo", () => {
    const f = orgFinance({
      facts: facts({ monthly_fee_cents: 200_000, uazapi_chips: 2 }),
      plan: V8,
      users: 3,
      settings: SETTINGS,
      inUse: true,
      orgsInUse: 2,
    });
    // custo = 2 × 50 + 1000 / 2 = R$ 600
    expect(f.cost.totalCents).toBe(60_000);
    expect(f.marginCents).toBe(140_000);
    expect(f.marginPct).toBeCloseTo(0.7);
  });
});

describe("sumFinance", () => {
  it("soma e conta contratos x estimativas", () => {
    const a = orgFinance({ facts: facts({ monthly_fee_cents: 100_000 }), plan: V8, users: 3, settings: SETTINGS, inUse: true, orgsInUse: 2 });
    const b = orgFinance({ facts: facts({ client_revenue_30d: 5000 }), plan: PRO, users: 1, settings: SETTINGS, inUse: true, orgsInUse: 2 });
    const t = sumFinance([a, b]);
    expect(t.feeCents).toBe(119_700);
    expect(t.costCents).toBe(100_000);
    expect(t.marginCents).toBe(19_700);
    expect(t.contratos).toBe(1);
    expect(t.estimadas).toBe(1);
    expect(t.clientRevenue30d).toBe(5000);
  });

  it("lista vazia não divide por zero", () => {
    expect(sumFinance([]).marginPct).toBeNull();
  });
});

describe("costsConfigured", () => {
  it("tudo zerado = não configurado", () => {
    expect(costsConfigured({ ...SETTINGS, chip_monthly_cents: 0, infra_fixed_monthly_cents: 0, usd_brl: 0 })).toBe(false);
    expect(costsConfigured(SETTINGS)).toBe(true);
    expect(
      costsConfigured({ ...SETTINGS, chip_monthly_cents: 0, infra_fixed_monthly_cents: 0, usd_brl: 0, payroll_monthly_cents: 1 }),
    ).toBe(true);
    expect(costsConfigured(undefined)).toBe(false);
  });
});
