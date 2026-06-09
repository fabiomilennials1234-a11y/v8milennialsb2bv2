/**
 * Situation Resolver for Copilot Follow-up.
 *
 * Pure logic — no DB, no side effects. Decides which canonical Follow-up
 * Situation (CONTEXT.md) applies to a Lead's current state and whether its
 * configured delay has elapsed. Only Situations the Organization has enabled
 * are considered. Situations are mutually exclusive by funnel position, so at
 * most one matches.
 *
 * Replaces the trigger-blind get_followup_eligible_leads SQL filter, which
 * used "last message was ours + N hours" for every trigger type.
 */

/** The Copilot Archetype that owns a Lead's re-engagement (CONTEXT.md). */
export type Archetype = "qualificador" | "vendedor" | "carteira";

/** The canonical Follow-up Situations, each owned by an Archetype. */
export type SituationId =
  | "new_lead_no_reply" // Qualificador
  | "qualified_no_meeting" // Qualificador
  | "cold_reengage" // Qualificador — re-warm leads parked in nurture stages
  | "meeting_reminder" // Vendedor (reminder only)
  | "no_show_rebook" // Vendedor
  | "proposal_no_reply" // Vendedor
  | "dormant_winback"; // Carteira

/** Snapshot of the Lead state the resolver reasons over. No DB access. */
export interface SituationLeadState {
  pipeWhatsappStage?: string | null;
  propostasStage?: string | null; // enviada | vendido | perdido
  qualificationScore?: number | null;
  qualifiedAt?: string | null;
  stageChangedAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  meetingDate?: string | null;
  carteiraSegment?: string | null; // ouro | prata | novo | resgate | dormindo
  lastOrderAt?: string | null;
}

/** A Situation the Org enabled, with its tuned delay (from the catalog config). */
export interface EnabledSituation {
  situationId: SituationId;
  delayHours: number;
  delayMinutes: number;
  /**
   * Org-configured stage_keys (of the situation's owning pipe) that place a
   * Lead IN this situation. Stage keys are customized per Organization, so the
   * trigger can never be a hardcoded canonical key. When the Lead's stage is
   * not in this set the situation no longer holds, which also serves as the
   * natural exit (e.g. moving to a won/lost stage stops the cadence).
   */
  triggerStageKeys: string[];
}

export type ResolveResult =
  | { eligible: true; situationId: SituationId; reason: string }
  | { eligible: false; reason: string };

/** True when our message was the last one (the Lead has not replied since). */
function ourMessageWasLast(lead: SituationLeadState): boolean {
  if (!lead.lastOutboundAt) return false;
  if (!lead.lastInboundAt) return true;
  return new Date(lead.lastInboundAt).getTime() <= new Date(lead.lastOutboundAt).getTime();
}

function delayElapsed(
  since: string | null | undefined,
  delayHours: number,
  delayMinutes: number,
  now: Date,
): boolean {
  if (!since) return false;
  const delayMs = (delayHours * 60 + delayMinutes) * 60 * 1000;
  return now.getTime() - new Date(since).getTime() >= delayMs;
}

/** Which lead-state stage field a situation matches its triggerStageKeys against. */
const STAGE_FIELD: Record<SituationId, keyof SituationLeadState> = {
  new_lead_no_reply: "pipeWhatsappStage",
  qualified_no_meeting: "pipeWhatsappStage",
  cold_reengage: "pipeWhatsappStage",
  no_show_rebook: "pipeWhatsappStage",
  meeting_reminder: "pipeWhatsappStage",
  proposal_no_reply: "propostasStage",
  dormant_winback: "carteiraSegment",
};

/** Re-engagement situations: only chase when our message was the last one. */
const REQUIRES_OUR_MESSAGE_LAST: Record<SituationId, boolean> = {
  new_lead_no_reply: true,
  qualified_no_meeting: true,
  cold_reengage: true,
  proposal_no_reply: true,
  // Proactive situations fire regardless of who messaged last:
  no_show_rebook: false,
  meeting_reminder: false,
  dormant_winback: false,
};

/** The timestamp a situation's delay is measured from. */
function delayAnchor(situationId: SituationId, lead: SituationLeadState): string | null | undefined {
  switch (situationId) {
    case "no_show_rebook":
      return lead.stageChangedAt;
    case "dormant_winback":
      return lead.lastOrderAt;
    default:
      return lead.lastOutboundAt;
  }
}

/** Structural match: the Lead is IN the situation, independent of timing. */
function structuralMatch(s: EnabledSituation, lead: SituationLeadState): boolean {
  const value = lead[STAGE_FIELD[s.situationId]] as string | null | undefined;
  if (!value || !s.triggerStageKeys.includes(value)) return false;

  // new_lead_no_reply means the Lead has never replied at all.
  if (s.situationId === "new_lead_no_reply" && lead.lastInboundAt) return false;

  // cold_reengage is the inverse: the Lead engaged at least once, then went
  // quiet. This keeps it mutually exclusive from new_lead_no_reply when a stage
  // (e.g. "Automação") holds both never-replied and replied-then-cold leads.
  if (s.situationId === "cold_reengage" && !lead.lastInboundAt) return false;

  if (REQUIRES_OUR_MESSAGE_LAST[s.situationId] && !ourMessageWasLast(lead)) return false;

  return true;
}

/** meeting_reminder fires inside a window BEFORE the meeting, not after a delay. */
function meetingReminderDue(s: EnabledSituation, lead: SituationLeadState, now: Date): boolean {
  if (!lead.meetingDate) return false;
  const meeting = new Date(lead.meetingDate).getTime();
  if (now.getTime() >= meeting) return false; // never remind after the meeting
  const leadMs = (s.delayHours * 60 + s.delayMinutes) * 60 * 1000;
  return meeting - now.getTime() <= leadMs;
}

export function resolveSituation(params: {
  enabled: EnabledSituation[];
  lead: SituationLeadState;
  now: Date;
  /**
   * When a cadence is already running, the Cadence Stepper owns timing — the
   * resolver should only confirm the situation still structurally holds and
   * skip the initial-trigger delay gate. Defaults to false (first touch).
   */
  ignoreDelay?: boolean;
}): ResolveResult {
  const { enabled, lead, now, ignoreDelay = false } = params;

  for (const s of enabled) {
    if (!structuralMatch(s, lead)) continue;

    let timingOk: boolean;
    if (s.situationId === "meeting_reminder") {
      timingOk = ignoreDelay || meetingReminderDue(s, lead, now);
    } else {
      timingOk = ignoreDelay || delayElapsed(delayAnchor(s.situationId, lead), s.delayHours, s.delayMinutes, now);
    }
    if (!timingOk) continue;

    return {
      eligible: true,
      situationId: s.situationId,
      reason: ignoreDelay ? "situation_holds" : "delay_elapsed",
    };
  }

  return { eligible: false, reason: "no_situation_matched" };
}
