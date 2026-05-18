import type { ActionInput, ActionResult } from "./types.ts";

export async function createFollowup(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

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
