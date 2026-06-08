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

/** The six canonical Follow-up Situations, each owned by an Archetype. */
export type SituationId =
  | "new_lead_no_reply" // Qualificador
  | "qualified_no_meeting" // Qualificador
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

  const proposal = enabled.find((e) => e.situationId === "proposal_no_reply");
  if (proposal && lead.propostasStage === "enviada" && ourMessageWasLast(lead)) {
    if (ignoreDelay || delayElapsed(lead.lastOutboundAt, proposal.delayHours, proposal.delayMinutes, now)) {
      return {
        eligible: true,
        situationId: "proposal_no_reply",
        reason: ignoreDelay ? "situation_holds" : "delay_elapsed",
      };
    }
  }

  return { eligible: false, reason: "no_situation_matched" };
}
