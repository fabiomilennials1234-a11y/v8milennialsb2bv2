/**
 * useBlastPlans — create / list / monitor / control Blast Plans (#707).
 *
 * A Blast Plan is an auto-batched Mass Send (ADR-0003): a frozen audience drained
 * over consecutive days. Backend: blast-plan-create (freezes snapshot + fires lot
 * 1), blast-plan-release (daily cron), blast-plan-control (pause/resume/cancel).
 * Tables blast_plans + blast_plan_recipients are RLS-scoped to the caller's org.
 *
 * `as any` on the table names: blast_plans / blast_plan_recipients post-date the
 * last generated types.ts (regen after the migration applies). Same house pattern
 * as useStageLeadIds / useTrashLeads.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

export type BlastPlanStatus = "active" | "paused" | "completed" | "cancelled";

export interface BlastPlan {
  id: string;
  organization_id: string;
  instance_id: string;
  status: BlastPlanStatus;
  message: string;
  image_url: string | null;
  total_recipients: number;
  lots_total: number;
  lots_released: number;
  release_time: string;
  next_release_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlastPlanLotBreakdown {
  lotIndex: number;
  date: string;
  count: number;
}

export interface CreateBlastPlanInput {
  instance_id: string;
  lead_ids: string[];
  message: string;
  delay_min_ms?: number;
  delay_max_ms?: number;
  image_url?: string;
  exclude_blasted_within_days?: number;
  only_non_responders?: boolean;
  /** Time-of-day (HH:MM) the daily releaser fires; defaults server-side to 09:00. */
  release_time?: string;
  /** Audience provenance, recorded for the panel ("Estágio Novo", etc.). */
  source?: Record<string, unknown>;
}

export interface CreateBlastPlanResult {
  ok: true;
  plan_id: string;
  total_recipients: number;
  lots_total: number;
  breakdown: BlastPlanLotBreakdown[];
}

/** Create a Blast Plan: freezes the audience snapshot and fires lot 1 today. */
export function useCreateBlastPlan() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (input: CreateBlastPlanInput): Promise<CreateBlastPlanResult> => {
      const { data, error } = await supabase.functions.invoke("blast-plan-create", { body: input });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as CreateBlastPlanResult;
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["blast_plans", teamMember.organization_id] });
      }
    },
  });
}

/** List the org's Blast Plans (RLS-scoped), newest first. */
export function useBlastPlans() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  return useQuery({
    queryKey: ["blast_plans", orgId],
    queryFn: async (): Promise<BlastPlan[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("blast_plans" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BlastPlan[];
    },
    enabled: !!orgId,
  });
}

export interface BlastPlanProgress {
  total: number;
  sent: number;
  skipped: number;
  pending: number;
}

/** Per-plan recipient progress (sent / skipped / pending), for the Disparos panel. */
export function useBlastPlanProgress(planId: string | null) {
  return useQuery({
    queryKey: ["blast_plan_recipients", planId],
    queryFn: async (): Promise<BlastPlanProgress> => {
      if (!planId) return { total: 0, sent: 0, skipped: 0, pending: 0 };
      const { data, error } = await supabase
        .from("blast_plan_recipients" as any)
        .select("status")
        .eq("plan_id", planId);
      if (error) throw error;
      const rows = (data ?? []) as unknown as { status: string }[];
      const p: BlastPlanProgress = { total: rows.length, sent: 0, skipped: 0, pending: 0 };
      for (const r of rows) {
        if (r.status === "sent") p.sent += 1;
        else if (r.status === "skipped") p.skipped += 1;
        else p.pending += 1;
      }
      return p;
    },
    enabled: !!planId,
  });
}

export interface UpdateBlastPlanInput {
  plan_id: string;
  /** New frozen message template — reaches every not-yet-sent recipient. */
  message?: string;
  /** New daily release time-of-day (HH:MM). */
  release_time?: string;
}

/**
 * Edit a live Blast Plan's message / release_time (#911). The audience is
 * immutable (ADR-0003) so it is never touched. Writes go through the
 * service_role edge fn (blast_plans is SELECT-only for members) which validates
 * the org, guards the tenant, and rejects terminal plans.
 */
export function useUpdateBlastPlan() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (input: UpdateBlastPlanInput) => {
      const { data, error } = await supabase.functions.invoke("blast-plan-edit", { body: input });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true };
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["blast_plans", teamMember.organization_id] });
      }
    },
  });
}

export type BlastPlanAction = "pause" | "resume" | "cancel";

/** Pause / resume / cancel a Blast Plan (writes go through the service_role edge fn). */
export function useBlastPlanControl() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (input: { plan_id: string; action: BlastPlanAction }) => {
      const { data, error } = await supabase.functions.invoke("blast-plan-control", { body: input });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true; status: BlastPlanStatus };
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["blast_plans", teamMember.organization_id] });
      }
    },
  });
}
