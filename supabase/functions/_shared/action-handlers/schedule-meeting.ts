import type { ActionInput, ActionResult } from "./types.ts";

/** Explicit scheduling writes the same appointment used by Agenda and its metrics. */
export async function scheduleMeeting(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, entryId, dealId, params } = input;
  if (!leadId) return { success: false, error: "leadId é obrigatório para schedule_meeting" };
  const date = params.date as string | undefined;
  if (!date) return { success: false, error: "date é obrigatório para schedule_meeting" };
  const time = params.time as string | undefined;
  const start = new Date(time && !date.includes("T") ? `${date}T${time}:00Z` : date);
  if (!Number.isFinite(start.getTime())) return { success: false, error: "date inválida para schedule_meeting" };
  const end = params.end_at ? new Date(String(params.end_at)) : new Date(start.getTime() + 60 * 60 * 1000);
  if (!Number.isFinite(end.getTime()) || end <= start) return { success: false, error: "end_at deve ser posterior ao início" };
  let createdBy: string | null = null;
  let pipelineId: string | null = null;
  let linkedDeal = dealId ?? null;
  if (params.assigned_to) {
    const { data, error } = await supabase.from("team_members").select("user_id")
      .eq("id", params.assigned_to).eq("organization_id", organizationId).maybeSingle();
    if (error || !data) return { success: false, error: error?.message ?? "Responsável não pertence à organização" };
    createdBy = data.user_id;
  }
  if (entryId) {
    const { data, error } = await supabase.from("pipeline_entries").select("pipeline_id,deal_id")
      .eq("id", entryId).eq("organization_id", organizationId).eq("lead_id", leadId).maybeSingle();
    if (error || !data || (dealId && data.deal_id !== dealId)) return { success: false, error: error?.message ?? "Negócio não pertence ao lead e à organização" };
    pipelineId = data.pipeline_id;
    linkedDeal = data.deal_id;
  }
  const externalRef = typeof params.external_ref === "string" ? params.external_ref : null;
  const existing = async () => supabase.from("meetings").select("id,meet_link")
    .eq("organization_id", organizationId).eq("external_ref", externalRef).maybeSingle();
  if (externalRef) {
    const previous = await existing();
    if (previous.error) return { success: false, error: previous.error.message };
    if (previous.data) return { success: true, data: { meeting_id: previous.data.id, meet_link: previous.data.meet_link, idempotent: true } };
  }
  const { data, error } = await supabase.from("meetings").insert({
    organization_id: organizationId,
    lead_id: leadId,
    pipeline_entry_id: entryId ?? null,
    pipeline_id: pipelineId,
    deal_id: linkedDeal,
    created_by: createdBy,
    external_ref: externalRef,
    title: typeof params.title === "string" ? params.title : "Reunião",
    description: typeof params.notes === "string" ? params.notes : null,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    event_type: "meeting",
    status: "scheduled",
  }).select("id").single();
  if (error?.code === "23505" && externalRef) {
    const previous = await existing();
    if (!previous.error && previous.data) return { success: true, data: { meeting_id: previous.data.id, meet_link: previous.data.meet_link, idempotent: true } };
  }
  if (error) return { success: false, error: error.message };
  return { success: true, message: "Reunião agendada com sucesso", data: { meeting_id: data.id, due_date: start.toISOString(), lead_id: leadId } };
}
