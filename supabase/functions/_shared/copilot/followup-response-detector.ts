/**
 * Lead response detection for cadence follow-ups.
 *
 * When an inbound message is received, check copilot_followup_step_log
 * for active (non-completed) cadences and mark them completed.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function markCadenceCompletedOnResponse(
  supabase: SupabaseClient,
  leadId: string,
): Promise<{ marked: number }> {
  const { data: activeLogs, error } = await supabase
    .from("copilot_followup_step_log")
    .select("rule_id, lead_id")
    .eq("lead_id", leadId)
    .eq("completed", false);

  if (error || !activeLogs?.length) {
    return { marked: 0 };
  }

  let marked = 0;
  for (const log of activeLogs) {
    const { error: updateErr } = await supabase
      .from("copilot_followup_step_log")
      .update({
        completed: true,
        completed_reason: "lead_responded",
        completed_at: new Date().toISOString(),
      })
      .eq("rule_id", log.rule_id)
      .eq("lead_id", log.lead_id);

    if (!updateErr) marked++;
  }

  return { marked };
}
