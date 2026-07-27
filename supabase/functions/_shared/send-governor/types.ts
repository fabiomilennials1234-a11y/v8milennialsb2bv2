/**
 * send-governor/types — shared contracts for the Send Governor (anti-ban).
 *
 * The governor is a single, mandatory choke point that every WhatsApp send
 * SHOULD pass through (wired incrementally). It splits into three layers so the
 * decision logic stays pure and testable:
 *
 *   core.ts  — evaluateSend(ctx, state): pure, zero IO (mirrors quiet-hours.ts).
 *   io.ts    — resolveGovernorState / recordDecision / usage + ban-signal RPCs.
 *              All fail-soft; resolveGovernorState is FAIL-OPEN.
 *   gate.ts  — governSend(supabaseAdmin, ctx, doSend): orchestrates + FAIL-OPEN.
 *
 * FAIL-OPEN is sacred: any error/timeout in the governor lets the send through.
 * The governor is NEVER a single point of failure for delivery.
 */

/** How a send is classified. Drives which rules apply.
 *  - 'manual'     — a human hit send. ALWAYS allowed (exempt), any mode.
 *  - 'automation' — copilot turn / follow-up / workflow / pipe / campaign.
 *                   Subject to P1 cap, P2 warm-up, P3 quarantine, P4 cold gate.
 *  - 'mass'       — blast / /sender/*. Only P3 (quarantine) here; volume caps
 *                   are enforced by the existing blast_* ledgers, not re-done.
 *  - 'system'     — internal/system messages. Exempt in PR-0. */
export type SendCategory = "manual" | "automation" | "mass" | "system";

/** Per-number reputation (whatsapp_instance_reputation.state). */
export type ReputationState = "healthy" | "warming" | "quarantined";

/** Per-org governor mode (organizations.send_governor_mode). */
export type GovernorMode = "off" | "shadow" | "enforce";

/** The action the governor decides.
 *  - 'allow' — proceed with the send.
 *  - 'block' — do not send (quarantine / cold contact).
 *  - 'defer' — do not send now; retry later (per-number cap reached). */
export type GovernorAction = "allow" | "block" | "defer";

/** Machine-readable reason codes (stable — safe to query in runtime_logs). */
export type GovernorDecisionReason =
  | "governor_off"     // mode 'off' → inert
  | "manual_exempt"    // manual category → always allowed
  | "quarantined"      // P3 disjuntor tripped
  | "per_number_cap"   // P1/P2 per-number daily cap reached
  | "cold_contact"     // P4 cold-contact gate
  | "allowed"          // evaluated, nothing tripped
  | "dedup_conversational"; // #1156 — conteúdo idêntico repetido (loop travado)
                            // barrado no choke ANTES do provider. Não é decisão
                            // de reputação; é dedup por frequência (send-dedup).

/**
 * GovernorContext — the request facts the CALLER (wiring) knows at the send
 * site. Never carries organization_id from a request body; the caller passes
 * the trusted org id from its job/auth context.
 */
export interface GovernorContext {
  /** Owning org (trusted; from job/auth context, never a request body). */
  orgId: string;
  /** WhatsApp number sending. Optional — some paths resolve it late; when
   *  absent, per-number caps/reputation cannot apply and the send is allowed. */
  instanceId?: string | null;
  /** Classification (usually explicit at the wiring seam; see deriveCategory). */
  category: SendCategory;
  /** Recipient phone. Only ever logged HASHED (never raw). */
  recipientPhone?: string | null;
  /** Optional provider trackSource, for deriveCategory when category is implicit. */
  trackSource?: string | null;
  /** #1156 — texto do envio, para o dedup conversacional DENTRO do governSend
   *  (hasheado, nunca logado cru). Ausente → dedup pula (fail-open). */
  content?: string | null;
  /** #1156 — chave de idempotência por mensagem lógica + índice de chunk. Faz
   *  chunks distintos da MESMA reply não colidirem no dedup de conteúdo. */
  idempotencyKey?: string | null;
}

/**
 * GovernorState — everything the io layer resolves from the DB (fail-open).
 * Passed alongside the context into the pure evaluateSend.
 */
export interface GovernorState {
  /** Resolved org mode. On any read failure → 'off' (fail-open / inert). */
  mode: GovernorMode;
  /** Org warm-up switch (P2). */
  warmupEnabled: boolean;
  /** Org cold-gate switch (P4). */
  coldGateEnabled: boolean;
  /** Automation sends already made from this number today (Sao Paulo date).
   *  On read failure → 0 (fail-open: appears under cap). */
  usedToday: number;
  /** Per-number base cap (whatsapp_instances.daily_blast_cap, resolved). */
  instanceCap: number;
  /** Number age in days (from created_at); null when unknown → no warm-up
   *  restriction (fail-open). */
  instanceAgeDays: number | null;
  /** Current reputation. On read failure → 'healthy' (fail-open). */
  reputation: ReputationState;
  /** ISO quarantine expiry, or null (indefinite when reputation quarantined). */
  quarantineUntil: string | null;
  /** Whether the recipient is a cold contact. Only resolved when the cold gate
   *  is enabled + category automation; otherwise false. */
  isColdContact: boolean;
  /** Evaluation clock (ISO). Injected so the pure core stays deterministic. */
  nowIso: string;
}

/**
 * GovernorDecision — the pure verdict.
 *
 * `action` is the EFFECTIVE action the gate will take. In SHADOW mode `action`
 * is ALWAYS 'allow' (shadow never blocks/defers); `wouldBe` preserves what
 * enforce WOULD have done, and `shadowed` is true when a would-be block/defer
 * was flipped to allow. Outside shadow, action === wouldBe.
 */
export interface GovernorDecision {
  action: GovernorAction;
  /** What enforce would do (== action outside shadow). */
  wouldBe: GovernorAction;
  reason: GovernorDecisionReason;
  category: SendCategory;
  mode: GovernorMode;
  /** ISO retry hint when wouldBe === 'defer' (approx next day). */
  retryAt?: string;
  /** True only when shadow turned a would-be block/defer into an allow. */
  shadowed: boolean;
}

/**
 * SkippedSend — returned by governSend when enforce blocks/defers (so the send
 * did NOT happen). Discriminated by `__governorSkipped`. In shadow/off the send
 * always runs, so callers only ever see this under enforce.
 */
export interface SkippedSend {
  __governorSkipped: true;
  action: "block" | "defer";
  reason: GovernorDecisionReason;
  category: SendCategory;
  retryAt?: string;
}

/** Minimal Supabase client surface the governor io layer needs. Kept structural
 *  so the pure/orchestration code never depends on the concrete SDK type. */
export interface GovernorSupabaseClient {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any;
}

/** Input subset resolveGovernorState needs (a slice of GovernorContext). */
export interface ResolveStateInput {
  orgId: string;
  instanceId?: string | null;
  category: SendCategory;
  recipientPhone?: string | null;
}
