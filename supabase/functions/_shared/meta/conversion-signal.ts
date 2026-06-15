/**
 * conversion-signal — pure decision for the Lead Conversion Signal (ADR-0009,
 * slice 5). No DB, no network. The dispatcher edge function wraps this with
 * I/O (read meta_signals_sent, resolve the org's ad-account dataset, call
 * graph-client.sendConversion, record the send).
 *
 * The "no monetary value" guarantee lives in graph-client.sendConversion; this
 * module only decides WHETHER to signal, enforcing the two gates: the lead must
 * carry a Meta lead id (join key), and each event fires at most once per lead.
 */

export type ConversionEvent = "qualified" | "meeting" | "sold";

/**
 * Maps our internal milestone (the ledger key) to the Meta event_name sent via
 * the Conversions API for CRM. Aligned to Meta's recommended lead funnel terms
 * (meeting-booked, closed-won) so the events read as standard in Ads Manager.
 * The ledger keeps the milestone keys for idempotency; only the wire label
 * changes.
 */
export const META_EVENT_LABEL: Record<ConversionEvent, string> = {
  qualified: "qualified",
  meeting: "meeting_booked",
  sold: "closed_won",
};

export interface ConversionSignalPlan {
  send: boolean;
  reason: "ok" | "no_meta_lead_id" | "already_sent";
}

export function planConversionSignal(input: {
  metaLeadId: string | null | undefined;
  eventName: ConversionEvent;
  alreadySentEvents: Set<string>;
}): ConversionSignalPlan {
  if (!input.metaLeadId) return { send: false, reason: "no_meta_lead_id" };
  if (input.alreadySentEvents.has(input.eventName)) {
    return { send: false, reason: "already_sent" };
  }
  return { send: true, reason: "ok" };
}
