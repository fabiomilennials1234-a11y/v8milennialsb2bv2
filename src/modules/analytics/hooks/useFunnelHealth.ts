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

export interface FunnelHealthRange {
  start: Date;
  end: Date;
}

/** Mesmo contrato de range do useCommandMetrics — segue o período do Comando. */
export function useFunnelHealth({ start, end }: FunnelHealthRange) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const startStr = start.toISOString();
  const endStr = end.toISOString();

  return useQuery({
    queryKey: ["funnel-health", startStr, endStr, organizationId],
    queryFn: async (): Promise<FunnelHealthData | null> => {
      if (!organizationId) return null;

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
