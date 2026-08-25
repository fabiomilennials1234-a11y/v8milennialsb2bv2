import type { ActionInput, ActionResult } from "./types.ts";

/**
 * `create_followup` — a tarefa é DO NEGÓCIO (decisão do CTO, 2026-08-25).
 *
 * Mesma regra do checklist (ADR-0031): quando a execução sabe qual Negócio
 * disparou, a tarefa nasce presa a ele. Quando não sabe (gatilho da pessoa), a
 * tarefa é da PESSOA e vale para todos os negócios dela.
 *
 * `source_pipe`/`source_pipe_id` continuam onde estavam: eram a meia-ponte que
 * já existia (373 follow-ups em prod diziam de qual card vieram, sem FK e com
 * nome de "pipe"). `pipeline_entry_id` é a coluna canônica; aposentar as
 * antigas é outra fatia.
 */
export async function createFollowup(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, entryId, dealId, params } = input;

  const title = (params.followupTitle as string) || "Follow-up";
  const description = (params.followupDescription as string) || "";
  const priority = (params.followupPriority as string) || "normal";

  const { data: lead } = await supabase
    .from("leads")
    .select("responsible_id, sdr_id, closer_id")
    .eq("id", leadId)
    .maybeSingle();

  const assignedTo = lead?.responsible_id || lead?.sdr_id || lead?.closer_id || null;

  const { error } = await supabase.from("follow_ups").insert({
    lead_id: leadId,
    pipeline_entry_id: entryId ?? null,
    deal_id: dealId ?? null,
    assigned_to: assignedTo,
    title,
    description,
    priority,
    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    is_automated: true,
    organization_id: organizationId,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: `Follow-up "${title}" created` };
}
