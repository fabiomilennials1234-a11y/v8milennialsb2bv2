import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fireTrigger } from "../../workflow-trigger.ts";
import type { LeadStageChangedEvent } from "../types.ts";

/**
 * Handler para `lead.stage_changed`. Reusa `fireTrigger` server-side
 * (mesma lógica que `trg_workflow_stage_changed_*` invoca via pg_net),
 * mantendo dedup + auto-cancel de execuções concorrentes.
 *
 * Idempotente por construção: `fireTrigger` faz dedup contra
 * workflow_executions com status running/processing/waiting/paused.
 */
export async function handleLeadStageChanged(
  supabase: SupabaseClient,
  event: LeadStageChangedEvent,
): Promise<void> {
  const { payload, organization_id } = event;

  await fireTrigger({
    supabase,
    organizationId: organization_id,
    triggerType: "stage_changed",
    leadId: payload.lead_id,
    context: {
      trigger: "stage_changed",
      pipe_type: payload.pipe_type,
      pipeline_id: payload.pipeline_id,
      campanha_id: payload.campaign_id,
      from_stage: payload.old_stage_key,
      to_stage: payload.new_stage_key,
    },
    source: "event-bus",
  });
}
