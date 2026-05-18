/**
 * Trigger matching for copilot follow-up rules.
 *
 * Pure logic — no DB, no side effects.
 * Each trigger type encodes domain rules about when a lead qualifies.
 */

export interface TriggerLead {
  qualification_score?: number;
  qualified_at?: string;
  pipe_stages?: Record<string, string>;
  last_message_at?: string;
  stage_changed_at?: string;
}

export interface TriggerResult {
  eligible: boolean;
  reason: string;
}

function delayElapsed(
  timestamp: string | undefined,
  delayHours: number,
  delayMinutes: number,
  now: Date,
): { elapsed: boolean; reason: string } {
  if (!timestamp) {
    return { elapsed: false, reason: "no_message_timestamp" };
  }
  const since = new Date(timestamp);
  const delayMs = (delayHours * 60 + delayMinutes) * 60 * 1000;
  const elapsed = now.getTime() - since.getTime();
  return elapsed >= delayMs
    ? { elapsed: true, reason: "delay_elapsed" }
    : { elapsed: false, reason: "delay_not_elapsed" };
}

// ---- Trigger handlers ----

function handleNoResponse(
  lead: TriggerLead,
  delayHours: number,
  delayMinutes: number,
  now: Date,
): TriggerResult {
  if (!lead.last_message_at) {
    return { eligible: false, reason: "no_message_timestamp" };
  }
  const check = delayElapsed(lead.last_message_at, delayHours, delayMinutes, now);
  return check.elapsed
    ? { eligible: true, reason: "no_response_delay_elapsed" }
    : { eligible: false, reason: check.reason };
}

function handleAfterQualification(
  lead: TriggerLead,
  delayHours: number,
  delayMinutes: number,
  now: Date,
): TriggerResult {
  if (!lead.qualification_score || lead.qualification_score <= 0) {
    return { eligible: false, reason: "not_qualified" };
  }

  // Meeting already scheduled = not eligible
  const confirmacao = lead.pipe_stages?.confirmacao;
  if (confirmacao) {
    return { eligible: false, reason: "meeting_already_scheduled" };
  }

  const check = delayElapsed(lead.qualified_at, delayHours, delayMinutes, now);
  if (!check.elapsed) {
    return { eligible: false, reason: check.reason };
  }

  return { eligible: true, reason: "qualified_delay_elapsed" };
}

function handleAfterMeetingScheduled(
  lead: TriggerLead,
  delayHours: number,
  delayMinutes: number,
  now: Date,
): TriggerResult {
  const confirmacao = lead.pipe_stages?.confirmacao;
  if (!confirmacao) {
    return { eligible: false, reason: "not_in_confirmacao" };
  }

  const check = delayElapsed(lead.stage_changed_at, delayHours, delayMinutes, now);
  if (!check.elapsed) {
    return { eligible: false, reason: check.reason };
  }

  return { eligible: true, reason: "meeting_scheduled_delay_elapsed" };
}

function handlePostSale(
  lead: TriggerLead,
  delayHours: number,
  delayMinutes: number,
  now: Date,
): TriggerResult {
  const propostas = lead.pipe_stages?.propostas;
  if (propostas !== "vendido") {
    return { eligible: false, reason: "not_vendido" };
  }

  const check = delayElapsed(lead.stage_changed_at, delayHours, delayMinutes, now);
  if (!check.elapsed) {
    return { eligible: false, reason: check.reason };
  }

  return { eligible: true, reason: "post_sale_delay_elapsed" };
}

function handleProposalNoResponse(
  lead: TriggerLead,
  delayHours: number,
  delayMinutes: number,
  now: Date,
): TriggerResult {
  const propostas = lead.pipe_stages?.propostas;
  if (propostas !== "enviada") {
    return { eligible: false, reason: "not_in_enviada_stage" };
  }

  if (!lead.last_message_at) {
    return { eligible: false, reason: "no_message_timestamp" };
  }

  const check = delayElapsed(lead.last_message_at, delayHours, delayMinutes, now);
  if (!check.elapsed) {
    return { eligible: false, reason: check.reason };
  }

  return { eligible: true, reason: "proposal_no_response_delay_elapsed" };
}

// ---- Main dispatcher ----

const HANDLERS: Record<
  string,
  (lead: TriggerLead, dh: number, dm: number, now: Date) => TriggerResult
> = {
  no_response: handleNoResponse,
  after_qualification: handleAfterQualification,
  after_meeting_scheduled: handleAfterMeetingScheduled,
  post_sale: handlePostSale,
  proposal_no_response: handleProposalNoResponse,
};

export function isLeadEligibleForTrigger(params: {
  triggerType: string;
  lead: TriggerLead;
  triggerDelayHours: number;
  triggerDelayMinutes: number;
  now: Date;
}): TriggerResult {
  const { triggerType, lead, triggerDelayHours, triggerDelayMinutes, now } = params;
  const handler = HANDLERS[triggerType];
  if (!handler) {
    return { eligible: false, reason: "unknown_trigger_type" };
  }
  return handler(lead, triggerDelayHours, triggerDelayMinutes, now);
}
