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
 *    state/eval try/catch, so a throw from `doSend` propagates to the caller
 *    unchanged and can NEVER trigger a second (double) send. Its OWN catch only
 *    feeds the reputation signal (below) and re-raises the original error.
 *  - REPUTATION FEED (P3): when `doSend` throws a STRONG ban status (463 or 429
 *    — see FEED_BAN_STATUSES; 403 and body-only matches are deliberately NOT
 *    fed), the gate — the single choke every automation send passes — is the one
 *    place that captures it and drives the reputation state machine via
 *    `record_ban_signal`. Best-effort / fail-soft: it can never change the send
 *    outcome, the original error is re-raised untouched, manual sends are exempt.
 *    This is the EXCLUSIVE feed; the UazapiClient's own token-hash telemetry
 *    path stays dormant (no double-count).
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
  conversationalDedupEnabled,
  deriveSendSource,
  getDefaultWindow,
  hashContent,
  reserveSendOrSkip,
} from "../send-dedup.ts";
import { logRuntime } from "../logger.ts";
import { isOrgBlocked } from "../org-status.ts";
import {
  incrementAutomationUsage,
  recordBanSignal,
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
  recordBanSignal: typeof recordBanSignal;
}

const defaultDeps: GovernSendDeps = {
  resolveGovernorState,
  evaluateSend,
  recordDecision,
  incrementAutomationUsage,
  recordBanSignal,
};

/** Pull a numeric provider status code out of a thrown send error. The Uazapi
 *  client throws a structured `UazapiError { status:number, provider_code?, … }`
 *  on every 4xx/5xx/timeout, so `status` is the primary (and 463 survives here
 *  intact — the provider/adapter never masks it). `provider_code` is a numeric
 *  fallback for hypothetical non-Uazapi throwers; a non-numeric provider_code
 *  (e.g. "circuit_breaker_open") is ignored. Returns undefined when no numeric
 *  code is present (e.g. a plain network Error). */
function extractStatusCode(err: unknown): number | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; provider_code?: unknown };
  if (typeof e.status === "number" && Number.isFinite(e.status)) return e.status;
  const pc = e.provider_code;
  if (typeof pc === "number" && Number.isFinite(pc)) return pc;
  if (typeof pc === "string" && /^\d+$/.test(pc)) return Number(pc);
  return undefined;
}

/**
 * The conservative allowlist of provider HTTP statuses that feed the P3
 * reputation state machine. LOCAL to the gate and deliberately NARROWER than the
 * shared `classifyBanSignal` set (which also includes 403 and matches ban-ish
 * response BODIES). The feed is what PR-1b's enforce flip will read, so a false
 * positive here would quarantine a HEALTHY number — the bar is "status-attested
 * strong ban", nothing softer.
 *
 *  - 463 — Meta/WhatsApp temporary restriction. The exact signal behind the
 *    chip-burn incidents (Elvéra, Bennedita Pan) this disjuntor exists for.
 *  - 429 — a real provider rate-limit ("you are sending too fast").
 *
 * NOT 403: in the HGE logs 403 is a transient 'Invalid token' with no observed
 * correlation to a real ban; feeding it would inflate ban_signal_count_24h and,
 * once enforce is on, quarantine a healthy number on noise.
 * NOT a body-only match: a 500/400 whose body happens to contain
 * "rate/block/spam/forbidden" is a server/validation error wearing a ban's
 * clothes — trusting the body would let it over-count the feed. The shared
 * `classifyBanSignal` keeps its body heuristic for the coarse, count-only
 * token-hash telemetry path; the enforce-grade feed demands a strong status.
 *
 * If evidence later shows 403 (or a body pattern) correlates with real bans,
 * WIDENING this set is a deliberate data decision for PR-1b — never a silent
 * change here. Keeping it tight is what keeps the PR-1a shadow clean, and a
 * clean shadow is the input that decides the enforce flip.
 */
