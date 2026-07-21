/**
 * send-governor/gate — the single entry point wiring wraps a send with.
 *
 *   const r = await governSend(supabaseAdmin, ctx, () => provider.sendText(...));
 *
 * Contract:
 *  - SHADOW (and off): the decision is ALWAYS 'allow', so `doSend` ALWAYS runs
 *    and governSend returns exactly what `doSend` returned (the caller's shape
 *    is preserved byte-for-byte). This is the only active mode in PR-0.
 *  - ENFORCE (future): a would-be block/defer returns a SkippedSend WITHOUT
 *    calling `doSend`.
 *  - FAIL-OPEN: ANY error in the governor (state read, evaluation, telemetry)
 *    falls through to `doSend`. The governor is never a single point of failure.
 *  - `doSend` runs EXACTLY ONCE. It is intentionally OUTSIDE the governor's own
 *    try/catch, so a throw from `doSend` propagates to the caller unchanged and
 *    can NEVER trigger a second (double) send.
 *  - The automation usage ledger increments ONLY after a real successful send.
 */

import type {
  GovernorAction,
  GovernorContext,
  GovernorDecision,
  GovernorState,
  GovernorSupabaseClient,
  SkippedSend,
} from "./types.ts";
import { evaluateSend } from "./core.ts";
import {
  incrementAutomationUsage,
  recordDecision,
  resolveGovernorState,
} from "./io.ts";

/** Injectable dependency surface. Defaults to the real io/core functions; the
 *  public 3-arg call shape wiring uses is unchanged (the 4th param is
 *  internal/testing only). */
export interface GovernSendDeps {
  resolveGovernorState: typeof resolveGovernorState;
  evaluateSend: typeof evaluateSend;
  recordDecision: typeof recordDecision;
  incrementAutomationUsage: typeof incrementAutomationUsage;
}

const defaultDeps: GovernSendDeps = {
  resolveGovernorState,
  evaluateSend,
  recordDecision,
  incrementAutomationUsage,
};

/** Hard ceiling on how long state resolution may sit in front of a send. A slow
 *  or hanging DB must NEVER delay the WhatsApp send: on timeout we fail-open
 *  (the race rejects → the guard below falls through to allow). */
const STATE_TIMEOUT_MS = 1200;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("governor_state_timeout")),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Type guard: did governSend skip the send (enforce block/defer)? In
 *  shadow/off this is always false. */
export function isSkippedSend(v: unknown): v is SkippedSend {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __governorSkipped?: unknown }).__governorSkipped === true
  );
}

function makeSkipped(decision: GovernorDecision): SkippedSend {
  return {
    __governorSkipped: true,
    action: decision.action as "block" | "defer",
    reason: decision.reason,
    category: decision.category,
    retryAt: decision.retryAt,
  };
}

/**
 * Wrap a send with the governor. See the module contract above.
 *
 * @param supabaseAdmin service-role client (governor reads/writes bypass RLS).
 * @param ctx           the send facts (org, instance, category, phone, …).
 * @param doSend        the actual send; runs exactly once when allowed.
 * @param deps          internal/testing injection point (defaults to real io).
 */
export async function governSend<T>(
  supabaseAdmin: GovernorSupabaseClient,
  ctx: GovernorContext,
  doSend: () => Promise<T>,
  deps: GovernSendDeps = defaultDeps,
): Promise<T | SkippedSend> {
  let action: GovernorAction = "allow"; // FAIL-OPEN default
  let decision: GovernorDecision | undefined;
  let state: GovernorState | undefined;
  // True only when a real decision was computed AND the org has the governor
  // active (mode !== 'off'). Gates ledger writes + telemetry: an inert ('off')
  // org and the fail-open path leave zero governor footprint.
  let governed = false;

  // ── Governor decision (fully guarded; any throw/timeout → fail-open allow) ─
  // State resolution is the ONLY governor work in front of the send, so it is
  // time-boxed: a slow/hanging DB can never delay delivery (STATE_TIMEOUT_MS →
  // reject → allow). Telemetry is deliberately NOT here — it runs AFTER the send
  // so a slow runtime_logs insert can never sit in front of a WhatsApp message.
  try {
    state = await withTimeout(
      deps.resolveGovernorState(supabaseAdmin, {
        orgId: ctx.orgId,
        instanceId: ctx.instanceId ?? undefined,
        category: ctx.category,
        recipientPhone: ctx.recipientPhone ?? undefined,
      }),
      STATE_TIMEOUT_MS,
    );
    decision = deps.evaluateSend(ctx, state);
    action = decision.action;
    governed = state.mode !== "off";
  } catch {
    action = "allow"; // FAIL-OPEN: any governor error/timeout → send through
    governed = false; // unknown state → leave the ledger untouched
  }

  // ── Enforce block/defer (unreachable in shadow/off — action is 'allow') ───
  if (action !== "allow" && decision) {
    // No send to delay here, so record the skip synchronously (still fail-soft).
    if (governed && ctx.category !== "manual" && state) {
      try {
        await deps.recordDecision(supabaseAdmin, ctx, state, decision);
      } catch {
        /* fail-soft */
      }
    }
    return makeSkipped(decision);
  }

  // ── Allow (incl. shadow + fail-open): send EXACTLY ONCE, outside the guard ─
  // A throw here propagates to the caller (current semantics) and can never be
  // double-executed by the governor's own error handling.
  const result = await doSend();

  // ── Post-send side effects (NEVER in front of delivery) ───────────────────
  // Telemetry + ledger run only after the message is out. Awaited (not fire-
  // and-forget) so they complete before the edge isolate suspends; both are
  // internally fail-soft, so a slow/failing write costs a little latency but
  // never breaks — or double-sends — the caller.
  if (governed && ctx.category !== "manual" && decision && state) {
    try {
      await deps.recordDecision(supabaseAdmin, ctx, state, decision);
    } catch {
      /* fail-soft */
    }
  }
  if (governed && ctx.category === "automation" && ctx.instanceId) {
    try {
      await deps.incrementAutomationUsage(supabaseAdmin, ctx.instanceId);
    } catch {
      /* fail-soft */
    }
  }

  return result;
}
