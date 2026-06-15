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