const FEED_BAN_STATUSES: ReadonlySet<number> = new Set([463, 429]);

/**
 * Feed the P3 reputation state machine from a FAILED send — the anti-ban
 * disjuntor's ONLY input. This runs at the single choke point (the gate),
 * inside the catch of a send that already threw, so:
 *  - the send did NOT happen (we are on the error path);
 *  - it is best-effort / fail-soft (never throws — a feed failure can NEVER
 *    change the send outcome; see the module contract);
 *  - it is EXCLUSIVE to the gate — the UazapiClient's own token-hash telemetry
 *    path stays dormant (its `instanceId` is undefined), so no double-count.
 *
 * Decision rule: feed ONLY when the send error's own NUMERIC status is in the
 * conservative allowlist (FEED_BAN_STATUSES = {463, 429}). We deliberately do
 * NOT reuse `classifyBanSignal`'s generic `isBanSignal` for the feed: that also
 * fires on 403 and on a ban-ish body under a non-ban status (e.g. a 500 whose
 * body says "rate limited"), both of which would pollute the enforce feed. The
 * shared classifier stays untouched (other consumers still rely on it).
 *
 * Guards: only with a trusted `ctx.instanceId` (a real id to attribute the
 * signal to) AND a non-manual category (a human send must never quarantine a
 * number). The instance id comes from the caller's job/auth context, never a
 * request body; `record_ban_signal` (SECURITY DEFINER, service_role only)
 * resolves the org internally.
 */
