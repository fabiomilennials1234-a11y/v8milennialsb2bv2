import { describe, it, expect } from "vitest";
import {
  calculatePricing,
  formatBRL,
  type PlanConfig,
  type PricingInput,
} from "../../src/lib/pricing-calculator";

const basePlan: PlanConfig = {
  slug: "pro",
  price_per_user_monthly: null,
  base_price_monthly: 500,
  min_users: 1,
  included_users: 3,
  extra_user_price: 100,
  discount_semester_pct: 10,
  discount_annual_pct: 20,
  discount_volume_pct: 15,
  discount_volume_min: 10,
};

const perUserPlan: PlanConfig = {
  slug: "starter",
  price_per_user_monthly: 100,
  base_price_monthly: null,
  min_users: 1,
  included_users: 0,
  extra_user_price: 0,
  discount_semester_pct: 5,
  discount_annual_pct: 10,
  discount_volume_pct: 10,
  discount_volume_min: 5,
};

function makeInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    plan: basePlan,
    billing_cycle: "monthly",
    user_count: 3,
    turbo_count: 0,
    addon: null,
    coupon_discount_pct: 0,
    ...overrides,
  };
}

describe("calculatePricing — package plan", () => {
  it("base price with included users, no extras", () => {
    const result = calculatePricing(makeInput({ user_count: 3 }));
    expect(result.plan_monthly).toBe(500);
    expect(result.extras_monthly).toBe(0);
    expect(result.total_monthly).toBe(500);
  });

  it("charges extra users above included", () => {
    const result = calculatePricing(makeInput({ user_count: 5 }));
    expect(result.extras_monthly).toBe(200); // 2 extra * 100
    expect(result.subtotal_monthly).toBe(700);
  });

  it("enforces minimum users", () => {
    const plan = { ...basePlan, min_users: 5 };
    const result = calculatePricing(makeInput({ plan, user_count: 2 }));
    // min_users=5, included=3, so 2 extra users
    expect(result.extras_monthly).toBe(200);
  });

  it("applies semester discount", () => {
    const result = calculatePricing(makeInput({ billing_cycle: "semester" }));
    expect(result.cycle_discount).toBe(50); // 10% of 500
    expect(result.total_monthly).toBe(450);
    expect(result.cycle_months).toBe(6);
    expect(result.total_cycle).toBe(2700);
  });

  it("applies annual discount", () => {
    const result = calculatePricing(makeInput({ billing_cycle: "annual" }));
    expect(result.cycle_discount).toBe(100); // 20% of 500
    expect(result.total_monthly).toBe(400);
    expect(result.cycle_months).toBe(12);
  });

  it("monthly has no cycle discount", () => {
    const result = calculatePricing(makeInput({ billing_cycle: "monthly" }));
    expect(result.cycle_discount).toBe(0);
    expect(result.cycle_months).toBe(1);
  });

  it("applies volume discount on extra users", () => {
    const result = calculatePricing(makeInput({ user_count: 13 }));
    // 10 extra users * 100 = 1000 extras
    // volume: 10 extra * 100 * 15% = 150
    expect(result.volume_discount).toBe(150);
  });

  it("no volume discount below threshold", () => {
    const result = calculatePricing(makeInput({ user_count: 5 }));
    expect(result.volume_discount).toBe(0);
  });

  it("applies coupon discount", () => {
    const result = calculatePricing(makeInput({ coupon_discount_pct: 10 }));
    // 500 subtotal, volume=0, after_volume=500, coupon=50
    expect(result.coupon_discount).toBe(50);
    expect(result.total_monthly).toBe(450);
  });

  it("total never goes below 0", () => {
    const result = calculatePricing(makeInput({ coupon_discount_pct: 100 }));
    expect(result.total_monthly).toBe(0);
  });
});

describe("calculatePricing — per-user plan", () => {
  it("charges per user", () => {
    const result = calculatePricing(makeInput({ plan: perUserPlan, user_count: 3 }));
    expect(result.plan_monthly).toBe(300);
    expect(result.extras_monthly).toBe(0);
  });

  it("applies volume discount on all users", () => {
    const result = calculatePricing(makeInput({ plan: perUserPlan, user_count: 5 }));
    // 5 * 100 = 500, volume: 5 * 100 * 10% = 50
    expect(result.volume_discount).toBe(50);
  });
});

describe("calculatePricing — addons", () => {
  it("adds turbo addon cost", () => {
    const addon = { slug: "turbo", price_monthly: 50, applicable_plans: ["pro"] };
    const result = calculatePricing(makeInput({ addon, turbo_count: 2 }));
    expect(result.addons_monthly).toBe(100);
  });

  it("ignores addon if plan not applicable", () => {
    const addon = { slug: "turbo", price_monthly: 50, applicable_plans: ["enterprise"] };
    const result = calculatePricing(makeInput({ addon, turbo_count: 2 }));
    expect(result.addons_monthly).toBe(0);
  });

  it("ignores addon if turbo_count is 0", () => {
    const addon = { slug: "turbo", price_monthly: 50, applicable_plans: ["pro"] };
    const result = calculatePricing(makeInput({ addon, turbo_count: 0 }));
    expect(result.addons_monthly).toBe(0);
  });
});

describe("formatBRL", () => {
  it("formats 500 as R$ 500,00", () => {
    const result = formatBRL(500);
    expect(result).toContain("500");
    expect(result).toContain("R$");
  });

  it("formats 0", () => {
    const result = formatBRL(0);
    expect(result).toContain("0");
  });

  it("formats decimals", () => {
    const result = formatBRL(99.99);
    expect(result).toContain("99,99");
  });
});
