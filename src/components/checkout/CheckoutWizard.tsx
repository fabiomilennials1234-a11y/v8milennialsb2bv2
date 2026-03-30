import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useCheckout } from "@/hooks/useCheckout";
import { PlanSelector } from "./PlanSelector";
import { OrgSetup } from "./OrgSetup";
import { PaymentStep } from "./PaymentStep";
import { CheckoutSummary } from "./CheckoutSummary";
import torqueLogo from "@/assets/torque-logo.png";

// ─── Step config ──────────────────────────────────────────────────────────────

const STEPS = [
  { num: 1 as const, label: "Escolha seu plano" },
  { num: 2 as const, label: "Configure sua equipe" },
  { num: 3 as const, label: "Pagamento" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function CheckoutWizard() {
  const navigate = useNavigate();
  const checkout = useCheckout();
  const { state, plans, loadingPlans, currentPlan, turboAddon, pricing } =
    checkout;

  // ── Step navigation ──────────────────────────────────────────────────────
  const goToStep1 = useCallback(() => checkout.setStep(1), [checkout]);
  const goToStep2 = useCallback(() => {
    if (checkout.canGoToStep2) checkout.setStep(2);
  }, [checkout]);
  const goToStep3 = useCallback(() => {
    if (checkout.canGoToStep3) checkout.setStep(3);
  }, [checkout]);

  const handlePaymentConfirmed = useCallback(() => {
    setTimeout(() => {
      navigate("/checkout/success", {
        state: {
          plan_name: currentPlan?.display_name,
          org_name: state.org_name,
        },
      });
    }, 1500);
  }, [navigate, currentPlan, state.org_name]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loadingPlans) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Carregando planos...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <img
            src={torqueLogo}
            alt="Torque CRM"
            className="h-7 object-contain"
          />
          <div className="text-xs text-muted-foreground/50">
            Checkout seguro
          </div>
        </div>
      </header>

      {/* ── Progress bar ────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-2">
        <div className="flex items-center justify-center gap-0">
          {STEPS.map((step, index) => {
            const isActive = state.step === step.num;
            const isCompleted = state.step > step.num;

            return (
              <div key={step.num} className="flex items-center">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div
                    className={`
                      h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300
                      ${
                        isCompleted
                          ? "bg-primary text-white"
                          : isActive
                            ? "bg-primary/20 text-primary border-2 border-primary"
                            : "bg-muted text-muted-foreground"
                      }
                    `}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      step.num
                    )}
                  </div>
                  <span
                    className={`
                      mt-2 text-[11px] font-medium whitespace-nowrap
                      ${isActive || isCompleted ? "text-foreground" : "text-muted-foreground/60"}
                    `}
                  >
                    {step.label}
                  </span>
                </div>

                {/* Connector */}
                {index < STEPS.length - 1 && (
                  <div
                    className={`
                      w-16 sm:w-24 h-[2px] mx-3 mb-6 rounded-full transition-colors duration-300
                      ${state.step > step.num ? "bg-primary" : "bg-border"}
                    `}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Content area (2-col on desktop) ─────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-20">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Step content (left) */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              {state.step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25 }}
                >
                  <PlanSelector
                    state={state}
                    plans={plans}
                    turboAddon={turboAddon}
                    setPlan={checkout.setPlan}
                    setBillingCycle={checkout.setBillingCycle}
                    setUserCount={checkout.setUserCount}
                    setTurboCount={checkout.setTurboCount}
                    applyCoupon={checkout.applyCoupon}
                    clearCoupon={checkout.clearCoupon}
                    onContinue={goToStep2}
                    canContinue={checkout.canGoToStep2}
                  />
                </motion.div>
              )}

              {state.step === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25 }}
                >
                  <OrgSetup
                    state={state}
                    setOrgName={checkout.setOrgName}
                    addTeamMember={checkout.addTeamMember}
                    setTeamMembersCount={checkout.setTeamMembersCount}
                    removeTeamMember={checkout.removeTeamMember}
                    updateTeamMember={checkout.updateTeamMember}
                    onBack={goToStep1}
                    onContinue={goToStep3}
                    canContinue={checkout.canGoToStep3}
                  />
                </motion.div>
              )}

              {state.step === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25 }}
                >
                  <PaymentStep
                    state={state}
                    pricing={pricing}
                    submitPayment={checkout.submitPayment}
                    onBack={() => checkout.setStep(2)}
                    onPaymentConfirmed={handlePaymentConfirmed}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Summary sidebar (right) — sticky on desktop, bottom on mobile */}
          <div className="lg:w-[340px] lg:shrink-0">
            <div className="lg:sticky lg:top-24">
              <CheckoutSummary
                plan={currentPlan}
                billingCycle={state.billing_cycle}
                userCount={state.user_count}
                turboCount={state.turbo_count}
                turboAddon={turboAddon}
                pricing={pricing}
                couponCode={state.coupon_code}
                couponDiscountPct={state.coupon_discount_pct}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
