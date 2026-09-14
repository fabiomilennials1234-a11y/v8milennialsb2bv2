import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const BILLING_PAGE_SIZE = 10;

/** O chamador passa exclusivamente a organização do contexto autenticado. RLS preservada. */
export function useBillingAccount(
  organizationId: string | null,
  enabled: boolean,
  page: number,
) {
  const ready = enabled && !!organizationId;
  const account = useQuery({
    queryKey: ["billing-account", organizationId],
    enabled: ready,
    queryFn: async () => {
      if (!organizationId) throw new Error("Organização não selecionada");
      const [org, subscription] = await Promise.all([
        supabase
          .from("organizations")
          .select(
            "name, subscription_plan, subscription_status, subscription_expires_at, billing_override",
          )
          .eq("id", organizationId)
          .single(),
        supabase
          .from("org_subscriptions")
          .select(
            "id, plan_id, billing_cycle, final_amount_cents, user_count, started_at, renews_at, payment_method, cancelled_at",
          )
          .eq("organization_id", organizationId)
          .is("cancelled_at", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (org.error) throw org.error;
      if (subscription.error) throw subscription.error;
      const planId = subscription.data?.plan_id;
      let planName = org.data.subscription_plan;
      if (planId) {
        const plan = await supabase
          .from("subscription_plans")
          .select("display_name")
          .eq("id", planId)
          .maybeSingle();
        if (plan.error) throw plan.error;
        planName = plan.data?.display_name ?? planName;
      }
      return {
        organization: org.data,
        subscription: subscription.data,
        planName,
      };
    },
  });
  const history = useQuery({
    queryKey: ["billing-history", organizationId, page],
    enabled: ready,
    queryFn: async () => {
      if (!organizationId) throw new Error("Organização não selecionada");
      const result = await supabase
        .from("payment_history")
        .select(
          "id, amount, status, billing_cycle, billing_type, created_at, paid_at, period_start, period_end, invoice_url, receipt_url",
          { count: "exact" },
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * BILLING_PAGE_SIZE, (page + 1) * BILLING_PAGE_SIZE - 1);
      if (result.error) throw result.error;
      return { rows: result.data, count: result.count ?? 0 };
    },
  });
  // Não usar o fallback permissivo de useOrgQuotas: indisponível não significa ilimitado.
  const quotas = useQuery({
    queryKey: ["billing-quotas", organizationId],
    enabled: ready,
    queryFn: async () => {
      if (!organizationId) throw new Error("Organização não selecionada");
      const result = await supabase.rpc("org_resolve_all_quotas", {
        p_org_id: organizationId,
      });
      if (result.error) throw result.error;
      return result.data;
    },
  });
  return { account, history, quotas };
}