async function feedBanSignalBestEffort(
  deps: GovernSendDeps,
  supabaseAdmin: GovernorSupabaseClient,
  ctx: GovernorContext,
  err: unknown,
): Promise<void> {
  try {
    if (!ctx.instanceId || ctx.category === "manual") return;
    // Gate the feed on the STRONG numeric status alone (not the shared body-aware
    // classifier). extractStatusCode reads err.status / err.provider_code; a
    // non-numeric status (e.g. the string "463") yields undefined and is dropped
    // — the real UazapiError always carries a numeric status, so a string status
    // is a hypothetical we keep on the conservative side.
    const code = extractStatusCode(err);
    if (typeof code !== "number" || !FEED_BAN_STATUSES.has(code)) return;
    await deps.recordBanSignal(supabaseAdmin, ctx.instanceId, code);
  } catch {
    // fail-soft — the ban-signal feed can NEVER change the send outcome.
  }
}

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
// "loga 1×": trackSource fora do vocabulário do dedup é logado uma vez por valor
// distinto (não a cada send) — visibilidade sem floodar o runtime_logs. Um valor
// que aparece aqui = caminho que o dedup NÃO cobre; sinal pra mapear ou justificar.
const _loggedUnknownDedupSources = new Set<string>();
function logUnknownDedupSource(orgId: string, trackSource: string): void {
  if (_loggedUnknownDedupSources.has(trackSource)) return;
  _loggedUnknownDedupSources.add(trackSource);
  void logRuntime({
    organizationId: orgId,
    module: "outbound",
    action: "dedup_source_unknown",
    status: "skipped",
    payloadSnapshot: { track_source: trackSource },
  });
}

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

  // ── Assinatura da org ─────────────────────────────────────────────────────
  // Primeiro de tudo, e antes até do 'manual_exempt': org com assinatura
  // bloqueada não envia NADA. O gate de RLS não alcança aqui — o backend roda
  // como service_role e bypassa policy. Sem este ponto, suspender uma org
  // deixava automação, follow-up, campanha e Copilot cuspindo WhatsApp (e
  // queimando custo) por tempo indeterminado.
  //
  // Aqui no choke porque TODOS os caminhos de envio passam por governSend:
  // os helpers de whatsapp-dispatch, copilot-v2-worker, dispatch-router,
  // followup-sender e outbound-sender. Colocar nos callers deixaria buraco.
  //
  // Fail-open (isOrgBlocked engole erro e devolve false): blip de banco não
  // pode calar org pagante.
  if (await isOrgBlocked(supabaseAdmin, ctx.orgId)) {
    // await (e não fire-and-forget): não há envio para proteger de latência
    // aqui, e este é o registro de que uma org suspensa tentou disparar — num
    // isolate de vida curta o `void` pode morrer antes de escrever.
    await logRuntime({
      organizationId: ctx.orgId,
      module: "billing",
      action: "send_bloqueado_assinatura",
      status: "skipped",
      payloadSnapshot: { category: ctx.category, track_source: ctx.trackSource },
    }).catch(() => {});
    return makeSkipped({
      action: "block",
      wouldBe: "block",
      reason: "subscription_blocked",
      category: ctx.category,
      mode: "enforce",
      shadowed: false,
    });
  }

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

  // ── Dedup conversacional (#1156) — gate PRÉ-send, no choke único ──────────
  // Roda no ramo allow (governor não bloqueou), ANTES do doSend E do accounting
  // pós-send. Como mora aqui dentro, cobre TODOS os callers diretos de governSend
  // (copilot-v2-worker, dispatch-router, followup-sender, outbound-sender +
  // helpers do whatsapp-dispatch) — o v2 chamava governSend direto e bypassava
  // o fix que morava nas closures. Suprimir aqui, antes do incrementAutomationUsage,
  // também evita que a duplicata conte como uso (over-count que o Crivo apontou).
  //
  // FAIL-OPEN total: sem content, source desconhecido, kill-switch OFF, ou erro
  // de infra → NÃO barra, segue pro doSend. Nunca dropa por hiccup.
  if (ctx.content && ctx.recipientPhone && conversationalDedupEnabled(ctx.orgId)) {
    const source = deriveSendSource(ctx.trackSource);
    if (source) {
      try {
        const { duplicate, ttlSeconds } = await reserveSendOrSkip({
          supabase: supabaseAdmin,
          orgId: ctx.orgId,
          phone: ctx.recipientPhone,
          content: ctx.content,
          source,
          idempotencyKey: ctx.idempotencyKey ?? undefined,
        });
        if (duplicate) {
          const phoneHash = await hashContent(ctx.recipientPhone);
          await logRuntime({
            organizationId: ctx.orgId,
            module: "outbound",
            action: "dedup_skip",
            status: "skipped",
            payloadSnapshot: {
              source,
              phone_hash: phoneHash,
              ttl: ttlSeconds ?? getDefaultWindow(source),
              chunk: Boolean(ctx.idempotencyKey),
            },
          });
          return {
            __governorSkipped: true,
            action: "block",
            reason: "dedup_conversational",
            category: ctx.category,
          } as unknown as T | SkippedSend;
        }
      } catch (err) {
        // Fail-open: qualquer erro no dedup → segue enviando (reserveSendOrSkip
        // já é fail-open; este catch é belt-and-braces).
        console.warn("[governSend] dedup gate error, sending anyway:", err instanceof Error ? err.message : err);
      }
    } else if (ctx.trackSource) {
      // trackSource fora do vocabulário → pula dedup (fail-open), loga 1×.
      logUnknownDedupSource(ctx.orgId, ctx.trackSource);
    }
  }

  // ── Allow (incl. shadow + fail-open): send EXACTLY ONCE, outside the guard ─
  // A throw here propagates to the caller (current semantics) and can never be
  // double-executed by the governor's own error handling. On a throw we feed the
  // reputation state machine at this single choke (best-effort, fail-soft) and
  // re-raise the ORIGINAL error unchanged — the caller sees exactly what it saw
  // before. doSend still runs exactly once (the catch never re-invokes it).
  let result: T;
  try {
    result = await doSend();
  } catch (err) {
    await feedBanSignalBestEffort(deps, supabaseAdmin, ctx, err);
    throw err;
  }

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
