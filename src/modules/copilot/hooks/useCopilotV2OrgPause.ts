/**
 * useCopilotV2OrgPause — org-level Copilot v2 kill-switch (W10).
 *
 * Reads copilot_v2_org_pause for the org, reflects changes in REALTIME (the
 * worker auto-pauses on the hard cost cap; an admin pauses/resumes manually), and
 * exposes 1-tap pause/resume mutations backed by copilot_v2_set_org_pause
 * (admin-guarded + audited server-side). Mirrors the phone-keyed useCopilotPause
 * pattern; the write authority lives in the SECURITY DEFINER RPC, never here.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";

/** Closed set — mirrors ORG_PAUSE_REASONS in _shared/copilot-v2/org-pause.ts. */
export type OrgPauseReason = "takeover" | "loop" | "teto" | "baixa_confianca";

export const ORG_PAUSE_REASON_LABEL: Record<OrgPauseReason, string> = {
  takeover: "Atendimento humano assumiu",
  loop: "Loop detectado",
  teto: "Teto de custo atingido",
  baixa_confianca: "Baixa confiança do agente",
};

// Manual kill-switch pauses until an admin resumes — a far-future bound the gate
// always reads as "paused" until cleared.
const PAUSE_UNTIL_RESUMED = "9999-12-31T00:00:00.000Z";

export interface CopilotV2OrgPauseState {
  isPaused: boolean;
  reason: OrgPauseReason | null;
  pauseOrg: (reason?: OrgPauseReason) => void;
  resumeOrg: () => void;
  isMutating: boolean;
}

export function useCopilotV2OrgPause(organizationId?: string | null): CopilotV2OrgPauseState {
  const queryClient = useQueryClient();
  // string[] (not (string|null)[]) — useRealtimeSubscription's key is typed string[].
  // The query is disabled when org is absent, so the "" placeholder never queries.
  const queryKey: string[] = ["copilot-v2-org-pause", organizationId ?? ""];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await (supabase.from as any)("copilot_v2_org_pause")
        .select("paused_until, reason")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
    enabled: !!organizationId,
    refetchInterval: 60_000,
  });

  // Realtime: reflect a pause/resume the instant it happens (no 60s wait).
  useRealtimeSubscription("copilot_v2_org_pause", queryKey);

  const setPause = useMutation({
    mutationFn: async (params: { until: string | null; reason: OrgPauseReason | null }) => {
      if (!organizationId) throw new Error("No organization");
      const { error } = await (supabase.rpc as any)("copilot_v2_set_org_pause", {
        p_org_id: organizationId,
        p_until: params.until,
        p_reason: params.reason,
        p_paused_by: null, // captured server-side from auth.uid()
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const pausedUntil = data?.paused_until ? new Date(data.paused_until) : null;
  const isPaused = pausedUntil !== null && pausedUntil > new Date();

  return {
    isPaused,
    reason: isPaused ? ((data?.reason ?? null) as OrgPauseReason | null) : null,
    pauseOrg: (reason: OrgPauseReason = "takeover") => setPause.mutate({ until: PAUSE_UNTIL_RESUMED, reason }),
    resumeOrg: () => setPause.mutate({ until: null, reason: null }),
    isMutating: setPause.isPending,
  };
}
