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

  /**
   * O sujeito do evento é a ENTRADA quando o agregado é ela — `aggregate_id`
   * de um `lead.stage_changed` de funil é `pipeline_entries.id`. Sem isto o
   * caminho do barramento continuaria falando só da pessoa enquanto o caminho
   * do gatilho de banco já fala do Negócio, e os dois passariam a deduplicar
   * com escopos diferentes para o mesmo fato.
   *
   * `campanha_lead` fica de fora de propósito: ali o agregado é a inscrição na
   * campanha, não um Negócio.
   */
  const entryId = event.aggregate_type === "pipeline_entry" ? event.aggregate_id : null;

  await fireTrigger({
    supabase,
    organizationId: organization_id,
    triggerType: "stage_changed",
    leadId: payload.lead_id,
    entryId,
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
