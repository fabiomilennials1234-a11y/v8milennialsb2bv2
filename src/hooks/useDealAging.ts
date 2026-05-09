import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import type { PipelineType } from "./usePipelineStages";

export interface StageAgingConfig {
  stageKey: string;
  maxDays: number | null;
}

/**
 * Fetches max_days_in_stage for each stage of a pipeline.
 * Returns a map: stageKey -> maxDays (or null if unlimited).
 */
export function useStageAgingConfig(pipelineType: PipelineType) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["stage_aging_config", organizationId, pipelineType],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("pipeline_stages")
        .select("stage_key, max_days_in_stage")
        .eq("organization_id", organizationId)
        .eq("pipeline_type", pipelineType)
        .eq("is_active", true);

      if (error) throw error;

      const map: Record<string, number | null> = {};
      for (const row of data || []) {
        map[row.stage_key] = row.max_days_in_stage ?? null;
      }
      return map;
    },
  });
}

/**
 * Calculates deal aging for a single card.
 * @returns days in stage, whether stagnant, and severity level.
 */
export function calcDealAging(
  stageEnteredAt: string | null | undefined,
  maxDays: number | null | undefined,
): {
  daysInStage: number;
  isStagnant: boolean;
  severity: "none" | "warning" | "critical";
} {
  if (!stageEnteredAt) {
    return { daysInStage: 0, isStagnant: false, severity: "none" };
  }

  const daysInStage = Math.floor(
    (Date.now() - new Date(stageEnteredAt).getTime()) / 86400000
  );

  if (maxDays == null || maxDays <= 0) {
    // No limit configured — use default thresholds
    if (daysInStage >= 14) return { daysInStage, isStagnant: true, severity: "critical" };
    if (daysInStage >= 7) return { daysInStage, isStagnant: true, severity: "warning" };
    return { daysInStage, isStagnant: false, severity: "none" };
  }

  if (daysInStage >= maxDays) {
    return {
      daysInStage,
      isStagnant: true,
      severity: daysInStage >= maxDays * 2 ? "critical" : "warning",
    };
  }

  return { daysInStage, isStagnant: false, severity: "none" };
}

/**
 * Hook that wraps calcDealAging for convenience in components.
 */
export function useDealAging(stageEnteredAt: string | null | undefined, maxDays?: number | null) {
  return useMemo(
    () => calcDealAging(stageEnteredAt, maxDays),
    [stageEnteredAt, maxDays]
  );
}
