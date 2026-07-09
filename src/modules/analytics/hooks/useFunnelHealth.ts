import { useQuery } from "@tanstack/react-query";
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

export interface FunnelHealthData {
  cohort_total: number;
  stages: FunnelHealthStages;
  tiers: FunnelHealthTiers;
  depth: FunnelHealthDepth;
  sellers: FunnelHealthSeller[];
}

/** Intervalo do mês em UTC — mesmo critério do useDashboardMetrics. */
function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

export function useFunnelHealth(month: number, year: number) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["funnel-health", month, year, organizationId],
    queryFn: async (): Promise<FunnelHealthData | null> => {
      if (!organizationId) return null;
      const { startStr, endStr } = getMonthRangeUTC(month, year);

      // RPC nova — ainda fora do types.ts auto-gerado; regen pendente.
      const { data, error } = await supabase.rpc("get_funnel_health" as never, {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
      } as never);

      if (error) throw error;
      return data as unknown as FunnelHealthData;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
