/**
 * engine-router — Copilot v2 cutover routing decision (Slice 12).
 *
 * Pure, fail-safe mapping from the per-org flag
 * (organizations.copilot_engine_version) to the engine that handles the inbound.
 * v2 is chosen ONLY when the org is explicitly flipped to the exact string
 * 'v2'; every other value (legacy 'v1', null, garbage, an errored read that
 * coalesces to null) resolves to v1.
 *
 * This is the single 🔴 safety invariant of the cutover: the WhatsApp inbound
 * path serves 60+ live orgs on v1, so the routing branch must never divert an
 * org to v2 by accident. Rollback = flip the flag back to 'v1' (or anything
 * non-'v2'); no code change.
 */

export type EngineVersion = 'v1' | 'v2';

export function decideEngine(flag: string | null | undefined): EngineVersion {
  return flag === 'v2' ? 'v2' : 'v1';
}

export type CopilotRouteOutcome = 'v1_queued' | 'v1_fallback' | 'v2_dispatched' | 'v2_failed';

/**
 * I/O-injected orchestrator for the whatsapp-webhook copilot dispatch. Holds the
 * whole 🔴 fail-safe contract so it is unit-tested without DB/border/HTTP:
 *
 *  - The engine flag read is wrapped: ANY throw coalesces to v1 (decideEngine
 *    treats null as v1). A read failure must never divert an org to v2.
 *  - A v2-flagged org goes to the v2 border (dispatchV2). If the border THROWS we
 *    report v2_failed and STOP — we do NOT cross-route to v1, because the org is
 *    v2 (its v1 agent may be inactive) and double-processing would risk a
 *    duplicate reply. Rollback for a broken v2 org = flip the flag back to v1.
 *  - A v1 org enqueues legacy; on a queue-insert error it falls back to the
 *    direct agent-message call (the pre-existing v1 behavior, unchanged).
 */
export interface CopilotRouteDeps {
  /** Reads organizations.copilot_engine_version for this org. */
  readEngineFlag: () => Promise<string | null | undefined>;
  /** Inserts the legacy copilot_message_queue row. */
  enqueueV1: () => Promise<{ error: { message: string } | null }>;
  /** Direct agent-message call — the existing v1 fallback when the queue errors. */
  fallbackV1Direct: () => Promise<void>;
  /** Hands the inbound to the v2 border (processInbound). */
  dispatchV2: () => Promise<void>;
  /** Best-effort observability hook (never affects control flow). */
  log?: (event: string, meta?: Record<string, unknown>) => void;
}

export async function routeCopilotInbound(deps: CopilotRouteDeps): Promise<CopilotRouteOutcome> {
  let flag: string | null | undefined = null;
  try {
    flag = await deps.readEngineFlag();
  } catch (_e) {
    flag = null; // fail-safe: any read error → v1
  }

  if (decideEngine(flag) === 'v2') {
    try {
      await deps.dispatchV2();
      deps.log?.('copilot_v2_routed');
      return 'v2_dispatched';
    } catch (e) {
      // Do NOT fall through to v1 — the org is v2; a duplicate is worse than a
      // logged failure. Rollback = flip the flag back to v1.
      deps.log?.('copilot_v2_route_failed', { error: e instanceof Error ? e.message : String(e) });
      return 'v2_failed';
    }
  }

  const { error } = await deps.enqueueV1();
  if (!error) {
    deps.log?.('copilot_queued');
    return 'v1_queued';
  }
  deps.log?.('copilot_queue_insert_failed', { error: error.message });
  await deps.fallbackV1Direct();
  return 'v1_fallback';
}
