import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  calculatePricing,
  formatBRL,
  type PlanConfig,
  type AddonConfig,
  type PricingBreakdown,
} from "@/lib/pricing-calculator";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeamMember {
  name: string;
  email: string;
}

export interface CheckoutState {
  step: 1 | 2 | 3;
  plan_slug: string | null;
  billing_cycle: "monthly" | "semester" | "annual";
  user_count: number;
  turbo_count: number;
  coupon_code: string;
  coupon_discount_pct: number;
  coupon_id: string | null;
  org_name: string;
  team_members: TeamMember[];
  payment_method: "pix" | "credit_card" | null;
  payment_id: string | null;
  qr_code_base64: string | null;
  pix_payload: string | null;
  payment_status:
    | "idle"
    | "processing"
    | "awaiting_pix"
    | "confirmed"
    | "error";
  error: string | null;
}

export interface PlanRow {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_per_user_monthly: number | null;
  base_price_monthly: number | null;
  min_users: number;
  included_users: number;
  included_copilots: number;
  extra_user_price: number;
  discount_semester_pct: number;
  discount_annual_pct: number;
  discount_volume_pct: number;
  discount_volume_min: number;
  features: Record<string, boolean>;
  position: number | null;
}

export interface AddonRow {
  id: string;
  slug: string;
  display_name: string;
  price_monthly: number;
  unit_label: string;
  applicable_plans: string[];
  is_active: boolean;
}

