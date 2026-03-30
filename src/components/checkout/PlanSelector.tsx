import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Minus,
  Plus,
  Star,
  Zap,
  Tag,
  Loader2,
  X,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatBRL } from "@/lib/pricing-calculator";
import { useCouponValidation } from "@/hooks/useCouponValidation";
import type { PlanRow, AddonRow, CheckoutState } from "@/hooks/useCheckout";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  state: CheckoutState;
  plans: PlanRow[];
  turboAddon: AddonRow | null;
  setPlan: (slug: string) => void;
  setBillingCycle: (cycle: "monthly" | "semester" | "annual") => void;
  setUserCount: (count: number) => void;
  setTurboCount: (count: number) => void;
  applyCoupon: (
    code: string,
    discountPct: number,
    couponId: string | null,
  ) => void;
  clearCoupon: () => void;
  onContinue: () => void;
  canContinue: boolean;
}

// ─── Billing cycle config ─────────────────────────────────────────────────────

const CYCLES = [
  { value: "monthly" as const, label: "Mensal", badge: null },
  { value: "semester" as const, label: "Semestral", badge: "-10%" },
  { value: "annual" as const, label: "Anual", badge: "-15%" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PlanSelector({
  state,
  plans,
  turboAddon,
  setPlan,
  setBillingCycle,
  setUserCount,
  setTurboCount,
  applyCoupon,
  clearCoupon,
  onContinue,
  canContinue,
}: Props) {
  const [couponInput, setCouponInput] = useState(state.coupon_code);
  const couponValidation = useCouponValidation();

  const turboApplies =
    turboAddon?.applicable_plans.includes(state.plan_slug ?? "") ?? false;

  async function handleApplyCoupon() {
    if (!couponInput.trim() || !state.plan_slug) return;
    const result = await couponValidation.validate(
      couponInput.trim(),
      state.plan_slug,
    );
    if (result.valid) {
      applyCoupon(couponInput.trim(), result.discount_pct, result.coupon_id);
    }
  }

  function handleClearCoupon() {
    clearCoupon();
    setCouponInput("");
    couponValidation.reset();
  }

  function getEffectivePrice(plan: PlanRow): number {
    if (plan.price_per_user_monthly !== null) return plan.price_per_user_monthly;
    if (plan.base_price_monthly !== null) return plan.base_price_monthly;
    return 0;
  }

  function getCycleMultiplier(): number {
    if (state.billing_cycle === "semester") return 0.9;
    if (state.billing_cycle === "annual") return 0.85;
    return 1;
  }

  return (
    <div className="space-y-8">
      {/* ── Billing cycle toggle ──────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">
          Ciclo de cobranca
        </h3>
        <div className="inline-flex rounded-xl border border-border bg-muted/30 p-1">
          {CYCLES.map((cycle) => {
            const isActive = state.billing_cycle === cycle.value;
            return (
              <button
                key={cycle.value}
                onClick={() => setBillingCycle(cycle.value)}
                className={`
                  relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${
                    isActive
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground/80"
                  }
                `}
              >
                <span>{cycle.label}</span>
                {cycle.badge && (
                  <span
                    className={`
                      ml-1.5 inline-block text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none
                      ${isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"}
                    `}
                  >
                    {cycle.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Plan cards ────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isSelected = state.plan_slug === plan.name;
          const isPopular = plan.name === "torque-2.0";
          const isPackage = plan.base_price_monthly !== null;
          const effectivePrice = getEffectivePrice(plan);
          const displayPrice = effectivePrice * getCycleMultiplier();

          return (
            <motion.div
              key={plan.id}
              layout
              className={`
                relative rounded-2xl border-2 p-5 transition-all duration-200 cursor-pointer
                ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                    : "border-border hover:border-border/80 bg-card/50 hover:bg-card/70"
                }
              `}
              onClick={() => setPlan(plan.name)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
            >
              {/* Popular badge */}
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <span className="inline-flex items-center gap-1 rounded-full gradient-primary px-3 py-1 text-[11px] font-bold text-white shadow-lg">
                    <Star className="h-3 w-3" />
                    Mais popular
                  </span>
                </div>
              )}

              {/* Selection indicator */}
              <div
                className={`
                  absolute top-4 right-4 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all
                  ${isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"}
                `}
              >
                {isSelected && <Check className="h-3 w-3 text-white" />}
              </div>

              {/* Plan info */}
              <div className="mb-4">
                <h4 className="text-lg font-bold text-foreground">
                  {plan.display_name}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                  {plan.description}
                </p>
              </div>

              {/* Price */}
              <div className="mb-5">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-black text-foreground tabular-nums tracking-tight">
                    {formatBRL(displayPrice)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    /{isPackage ? "mes" : "usuario/mes"}
                  </span>
                </div>
                {isPackage && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {plan.included_users} inclusos + {formatBRL(plan.extra_user_price)}/extra
                  </p>
                )}
              </div>

              {/* User count stepper */}
              {isSelected && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center justify-between rounded-xl bg-background/60 border border-border/50 px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      Usuarios
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setUserCount(state.user_count - 1);
                        }}
                        disabled={state.user_count <= plan.min_users}
                        className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-foreground tabular-nums">
                        {state.user_count}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setUserCount(state.user_count + 1);
                        }}
                        className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {plan.min_users > 1 && (
                    <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
                      Minimo de {plan.min_users} usuarios
                    </p>
                  )}
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* ── Turbo add-on ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {turboApplies && turboAddon && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-border bg-card/50 p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    {turboAddon.display_name}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatBRL(turboAddon.price_monthly)}/{turboAddon.unit_label}/mes
                  </p>
                </div>
              </div>
              <Switch
                checked={state.turbo_count > 0}
                onCheckedChange={(checked) =>
                  setTurboCount(checked ? 1 : 0)
                }
              />
            </div>

            {/* Turbo count stepper */}
            <AnimatePresence>
              {state.turbo_count > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 pt-4 border-t border-border/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Copilots Turbo
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setTurboCount(state.turbo_count - 1)
                        }
                        disabled={state.turbo_count <= 1}
                        className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-foreground tabular-nums">
                        {state.turbo_count}
                      </span>
                      <button
                        onClick={() =>
                          setTurboCount(state.turbo_count + 1)
                        }
                        className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Coupon ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card/50 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Cupom de desconto
          </span>
        </div>

        {state.coupon_id ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-between rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">
                {state.coupon_code.toUpperCase()} (-{state.coupon_discount_pct}%)
              </span>
            </div>
            <button
              onClick={handleClearCoupon}
              className="h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ) : (
          <div className="flex gap-2">
            <Input
              placeholder="Codigo do cupom"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleApplyCoupon()}
              className="h-10 flex-1 uppercase"
              disabled={couponValidation.isValidating}
            />
            <Button
              variant="outline"
              onClick={handleApplyCoupon}
              disabled={
                !couponInput.trim() ||
                !state.plan_slug ||
                couponValidation.isValidating
              }
              className="h-10 px-5 shrink-0"
            >
              {couponValidation.isValidating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Aplicar"
              )}
            </Button>
          </div>
        )}

        {/* Coupon error */}
        <AnimatePresence>
          {couponValidation.result && !couponValidation.result.valid && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 text-xs text-destructive"
            >
              {couponValidation.result.error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── Continue button ───────────────────────────────────────────── */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={onContinue}
          disabled={!canContinue}
          className="h-12 px-8 gradient-primary gradient-primary-hover text-white font-semibold border-0 text-sm"
        >
          Continuar
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
