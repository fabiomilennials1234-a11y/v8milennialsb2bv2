import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import type { PortfolioPurchase } from "../components/client-portfolio/portfolio-model";
import type { SaleEventRow } from "./useLeadsSalesMetrics";

/** Same source precedence as mergeDataMetrics: CRM sales win; never add ERP twice. */
export function portfolioSalesHistory(
  rows: SaleEventRow[],
): PortfolioPurchase[] {
  const reversed = new Set(
    rows.flatMap((r) => (r.reversed_event_id ? [r.reversed_event_id] : [])),
  );
  return rows
    .filter(
      (r) =>
        !r.reversed_event_id &&
        !reversed.has(r.id) &&
        (!r.event_type || r.event_type === "sale") &&
        r.sold_at &&
        Number.isFinite(Date.parse(r.sold_at)),
    )
    .map((r) => ({
      id: r.id,
      date: r.sold_at!,
      value: Number(r.sale_value) || 0,
      source: "CRM" as const,
    }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
export function useClientPortfolioPurchases(leadId: string | null) {
  const { organizationId, isReady } = useOrganization();
  return useQuery({
    queryKey: ["client-portfolio-purchases", organizationId, leadId],
    enabled: isReady && !!organizationId && !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<PortfolioPurchase[]> => {
      if (!organizationId || !leadId) return [];
      // Read every reversal before selecting latest sales; PostgREST's row cap
      // must not silently resurrect an old cancelled purchase.
      const rows: SaleEventRow[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from("sale_events")
          .select(
            "id, lead_id, event_type, sale_value, sold_at, reversed_event_id",
          )
          .eq("organization_id", organizationId)
          .eq("lead_id", leadId)
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
      }
      const sales = portfolioSalesHistory(rows);
      if (sales.length) return sales;
      const clients = await supabase
        .from("upsell_clients")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("lead_id", leadId);
      if (clients.error) throw clients.error;
      const ids = (clients.data ?? []).map((c) => c.id);
      if (!ids.length) return [];
      const purchases: PortfolioPurchase[] = [];
      for (let from = 0; ; from += 500) {
        const orders = await supabase
          .from("upsell_orders")
          .select("id, sold_at, sale_value")
          .eq("organization_id", organizationId)
          .in("client_id", ids)
          .eq("approval_status", "approved")
          .order("sold_at", { ascending: false })
          .order("id")
          .range(from, from + 499);
        if (orders.error) throw orders.error;
        purchases.push(...(orders.data ?? []).filter(o => o.sold_at).map(o => ({
          id: o.id, date: o.sold_at!, value: Number(o.sale_value) || 0,
          source: "Carteira" as const,
        })));
        if ((orders.data?.length ?? 0) < 500) break;
      }
      return purchases;
    },
  });
}
