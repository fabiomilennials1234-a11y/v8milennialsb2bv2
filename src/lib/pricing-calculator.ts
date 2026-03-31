export interface PlanConfig {
  slug: string;
  price_per_user_monthly: number | null;
  base_price_monthly: number | null;
  min_users: number;
  included_users: number;
  extra_user_price: number;
  discount_semester_pct: number;
  discount_annual_pct: number;
  discount_volume_pct: number;
  discount_volume_min: number;
}

export interface AddonConfig {
  slug: string;
  price_monthly: number;
  applicable_plans: string[];
}

export interface PricingInput {
  plan: PlanConfig;
  billing_cycle: "monthly" | "semester" | "annual";
  user_count: number;
  turbo_count: number;
  addon: AddonConfig | null;
  coupon_discount_pct: number;
}

export interface PricingBreakdown {
  plan_monthly: number;
  extras_monthly: number;
  addons_monthly: number;
  subtotal_monthly: number;
  volume_discount: number;
  cycle_discount: number;
  coupon_discount: number;
  total_monthly: number;
  total_cycle: number;
  cycle_months: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculatePricing(input: PricingInput): PricingBreakdown {
  const { plan, billing_cycle, turbo_count, addon, coupon_discount_pct } =
    input;

  // 1. Enforce minimum users
  const users = Math.max(input.user_count, plan.min_users);

  // 2. Plan base cost
  let plan_monthly: number;
  let extras_monthly: number;

  if (plan.base_price_monthly !== null) {
    // Package plan (V8 style): fixed base + extra users above included
    plan_monthly = plan.base_price_monthly;
    const extra_users = Math.max(users - plan.included_users, 0);
    extras_monthly = extra_users * plan.extra_user_price;
  } else if (plan.price_per_user_monthly !== null) {
    // Per-user plan (1.0 / 2.0 style): all users * per-user price
    plan_monthly = users * plan.price_per_user_monthly;
    extras_monthly = 0;
  } else {
    plan_monthly = 0;
    extras_monthly = 0;
  }

  // 3. Addons (e.g. Turbo seats)
  let addons_monthly = 0;
  if (
    addon !== null &&
    turbo_count > 0 &&
    addon.applicable_plans.includes(plan.slug)
  ) {
    addons_monthly = turbo_count * addon.price_monthly;
  }

  // 4. Subtotal
  const subtotal_monthly = plan_monthly + extras_monthly + addons_monthly;

  // 5. Volume discount
  let volume_discount = 0;
  if (users >= plan.discount_volume_min && plan.discount_volume_pct > 0) {
    if (plan.price_per_user_monthly !== null) {
      // Per-user plan: discount applies to ALL users' price
      volume_discount =
        users * plan.price_per_user_monthly * (plan.discount_volume_pct / 100);
    } else {
      // Package plan: discount applies to extra users only
      const extra_users = Math.max(users - plan.included_users, 0);
      volume_discount =
        extra_users * plan.extra_user_price * (plan.discount_volume_pct / 100);
    }
  }

  // 6. After volume discount
  const after_volume = subtotal_monthly - volume_discount;

  // 7. Coupon discount
  const coupon_discount =
    coupon_discount_pct > 0 ? after_volume * (coupon_discount_pct / 100) : 0;

  // 8. After coupon
  const after_coupon = after_volume - coupon_discount;

  // 9. Cycle discount
  let cycle_pct = 0;
  if (billing_cycle === "semester") {
    cycle_pct = plan.discount_semester_pct;
  } else if (billing_cycle === "annual") {
    cycle_pct = plan.discount_annual_pct;
  }
  const cycle_discount =
    cycle_pct > 0 ? after_coupon * (cycle_pct / 100) : 0;

  // 10. Total monthly (floor at 0)
  const total_monthly = Math.max(after_coupon - cycle_discount, 0);

  // 11. Cycle months
  const cycle_months =
    billing_cycle === "annual" ? 12 : billing_cycle === "semester" ? 6 : 1;

  // 12. Total for the cycle
  const total_cycle = total_monthly * cycle_months;

  // 13. Round all money values to 2 decimal places
  return {
    plan_monthly: round2(plan_monthly),
    extras_monthly: round2(extras_monthly),
    addons_monthly: round2(addons_monthly),
    subtotal_monthly: round2(subtotal_monthly),
    volume_discount: round2(volume_discount),
    cycle_discount: round2(cycle_discount),
    coupon_discount: round2(coupon_discount),
    total_monthly: round2(total_monthly),
    total_cycle: round2(total_cycle),
    cycle_months,
  };
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
