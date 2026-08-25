import type { ActionInput, ActionResult } from "./types.ts";

/**
 * Shared schedule_meeting handler.
 *
 * Creates a follow_up record with source_pipe='meeting' for the given lead.
 * Consumed by both Copilot AI actions and Workflow engine.
 *
 * Params:
 *   - date: string (ISO date or datetime) — REQUIRED
 *   - time?: string (HH:MM) — combined with date if date has no time component
 *   - notes?: string — stored as description
 *   - assigned_to?: string — UUID of team member
 */
export async function scheduleMeeting(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, entryId, dealId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId é obrigatório para schedule_meeting" };
  }

  const dateParam = params.date as string | undefined;
  if (!dateParam) {
    return { success: false, error: "date é obrigatório para schedule_meeting" };
  }

  // Build due_date: if time param provided and date has no time component, combine them
  let dueDate: string;
  const timeParam = params.time as string | undefined;
  if (timeParam && !dateParam.includes("T")) {
    dueDate = `${dateParam}T${timeParam}:00Z`;
  } else {
    dueDate = dateParam;
  }

  const notes = params.notes as string | undefined;
  const assignedTo = params.assigned_to as string | undefined;

  const { error } = await supabase.from("follow_ups").insert({
    lead_id: leadId,
    // A reunião é DESTE negócio quando a execução declara um — decisão do CTO
    // em 2026-08-25, mesma regra do checklist.
    pipeline_entry_id: entryId ?? null,
    deal_id: dealId ?? null,
    organization_id: organizationId,
    due_date: dueDate,
    title: "Reunião",
    description: notes || null,
    assigned_to: assignedTo || null,
    source_pipe: "meeting",
    is_automated: true,
    priority: "normal",
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    message: "Reunião agendada com sucesso",
    data: { due_date: dueDate, lead_id: leadId },
  };
}
