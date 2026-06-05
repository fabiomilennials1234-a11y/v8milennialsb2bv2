/**
 * blastPlanStore — production BlastPlanStore over Supabase (service_role).
 *
 * The IO seam for blast-plan.ts (ADR-0003 / #707). All reads/writes are scoped to
 * blast_plans / blast_plan_recipients; tenant scoping is enforced by the caller
 * (org-scoped lead fetch at creation) plus the plan's own organization_id, which
 * every release path reads back from the persisted row. service_role bypasses RLS
 * by design — the org guard lives in the orchestration, not the store.
 */
import type { BlastPlanStore, PlanRow, PlanRecipientRow } from "./blast-plan.ts";

type Admin = { from: (t: string) => any };

export function blastPlanStore(supabaseAdmin: Admin): BlastPlanStore {
  return {
    async insertPlan(row: Omit<PlanRow, "id">): Promise<string> {
      // `instance` is an in-memory convenience for the orchestrator; it is not a
      // column. Strip it before insert (the releaser re-reads the instance by id).
      const { instance: _instance, ...persistable } = row as PlanRow;
      const { data, error } = await supabaseAdmin
        .from("blast_plans")
        .insert(persistable)
        .select("id")
        .single();
      if (error || !data) throw new Error(`insert blast_plans failed: ${error?.message ?? "unknown"}`);
      return data.id as string;
    },

    async insertRecipients(rows: PlanRecipientRow[]): Promise<void> {
      if (rows.length === 0) return;
      // Chunk to keep the single statement well within payload limits at scale.
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error } = await supabaseAdmin.from("blast_plan_recipients").insert(slice);
        if (error) throw new Error(`insert blast_plan_recipients failed: ${error.message}`);
      }
    },

    async getPlan(planId: string): Promise<PlanRow | null> {
      const { data } = await supabaseAdmin
        .from("blast_plans")
        .select("*")
        .eq("id", planId)
        .maybeSingle();
      return (data as PlanRow) ?? null;
    },

    async updatePlan(planId: string, patch: Partial<PlanRow>): Promise<void> {
      const { instance: _instance, ...persistable } = patch as PlanRow;
      const { error } = await supabaseAdmin.from("blast_plans").update(persistable).eq("id", planId);
      if (error) throw new Error(`update blast_plans failed: ${error.message}`);
    },

    async getLotRecipients(planId: string, lotIndex: number): Promise<PlanRecipientRow[]> {
      const { data } = await supabaseAdmin
        .from("blast_plan_recipients")
        .select("plan_id, lead_id, phone, variable_snapshot, lot_index, status, reason")
        .eq("plan_id", planId)
        .eq("lot_index", lotIndex);
      return (data ?? []) as PlanRecipientRow[];
    },

    async markRecipients(planId, leadIds, status, reason): Promise<void> {
      if (leadIds.length === 0) return;
      const CHUNK = 500;
      for (let i = 0; i < leadIds.length; i += CHUNK) {
        const slice = leadIds.slice(i, i + CHUNK);
        const { error } = await supabaseAdmin
          .from("blast_plan_recipients")
          .update({ status, reason })
          .eq("plan_id", planId)
          .in("lead_id", slice);
        if (error) throw new Error(`mark recipients failed: ${error.message}`);
      }
    },

    async moveRecipientsToLot(planId, leadIds, lotIndex): Promise<void> {
      if (leadIds.length === 0) return;
      const CHUNK = 500;
      for (let i = 0; i < leadIds.length; i += CHUNK) {
        const slice = leadIds.slice(i, i + CHUNK);
        const { error } = await supabaseAdmin
          .from("blast_plan_recipients")
          .update({ lot_index: lotIndex })
          .eq("plan_id", planId)
          .in("lead_id", slice);
        if (error) throw new Error(`move recipients failed: ${error.message}`);
      }
    },

    async listActivePlansDue(today: string): Promise<PlanRow[]> {
      const { data } = await supabaseAdmin
        .from("blast_plans")
        .select("*")
        .eq("status", "active")
        .lte("next_release_date", today)
        .order("created_at", { ascending: true });
      return (data ?? []) as PlanRow[];
    },
  };
}
