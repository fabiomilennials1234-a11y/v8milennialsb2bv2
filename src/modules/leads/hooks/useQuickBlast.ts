import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity/hooks/useTeamMembers";

export interface QuickBlastInput {
  instance_id: string;
  lead_ids: string[];
  message: string;
  delay_min_ms?: number;
  delay_max_ms?: number;
  max_leads?: number;
  scheduled_for?: string;
  image_url?: string;
  /**
   * Blast Audience refinements (#704), applied server-side before dispatch.
   * Omitted → no narrowing (backward compatible).
   * - exclude_blasted_within_days: drop leads already blasted within N days
   *   (contact recency; UI default 7). Must be a positive integer to engage.
   * - only_non_responders: keep only "não respondeu" leads — zero inbound
   *   since their most recent blast send.
   */
  exclude_blasted_within_days?: number;
  only_non_responders?: boolean;
}

export interface QuickBlastResult {
  ok: true;
  sender_job_id: string;
  uazapi_sender_id: string;
  count: number;
  /**
   * Per-reason skip breakdown. `noPhone`/`duplicates`/`overCap` come from the
   * dispatch engine; `alreadyContactedWithinWindow`/`replied` come from the
   * Blast Audience refinements (0 when no refinement narrowed the set);
   * `overDailyBudget` (ADR-0003, #706) is the count clipped by the Org-wide
   * Daily Blast Budget shared across every blast that day.
   */
  skipped: {
    noPhone: number;
    duplicates: number;
    overCap: number;
    alreadyContactedWithinWindow: number;
    replied: number;
    overDailyBudget: number;
  };
  /** Today's Daily Blast Budget headroom available to this blast before it
   *  consumed (`max(0, daily_blast_budget - usage_today)`). The wizard renders
   *  "X de Y — N acima do teto diário" from `count` / `remaining` / skipped. */
  remaining?: number;
}

/**
 * Fire a Quick Blast (Disparo Rápido) from a kanban/list lead selection.
 * Reuses the Mass Send dispatch core via the quick-blast-create edge function.
 */
export function useQuickBlast() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (input: QuickBlastInput) => {
      const { data, error } = await supabase.functions.invoke("quick-blast-create", {
        body: input,
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as QuickBlastResult;
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["uazapi_sender_jobs", teamMember.organization_id] });
      }
    },
  });
}

export interface QuickBlastPreview {
  ok: true;
  dry_run: true;
  count: number;
  skipped: {
    noPhone: number;
    duplicates: number;
    overCap: number;
    alreadyContactedWithinWindow: number;
    replied: number;
    overDailyBudget: number;
  };
  /** Today's Daily Blast Budget headroom (ADR-0003, #706). The preview reports
   *  the same clamp/remaining as a real send WITHOUT consuming budget. */
  remaining?: number;
}

/**
 * Preview a Quick Blast without dispatching — resolves the audience + Blast
 * Audience refinements server-side and returns the would-send count + skip
 * breakdown. Powers the Disparo wizard's live count. Creates no job.
 */
export function useQuickBlastPreview() {
  return useMutation({
    mutationFn: async (input: QuickBlastInput): Promise<QuickBlastPreview> => {
      const { data, error } = await supabase.functions.invoke("quick-blast-create", {
        body: { ...input, message: input.message ?? "", dry_run: true },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as QuickBlastPreview;
    },
  });
}