const INITIAL_STATE: CheckoutState = {
  step: 1,
  plan_slug: null,
  billing_cycle: "monthly",
  user_count: 2,
  turbo_count: 0,
  coupon_code: "",
  coupon_discount_pct: 0,
  coupon_id: null,
  org_name: "",
  team_members: [],
  payment_method: null,
  payment_id: null,
  qr_code_base64: null,
  pix_payload: null,
  payment_status: "idle",
  error: null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCheckout() {
  const [searchParams] = useSearchParams();
  const { user, session } = useAuth();

  const [state, setState] = useState<CheckoutState>(() => {
    const planParam = searchParams.get("plan");
    return {
      ...INITIAL_STATE,
      plan_slug: planParam,
    };
  });

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  // ── Fetch plans & addons ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoadingPlans(true);

      const [plansRes, addonsRes] = await Promise.all([
        supabase
          .from("subscription_plans")
          .select("*")
          .eq("is_active", true)
          .order("position", { ascending: true }),
        supabase.from("plan_addons" as any).select("*").eq("is_active", true),
      ]);

      if (cancelled) return;

      if (plansRes.data) {
        const mapped: PlanRow[] = (plansRes.data as any[]).map((row) => ({
          id: row.id,
          name: row.name,
          display_name: row.display_name,
          description: row.description,
          price_per_user_monthly: row.price_per_user_monthly
            ? Number(row.price_per_user_monthly)
            : null,
          base_price_monthly: row.base_price_monthly
            ? Number(row.base_price_monthly)
            : null,
          min_users: Number(row.min_users ?? 1),
          included_users: Number(row.included_users ?? 0),
          included_copilots: Number(row.included_copilots ?? 0),
          extra_user_price: Number(row.extra_user_price ?? 0),
          discount_semester_pct: Number(row.discount_semester_pct ?? 10),
          discount_annual_pct: Number(row.discount_annual_pct ?? 15),
          discount_volume_pct: Number(row.discount_volume_pct ?? 35),
          discount_volume_min: Number(row.discount_volume_min ?? 10),
          features:
            typeof row.features === "object" ? row.features : {},
          position: row.position,
        }));
        setPlans(mapped);

        // If plan was pre-selected via URL, enforce min_users
        if (!cancelled) {
          setState((prev) => {
            const selected = mapped.find((p) => p.name === prev.plan_slug);
            if (selected) {
              return {
                ...prev,
                user_count: Math.max(prev.user_count, selected.min_users),
              };
            }
            // Default to first plan if none specified
            if (!prev.plan_slug && mapped.length > 0) {
              return {
                ...prev,
                plan_slug: mapped[0].name,
                user_count: mapped[0].min_users,
              };
            }
            return prev;
          });
        }
      }

      if (addonsRes.data) {
        setAddons(
          (addonsRes.data as any[]).map((row) => ({
            id: row.id,
            slug: row.slug,
            display_name: row.display_name,
            price_monthly: Number(row.price_monthly),
            unit_label: row.unit_label,
            applicable_plans: row.applicable_plans ?? [],
            is_active: row.is_active,
          })),
        );
      }

      setLoadingPlans(false);
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Initialize team_members with authenticated user ──────────────────────
  useEffect(() => {
    if (user) {
      setState((prev) => {
        if (prev.team_members.length > 0) return prev;
        return {
          ...prev,
          team_members: [
            {
              name: user.user_metadata?.full_name ?? "",
              email: user.email ?? "",
            },
          ],
        };
      });
    }
  }, [user]);

  // ── Derived: current plan config for calculator ──────────────────────────
  const currentPlan = useMemo(
    () => plans.find((p) => p.name === state.plan_slug) ?? null,
    [plans, state.plan_slug],
  );

  const turboAddon = useMemo(
    () => addons.find((a) => a.slug === "turbo") ?? null,
    [addons],
  );

  const planConfig: PlanConfig | null = useMemo(() => {
    if (!currentPlan) return null;
    return {
      slug: currentPlan.name,
      price_per_user_monthly: currentPlan.price_per_user_monthly,
      base_price_monthly: currentPlan.base_price_monthly,
      min_users: currentPlan.min_users,
      included_users: currentPlan.included_users,
      extra_user_price: currentPlan.extra_user_price,
      discount_semester_pct: currentPlan.discount_semester_pct,
      discount_annual_pct: currentPlan.discount_annual_pct,
      discount_volume_pct: currentPlan.discount_volume_pct,
      discount_volume_min: currentPlan.discount_volume_min,
    };
  }, [currentPlan]);

  const addonConfig: AddonConfig | null = useMemo(() => {
    if (!turboAddon || state.turbo_count === 0) return null;
    return {
      slug: turboAddon.slug,
      price_monthly: turboAddon.price_monthly,
      applicable_plans: turboAddon.applicable_plans,
    };
  }, [turboAddon, state.turbo_count]);

  const pricing: PricingBreakdown | null = useMemo(() => {
    if (!planConfig) return null;
    return calculatePricing({
      plan: planConfig,
      billing_cycle: state.billing_cycle,
      user_count: state.user_count,
      turbo_count: state.turbo_count,
      addon: addonConfig,
      coupon_discount_pct: state.coupon_discount_pct,
    });
  }, [
    planConfig,
    state.billing_cycle,
    state.user_count,
    state.turbo_count,
    addonConfig,
    state.coupon_discount_pct,
  ]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const setStep = useCallback((step: 1 | 2 | 3) => {
    setState((prev) => ({ ...prev, step, error: null }));
  }, []);

  const setPlan = useCallback(
    (slug: string) => {
      const plan = plans.find((p) => p.name === slug);
      if (!plan) return;
      setState((prev) => {
        const newUserCount = Math.max(prev.user_count, plan.min_users);
        // If switching to a plan where turbo doesn't apply, reset turbo
        const turboApplies =
          turboAddon?.applicable_plans.includes(slug) ?? false;
        return {
          ...prev,
          plan_slug: slug,
          user_count: newUserCount,
          turbo_count: turboApplies ? prev.turbo_count : 0,
          error: null,
        };
      });
    },
    [plans, turboAddon],
  );

  const setBillingCycle = useCallback(
    (cycle: "monthly" | "semester" | "annual") => {
      setState((prev) => ({ ...prev, billing_cycle: cycle }));
    },
    [],
  );

  const setUserCount = useCallback(
    (count: number) => {
      const minUsers = currentPlan?.min_users ?? 1;
      const clamped = Math.min(Math.max(count, minUsers), 100);
      setState((prev) => ({ ...prev, user_count: clamped }));
    },
    [currentPlan],
  );

  const setTurboCount = useCallback((count: number) => {
    setState((prev) => ({ ...prev, turbo_count: Math.min(Math.max(0, count), 10) }));
  }, []);

  const applyCoupon = useCallback(
    (code: string, discount_pct: number, coupon_id: string | null) => {
      setState((prev) => ({
        ...prev,
        coupon_code: code,
        coupon_discount_pct: discount_pct,
        coupon_id,
      }));
    },
    [],
  );

  const clearCoupon = useCallback(() => {
    setState((prev) => ({
      ...prev,
      coupon_code: "",
      coupon_discount_pct: 0,
      coupon_id: null,
    }));
  }, []);

  const setOrgName = useCallback((name: string) => {
    setState((prev) => ({ ...prev, org_name: name }));
  }, []);

  const addTeamMember = useCallback(() => {
    setState((prev) => ({
      ...prev,
      team_members: [...prev.team_members, { name: "", email: "" }],
    }));
  }, []);

  const removeTeamMember = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      team_members: prev.team_members.filter((_, i) => i !== index),
    }));
  }, []);

  const updateTeamMember = useCallback(
    (index: number, field: "name" | "email", value: string) => {
      setState((prev) => ({
        ...prev,
        team_members: prev.team_members.map((m, i) =>
          i === index ? { ...m, [field]: value } : m,
        ),
      }));
    },
    [],
  );

  const submitPayment = useCallback(
    async (
      method: "pix" | "credit_card",
      cardData?: {
        number: string;
        expiry: string;
        cvv: string;
        holder_name: string;
      },
    ) => {
      if (!currentPlan || !pricing || !session) return;

      setState((prev) => ({
        ...prev,
        payment_method: method,
        payment_status: "processing",
        error: null,
      }));

      try {
        const body = {
          plan_slug: state.plan_slug,
          billing_cycle: state.billing_cycle,
          user_count: state.user_count,
          turbo_count: state.turbo_count,
          coupon_id: state.coupon_id,
          coupon_code: state.coupon_code,
          org_name: state.org_name,
          team_members: state.team_members,
          payment_method: method,
          card_data: method === "credit_card" ? cardData : undefined,
          pricing: {
            total_monthly: pricing.total_monthly,
            total_cycle: pricing.total_cycle,
            cycle_months: pricing.cycle_months,
          },
        };

        const { data, error } = await supabase.functions.invoke(
          "checkout-create-payment",
          { body },
        );

        if (error) {
          setState((prev) => ({
            ...prev,
            payment_status: "error",
            error: "Erro ao processar pagamento. Tente novamente.",
          }));
          return;
        }

        if (data?.error) {
          setState((prev) => ({
            ...prev,
            payment_status: "error",
            error: data.error,
          }));
          return;
        }

        if (method === "pix") {
          setState((prev) => ({
            ...prev,
            payment_id: data.payment_id,
            qr_code_base64: data.qr_code ?? null,
            pix_payload: data.qr_code_payload ?? null,
            payment_status: "awaiting_pix",
          }));
        } else {
          // Refresh session so JWT has updated metadata after card confirmation
          if (data.status === "confirmed") {
            await supabase.auth.refreshSession();
          }
          setState((prev) => ({
            ...prev,
            payment_id: data.payment_id,
            payment_status: data.status === "confirmed" ? "confirmed" : "processing",
          }));
        }
      } catch {
        setState((prev) => ({
          ...prev,
          payment_status: "error",
          error: "Erro de conexao. Verifique sua internet e tente novamente.",
        }));
      }
    },
    [currentPlan, pricing, session, state],
  );

  // ── canContinueToStep helpers ────────────────────────────────────────────

  const canGoToStep2 = Boolean(state.plan_slug && currentPlan);
  const canGoToStep3 = canGoToStep2 && state.org_name.trim().length >= 2;

  return {
    state,
    plans,
    addons,
    loadingPlans,
    currentPlan,
    turboAddon,
    pricing,
    canGoToStep2,
    canGoToStep3,

    // Actions
    setStep,
    setPlan,
    setBillingCycle,
    setUserCount,
    setTurboCount,
    applyCoupon,
    clearCoupon,
    setOrgName,
    addTeamMember,
    removeTeamMember,
    updateTeamMember,
    submitPayment,
  };
}

export { formatBRL };
export type { PricingBreakdown };
