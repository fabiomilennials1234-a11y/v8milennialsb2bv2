/**
 * hitl-gate — Copilot v2 Human-in-the-loop approval (Slice 5, ADR-0002 #7).
 *
 * Per-org toggle, default OFF. When ON, a critical action on a high-value lead
 * requires human approval before the agent acts. Pure decision; the proposal
 * persistence + UX live in the worker/DB. fail-CLOSED: ON + a critical tool +
 * an unknown tier → require approval (never auto-act on an unclassified lead).
 *
 * The critical set and the high-value tiers are PARAMETERS (configurable), not
 * silent premises — see the slice's open-decisions note.
 */

export const CRITICAL_TOOLS = new Set<string>([
  "schedule_meeting", "send_media", "transfer_to_human", "handoff_to_vendedor", "move_lead_stage",
]);
export const HIGH_VALUE_TIERS = new Set<string>(["diamante", "ouro"]);

export interface HitlGateInput {
  /** Org toggle. Default OFF. */
  enabled: boolean;
  /** Tools the turn proposed (the steps that were allowed). */
  toolNames: string[];
  /** The lead's qualification tier, or null when unknown. */
  leadTier: string | null;
}

export interface HitlGateDecision {
  requiresApproval: boolean;
  reason: "hitl_approval_required" | null;
}

export function decideHitlGate(input: HitlGateInput): HitlGateDecision {
  if (!input.enabled) return { requiresApproval: false, reason: null };
  const hasCritical = input.toolNames.some((t) => CRITICAL_TOOLS.has(t));
  if (!hasCritical) return { requiresApproval: false, reason: null };
  // fail-CLOSED: unknown tier on a critical action → require approval.
  const highValue = input.leadTier == null || HIGH_VALUE_TIERS.has(input.leadTier);
  return highValue
    ? { requiresApproval: true, reason: "hitl_approval_required" }
    : { requiresApproval: false, reason: null };
}
