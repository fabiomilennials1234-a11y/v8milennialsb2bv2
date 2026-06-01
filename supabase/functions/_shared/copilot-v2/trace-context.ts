/**
 * trace-context — Copilot v2 end-to-end trace seed (Slice 1 → Slice 10).
 *
 * A trace_id is minted at the border and threaded through queue → cognition →
 * tools → outbound. Slice 10 persists steps to copilot_v2_trace_steps; Slice 1
 * only needs to mint + carry the id and open the trace row. Step logging records
 * metadata only (reason/hashes) — never raw message content (PII).
 */

export interface TraceContext {
  trace_id: string;
  org_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  canonical_phone: string;
  turn_number: number | null;
  timestamp: string;
}

export function initTraceContext(args: {
  org_id: string;
  canonical_phone: string;
  lead_id?: string | null;
  conversation_id?: string | null;
  now?: Date;
}): TraceContext {
  return {
    trace_id: crypto.randomUUID(),
    org_id: args.org_id,
    lead_id: args.lead_id ?? null,
    conversation_id: args.conversation_id ?? null,
    canonical_phone: args.canonical_phone,
    turn_number: null,
    timestamp: (args.now ?? new Date()).toISOString(),
  };
}

/** Best-effort trace step. Never throws into the hot path. */
export async function logTraceStep(
  supabase: any,
  ctx: TraceContext,
  step: string,
  reason: string | null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from("copilot_v2_trace_steps").insert({
      trace_id: ctx.trace_id,
      step,
      reason,
      meta,
    });
  } catch (_err) {
    // Observability must never break delivery. Swallow (Sentry breadcrumb is
    // added by the caller's withSentry wrapper).
  }
}
