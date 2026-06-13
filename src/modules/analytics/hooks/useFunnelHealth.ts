import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

/**
 * Indicador de Saúde do Funil — coorte por período de criação do lead.
 * Semântica em CONTEXT.md (Funnel Health Indicator); RPC get_funnel_health
 * (migration 20261127000000), coberta por tests/integration/get-funnel-health.test.ts.
 */

export interface FunnelHealthStages {
  entraram: number;
  avaliados: number;
  bons: number;
  reuniao: number;
  compareceram: number;
  compraram: number;
}

export interface FunnelHealthTiers {
  diamante: number;
  ouro: number;
  prata: number;
  bronze: number;
  desqualificado: number;
}

export interface FunnelHealthDepth {
  pre_only: number;
  final: number;
}

export interface FunnelHealthSeller {
  team_member_id: string | null;
  name: string | null;
  vinculados: number;
  avaliados: number;
  bons: number;
  reuniao: number;
  compareceram: number;
  compraram: number;
}

export interface FunnelHealthCycles {
  sales_count: number;
  lead_to_sale_days: number | null;
  meeting_sales_count: number;
  meeting_to_sale_days: number | null;
  lead_to_meeting_days: number | null;
}

export interface FunnelHealthData {
  cohort_total: number;
  stages: FunnelHealthStages;
  tiers: FunnelHealthTiers;
  depth: FunnelHealthDepth;
  sellers: FunnelHealthSeller[];
  cycles?: FunnelHealthCycles;
}

export interface FunnelHealthRange {
  start: Date;
  end: Date;
}

/**
 * Mesmo contrato de range do useCommandMetrics — segue o período do Comando.
 * `origins` (multi-select) filtra a coorte por leads.origin; vazio = todas.
 */
export function useFunnelHealth({ start, end }: FunnelHealthRange, origins: string[] = []) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const startStr = start.toISOString();
  const endStr = end.toISOString();

  return useQuery({
    queryKey: ["funnel-health", startStr, endStr, organizationId, [...origins].sort()],
    queryFn: async (): Promise<FunnelHealthData | null> => {
      if (!organizationId) return null;

      // RPC nova — ainda fora do types.ts auto-gerado; regen pendente.
      const { data, error } = await supabase.rpc("get_funnel_health" as never, {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        ...(origins.length > 0 ? { p_origins: origins } : {}),
      } as never);

      if (error) throw error;
      return data as unknown as FunnelHealthData;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
    // troca de filtro/período mantém os dados anteriores na tela (sem skeleton)
    placeholderData: keepPreviousData,
  });
}

export interface FunnelStageLead {
  id: string;
  name: string;
  company: string | null;
  tier: string | null;
  created_at: string;
  pre_vendas: string | null;
  proposta_stage: string | null;
  sale_value: number | null;
  meeting_date: string | null;
  held_at: string | null;
  whatsapp_stage: string | null;
}

/** Drill-down: leads de uma etapa da coorte (sheet da aba Saúde). */
export function useFunnelHealthStageLeads(
  { start, end }: FunnelHealthRange,
  stage: keyof FunnelHealthStages | null,
  origins: string[] = []
) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const startStr = start.toISOString();
  const endStr = end.toISOString();

  return useQuery({
    queryKey: ["funnel-health-stage-leads", startStr, endStr, stage, organizationId, [...origins].sort()],
    queryFn: async (): Promise<FunnelStageLead[]> => {
      if (!organizationId || !stage) return [];

      // RPC nova — ainda fora do types.ts auto-gerado; regen pendente.
      const { data, error } = await supabase.rpc("get_funnel_health_stage_leads" as never, {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_stage: stage,
        ...(origins.length > 0 ? { p_origins: origins } : {}),
      } as never);

      if (error) throw error;
      return (data ?? []) as unknown as FunnelStageLead[];
    },
    enabled: !!organizationId && !!stage,
    staleTime: 60_000,
  });
}
