import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { LeadsFilterParams } from "./useLeads";
import {
  clientPortfolioPageSchema,
  portfolioFilters,
  type PortfolioSegment,
  type PortfolioReorder,
} from "../lib/client-portfolio-contract";

export const PORTFOLIO_PAGE_SIZE = 50;
// Narrow adapter for an additive RPC, validated at runtime. Generated DB types
// are never edited by hand; replace this adapter after deployment/type generation.
interface RpcRequest {
  abortSignal: (
    signal: AbortSignal,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}
const portfolioRpc = supabase.rpc.bind(supabase) as unknown as (
  name: "client_portfolio_page",
  args: {
    p_organization_id: string;
    p_filters: ReturnType<typeof portfolioFilters>;
    p_limit: number;
    p_offset: number;
  },
) => RpcRequest;
export function useClientPortfolio(
  filters: LeadsFilterParams,
  segment: PortfolioSegment,
  reorder: PortfolioReorder,
  page: number,
) {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("leads", ["client-portfolio"]);
  useRealtimeSubscription("deals", ["client-portfolio", "leads-deals"]);
  useRealtimeSubscription("pipeline_entries", ["client-portfolio", "leads-deals"]);
  useRealtimeSubscription("pipeline_stages", ["client-portfolio", "leads-deals"]);
  useRealtimeSubscription("pipelines", ["client-portfolio", "leads-deals"]);
  useRealtimeSubscription("sale_events", [
    "client-portfolio",
    "client-portfolio-purchases",
  ]);
  useRealtimeSubscription("upsell_orders", [
    "client-portfolio",
    "client-portfolio-purchases",
  ]);
  useRealtimeSubscription("upsell_clients", ["client-portfolio"]);
  const params = portfolioFilters(filters, segment, reorder);
  return useQuery({
    queryKey: ["client-portfolio", organizationId, params, page],
    enabled: isReady && !!organizationId,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      if (!organizationId) throw new Error("Organização indisponível");
      const { data, error } = await portfolioRpc("client_portfolio_page", {
        p_organization_id: organizationId,
        p_filters: params,
        p_limit: PORTFOLIO_PAGE_SIZE,
        p_offset: Math.max(0, page) * PORTFOLIO_PAGE_SIZE,
      }).abortSignal(signal);
      if (error) throw error;
      return clientPortfolioPageSchema.parse(data);
    },
  });
}
