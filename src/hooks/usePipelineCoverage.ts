import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { calculatePipelineCoverage } from "@/lib/metrics-calculations";
import type { PipelineCoverageResult } from "@/lib/metrics-calculations";

interface UsePipelineCoverageOptions {
  month: number;
  year: number;
  memberId?: string | null;
}

export function usePipelineCoverage({ month, year, memberId }: UsePipelineCoverageOptions) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["pipeline-coverage", organizationId, month, year, memberId ?? "team"],
    queryFn: async (): Promise<PipelineCoverageResult> => {
      const { data, error } = await supabase.rpc("get_pipeline_coverage", {
        p_org_id: organizationId!,
        p_month: month,
        p_year: year,
        p_member_id: memberId ?? null,
      });

      if (error) throw error;

      const raw = data as { open_value: number; goal_value: number };
      return calculatePipelineCoverage({
        openPipelineValue: raw.open_value,
        monthlyGoal: raw.goal_value > 0 ? raw.goal_value : null,
      });
    },
    enabled: !!organizationId,
    staleTime: 2 * 60 * 1000,
  });
}
