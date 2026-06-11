import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";

export interface FunnelStage {
  stage_id: string;
  stage_name: string;
  stage_order: number;
  total_entered: number;
  total_current: number;
  conversion_rate: number;
}

export interface PipelineVelocity {
  num_won: number;
  total_closed: number;
  win_rate: number;
  avg_deal_value: number;
}

export interface RevenueAttribution {
  origin: string;
  lead_count: number;
  won_count: number;
  total_revenue: number;
  avg_deal_value: number;
  conversion_rate: number;
}

export interface SalesCycleStage {
  from_stage: string;
  to_stage: string;
  avg_hours: number;
  median_hours: number;
  transition_count: number;
}

export interface WinLossItem {
  loss_reason: string;
  count: number;
  total_value: number;
  pct: number;
}

export function useFunnelConversion(pipelineType: string, startDate?: string, endDate?: string) {
  return useQuery<FunnelStage[]>({
    queryKey: ["funnel-conversion", pipelineType, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_funnel_conversion", {
        p_pipeline_type: pipelineType,
        p_start_date: startDate ?? null,
        p_end_date: endDate ?? null,
      });
      if (error) throw error;
      return (data ?? []) as FunnelStage[];
    },
  });
}

export function usePipelineVelocity(pipelineType: string, startDate?: string, endDate?: string) {
  return useQuery<PipelineVelocity>({
    queryKey: ["pipeline-velocity", pipelineType, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_pipeline_velocity", {
        p_pipeline_type: pipelineType,
        p_start_date: startDate ?? null,
        p_end_date: endDate ?? null,
      });
      if (error) throw error;
      return (data ?? {}) as PipelineVelocity;
    },
  });
}

export function useRevenueAttribution(startDate?: string, endDate?: string) {
  return useQuery<RevenueAttribution[]>({
    queryKey: ["revenue-attribution", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_revenue_attribution", {
        p_start_date: startDate ?? null,
        p_end_date: endDate ?? null,
      });
      if (error) throw error;
      return (data ?? []) as RevenueAttribution[];
    },
  });
}

export function useSalesCycleAnalysis(pipelineType?: string, startDate?: string, endDate?: string) {
  const { organizationId } = useOrganization();
  return useQuery<SalesCycleStage[]>({
    queryKey: ["sales-cycle", organizationId, pipelineType, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_sales_cycle_analysis", {
        p_org_id: organizationId,
        // null = todas as transições (jornada cross-pipe); consumidores que
        // querem um pipe específico passam o nome explícito
        p_pipeline_type: pipelineType ?? null,
        p_start_date: startDate ?? null,
        p_end_date: endDate ?? null,
      });
      if (error) throw error;
      return (data ?? []) as SalesCycleStage[];
    },
    enabled: !!organizationId,
  });
}

export function useWinLossAnalysis(startDate?: string, endDate?: string) {
  const { organizationId } = useOrganization();
  return useQuery<WinLossItem[]>({
    queryKey: ["win-loss", organizationId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_win_loss_analysis", {
        p_org_id: organizationId,
        p_start_date: startDate ?? null,
        p_end_date: endDate ?? null,
      });
      if (error) throw error;
      return (data ?? []) as WinLossItem[];
    },
  });
}
