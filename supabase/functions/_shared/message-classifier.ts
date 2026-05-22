/**
 * message-classifier — função pura que mapeia `whatsapp_messages.raw_payload`
 * para `{ sent_source, sent_by_ai }`.
 *
 * Bug origem (investigação Bertin 2026-05-22): 69 msgs com
 * `raw_payload.track_source='workflow-action'` foram salvas como
 * `sent_source='manual'`. Distorce métricas de atribuição.
 *
 * Usado por:
 *  - whatsapp-webhook/index.ts (inbound insert)
 *  - history-sync-worker/index.ts (history backfill)
 */

export type SentSource =
  | "copilot"
  | "workflow"
  | "manual"
  | "mass_send"
  | "unknown";

export interface ClassifyArgs {
  raw_payload: Record<string, unknown>;
  direction: "incoming" | "outgoing";
  instance_context: { instance_id: string };
}

export interface ClassifyResult {
  sent_source: SentSource;
  sent_by_ai: boolean;
  track_source: string | null;
}

export function classifyMessageSource(args: ClassifyArgs): ClassifyResult {
  const trackSource = readString(args.raw_payload.track_source);

  if (trackSource === "workflow-action") {
    return { sent_source: "workflow", sent_by_ai: true, track_source: trackSource };
  }
  if (trackSource === "copilot") {
    return { sent_source: "copilot", sent_by_ai: true, track_source: trackSource };
  }
  if (trackSource === "mass-send") {
    return { sent_source: "mass_send", sent_by_ai: true, track_source: trackSource };
  }

  // Manual paths: explicit "android" source (operator on mobile), or
  // explicit wasSentByApi=false, or whatsapp-api-proxy without a higher
  // precedence hint (frontend composer).
  const source = readString(args.raw_payload.source);
  const wasSentByApi = args.raw_payload.wasSentByApi;
  if (source === "android" || wasSentByApi === false || trackSource === "whatsapp-api-proxy") {
    return { sent_source: "manual", sent_by_ai: false, track_source: trackSource };
  }

  return { sent_source: "unknown", sent_by_ai: false, track_source: trackSource };
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
