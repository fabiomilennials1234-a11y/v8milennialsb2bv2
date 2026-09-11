import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HistoricalSaleInput { value: number; date: string }

export function useRegisterHistoricalSales(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, sales }: { requestId: string; sales: HistoricalSaleInput[] }) => {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        name: "registrar_vendas_historicas",
        args: { p_lead_id: string; p_request_id: string; p_sales: HistoricalSaleInput[] },
      ) => PromiseLike<{ data: string[] | null; error: { message: string; code?: string } | null }>;
      const { data, error } = await rpc("registrar_vendas_historicas", {
        p_lead_id: leadId, p_request_id: requestId, p_sales: sales,
      });
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: async () => {
      await Promise.all([
        "leads", "leads-count", "lead_by_id", "lead-detail", "lead-card-metrics", "leads-deals", "leads-reorder-cycle", "leads-carteira-metrics",
        "upsell-clients", "upsell-orders", "upsell_clients", "upsell_orders", "carteira_orders", "portfolio-clients", "portfolio-kpis",
        "portfolio-trends", "lead-timeline", "leads-sales-metrics", "metrics-studio",
      ].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
    },
  });
}
