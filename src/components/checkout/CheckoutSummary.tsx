import { motion } from "framer-motion";
import { Receipt, Tag, Users, Zap, Percent } from "lucide-react";
import { formatBRL, type PricingBreakdown } from "@/lib/pricing-calculator";
import type { PlanRow, AddonRow } from "@/hooks/useCheckout";

interface Props {
  plan: PlanRow | null;
  billingCycle: "monthly" | "semester" | "annual";
  userCount: number;
  turboCount: number;
  turboAddon: AddonRow | null;
  pricing: PricingBreakdown | null;
  couponCode: string;
  couponDiscountPct: number;
}

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  semester: "Semestral",
  annual: "Anual",
};

export function CheckoutSummary({
  plan,
  billingCycle,
  userCount,
  turboCount,
  turboAddon,
  pricing,
  couponCode,
  couponDiscountPct,
}: Props) {
  if (!plan || !pricing) {
    return (
      <div className="rounded-2xl border border-border bg-card/50 p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Receipt className="h-4 w-4" />
          <span className="text-sm font-medium">Resumo</span>
        </div>
        <p className="mt-4 text-sm text-muted-foreground/60">
          Selecione um plano para ver o resumo.
        </p>
      </div>
    );
  }

  const isPackagePlan = plan.base_price_monthly !== null;
  const extraUsers = isPackagePlan
    ? Math.max(userCount - plan.included_users, 0)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Resumo do pedido
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {plan.display_name} &middot; {CYCLE_LABELS[billingCycle]}
        </p>
      </div>

      {/* Line items */}
      <div className="px-6 space-y-3 text-sm">
        {/* Plan base */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-3.5 w-3.5 shrink-0" />
            {isPackagePlan ? (
              <span>
                Plano base ({plan.included_users} usuarios incl.)
              </span>
            ) : (
              <span>
                {userCount} {userCount === 1 ? "usuario" : "usuarios"} &times;{" "}
                {formatBRL(plan.price_per_user_monthly ?? 0)}/mes
              </span>
            )}
          </div>
          <span className="text-foreground font-medium tabular-nums whitespace-nowrap">
            {formatBRL(pricing.plan_monthly)}
          </span>
        </div>

        {/* Extra users (V8) */}
        {isPackagePlan && extraUsers > 0 && (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground pl-[22px]">
              +{extraUsers} usuario{extraUsers > 1 ? "s" : ""} extra &times;{" "}
              {formatBRL(plan.extra_user_price)}/mes
            </span>
            <span className="text-foreground font-medium tabular-nums whitespace-nowrap">
              {formatBRL(pricing.extras_monthly)}
            </span>
          </div>
        )}

        {/* Turbo addon */}
        {turboCount > 0 && turboAddon && pricing.addons_monthly > 0 && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-3.5 w-3.5 shrink-0" />
              <span>
                Turbo Copilot &times; {turboCount}
              </span>
            </div>
            <span className="text-foreground font-medium tabular-nums whitespace-nowrap">
              {formatBRL(pricing.addons_monthly)}
            </span>
          </div>
        )}

        {/* Volume discount */}
        {pricing.volume_discount > 0 && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <Percent className="h-3.5 w-3.5 shrink-0" />
              <span>Desconto volume ({plan.discount_volume_pct}%)</span>
            </div>
            <span className="text-emerald-400 font-medium tabular-nums whitespace-nowrap">
              -{formatBRL(pricing.volume_discount)}
            </span>
          </div>
        )}

        {/* Coupon discount */}
        {pricing.coupon_discount > 0 && couponCode && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <Tag className="h-3.5 w-3.5 shrink-0" />
              <span>
                Cupom {couponCode.toUpperCase()} (-{couponDiscountPct}%)
              </span>
            </div>
            <span className="text-emerald-400 font-medium tabular-nums whitespace-nowrap">
              -{formatBRL(pricing.coupon_discount)}
            </span>
          </div>
        )}

        {/* Cycle discount */}
        {pricing.cycle_discount > 0 && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <Percent className="h-3.5 w-3.5 shrink-0" />
              <span>
                Desconto{" "}
                {billingCycle === "semester" ? "semestral" : "anual"} (
                {billingCycle === "semester"
                  ? plan.discount_semester_pct
                  : plan.discount_annual_pct}
                %)
              </span>
            </div>
            <span className="text-emerald-400 font-medium tabular-nums whitespace-nowrap">
              -{formatBRL(pricing.cycle_discount)}
            </span>
          </div>
        )}
      </div>

      {/* Divider + totals */}
      <div className="mx-6 mt-5 mb-0 border-t border-border/60" />

      <div className="px-6 py-5 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total mensal</span>
          <span className="text-lg font-bold text-foreground tabular-nums">
            {formatBRL(pricing.total_monthly)}
          </span>
        </div>
        {pricing.cycle_months > 1 && (
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">
              Total do periodo ({pricing.cycle_months} meses)
            </span>
            <span className="text-base font-semibold text-primary tabular-nums">
              {formatBRL(pricing.total_cycle)}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
