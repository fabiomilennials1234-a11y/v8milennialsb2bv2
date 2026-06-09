/**
 * Lead response detection for cadence follow-ups.
 *
 * When an inbound message is received, check copilot_followup_step_log
 * for active (non-completed) cadences and mark them completed.
 */

import { evaluateStop, type StopEvent } from "./followup-stop.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/**
 * Apply a Stop Evaluator decision to a Lead's active situation-based cadences
 * (ADR-0006). Used to cancel cadences the resolver can't catch on its own — most
 * importantly human_reply (a human teammate's outbound message looks like "our"
 * message to the resolver, so it would otherwise resume after Human Pause).
 */
export async function applySituationStop(
  supabase: SupabaseClient,
  leadId: string,
  event: StopEvent,
): Promise<{ stopped: number }> {
  const decision = evaluateStop(event);
  if (!decision.stop) return { stopped: 0 };

  const { data: active, error } = await supabase
    .from("copilot_followup_step_log")
    .select("situation_config_id, lead_id")
    .eq("lead_id", leadId)
    .eq("completed", false)
    .not("situation_config_id", "is", null);

  if (error || !active?.length) return { stopped: 0 };

  let stopped = 0;
  for (const row of active) {
    const { error: updErr } = await supabase
      .from("copilot_followup_step_log")
      .update({
        completed: true,
        completed_reason: decision.reason,
        completed_at: new Date().toISOString(),
      })
      .eq("situation_config_id", row.situation_config_id)
      .eq("lead_id", row.lead_id);
    if (!updErr) stopped++;
  }
  return { stopped };
}

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
