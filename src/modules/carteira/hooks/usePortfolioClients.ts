import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export interface PortfolioClientRow {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  health_score: number | null;
  health_status: string | null;
  segment: string | null;
  avg_ticket: number | null;
  days_since_last_order: number | null;
  reorder_cycle_days: number | null;
  next_order_expected: string | null;
  order_count: number | null;
  lifetime_value: number | null;
  lead_id: string | null;
  trend: string | null;
  churn_probability: number | null;
  /**
   * Código do cliente no ERP de origem. Entra na projeção da RPC em
   * `20270921000000` — o mesmo número que o vendedor digita no Toth. NULL para
   * cliente sem ERP; o rótulo (`erpLabel`) degrada para o nome puro.
   */
  external_id: string | null;
}

export interface PortfolioClientsResponse {
  rows: PortfolioClientRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export type SortColumn =
  | "name"
  | "health_score"
  | "avg_ticket"
  | "days_since_last_order"
  | "next_order_expected"
  | "lifetime_value"
  | "order_count"
  | "churn_probability";

export interface UsePortfolioClientsParams {
  filter?: string;
  search?: string;
  sortBy?: SortColumn;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function usePortfolioClients(params: UsePortfolioClientsParams = {}) {
  const { organizationId } = useOrganization();
  const {
    filter = "all",
    search = "",
    sortBy = "name",
    sortDir = "asc",
    page = 1,
    pageSize = 50,
  } = params;

  return useQuery({
    queryKey: [
      "portfolio-clients",
      organizationId,
      { filter, search, sortBy, sortDir, page, pageSize },
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_portfolio_clients", {
        p_org_id: organizationId!,
        p_filter: filter,
        p_search: search,
        p_sort_by: sortBy,
        p_sort_dir: sortDir,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as PortfolioClientsResponse;
    },
    enabled: !!organizationId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
