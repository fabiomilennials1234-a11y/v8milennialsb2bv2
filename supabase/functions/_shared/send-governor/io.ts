/**
 * send-governor/io — DB seam for the Send Governor. All functions are FAIL-SOFT;
 * resolveGovernorState is explicitly FAIL-OPEN.
 *
 * Contrast with the blast budgets (instance-budget.ts / daily-budget.ts), which
 * fail CLOSED (a read error resolves to "cap consumed"): the governor's prime
 * directive is the opposite — it must NEVER be a single point of failure for a
 * send. So every read here degrades to the MOST PERMISSIVE value (mode 'off',
 * usedToday 0, reputation 'healthy', high cap, isColdContact false) → allow.
 *
 * No Deno-only TOP-LEVEL import: the module takes the Supabase client as a
 * parameter and lazily/guardedly imports logger.ts only where Deno exists, so
 * it stays importable under Node/Vitest (mirrors reputation-signal.ts).
 */

import type {
  GovernorContext,
  GovernorDecision,
  GovernorState,
  GovernorSupabaseClient,
  ReputationState,
  ResolveStateInput,
} from "./types.ts";
import { GOVERNOR_DEFAULT_CAP } from "./core.ts";
import { resolveInstanceCap } from "../quick-blast/instance-budget.ts";
import { saoPauloUsageDate } from "../quick-blast/daily-budget.ts";

/** Build the fully-permissive state (yields `allow` from evaluateSend). */
function permissiveState(nowIso: string): GovernorState {
  return {
    mode: "off",
    warmupEnabled: false,
    coldGateEnabled: false,
    usedToday: 0,
    instanceCap: GOVERNOR_DEFAULT_CAP,
    instanceAgeDays: null,
    reputation: "healthy",
    quarantineUntil: null,
    isColdContact: false,
    nowIso,
  };
}

function normalizeMode(raw: unknown): GovernorState["mode"] {
  return raw === "shadow" || raw === "enforce" ? raw : "off";
}

function normalizeReputation(raw: unknown): ReputationState {
  return raw === "warming" || raw === "quarantined" ? raw : "healthy";
}

/** Minimal Brazilian phone normalizer (inlined to avoid pulling the heavy
 *  whatsapp-dispatch dependency graph into this light module). */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, "");
  if (p.length === 0) return null;
  if (!p.startsWith("55")) p = "55" + p;
  return p;
}

/** Whole-day age of a number from its created_at, relative to nowIso. */
function ageDaysFrom(createdAt: unknown, nowIso: string): number | null {
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;
  const created = Date.parse(createdAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(created) || Number.isNaN(now)) return null;
  const days = Math.floor((now - created) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * A cold contact = a lead we have NEVER received an inbound WhatsApp message
 * from (no prior engagement). Cheap existence check against channel_messages,
 * scoped by org. Only consulted when the cold gate is enabled (default off) and
 * the send is automation — so it is dormant in PR-0. Fail-open: any error →
 * false ("not cold", do not block).
 *
 * NOTE (PR-0 assumption, flag for review before enabling the cold gate): the
 * "no opt-in tag" half of the definition is intentionally NOT implemented — the
 * schema has no defined opt-in-tag convention yet, and inventing one would be
 * fragile coupling. Cold here means strictly "no prior inbound".
 */
async function resolveIsColdContact(
  supabaseAdmin: GovernorSupabaseClient,
  orgId: string,
  phone: string,
): Promise<boolean> {
  const normalized = normalizePhone(phone) ?? phone;
  // channel_messages.direction CHECK is ('incoming','outgoing') — an inbound
  // message from the lead is 'incoming'. (Using 'inbound' here would match zero
  // rows → every contact reads as cold → P4 enforce would block ALL automation.)
  const { count, error } = await supabaseAdmin
    .from("channel_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("direction", "incoming")
    .eq("phone_number", normalized)
    .limit(1);
  if (error) return false; // fail-open — never block on a read error
  return (count ?? 0) === 0;
}

/**
 * Resolve the full governor state for a send. FAIL-OPEN throughout: the org row
 * is the primary read; if the org is 'off' we short-circuit (1 read) so inert
 * orgs pay almost nothing. Every sub-read degrades permissive on error.
 */
export async function resolveGovernorState(
  supabaseAdmin: GovernorSupabaseClient,
  input: ResolveStateInput,
): Promise<GovernorState> {
  const nowIso = new Date().toISOString();
  try {
    // 1. Org config (primary). On failure → permissive/off.
    let mode: GovernorState["mode"] = "off";
    let warmupEnabled = false;
    let coldGateEnabled = false;
    try {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select(
          "send_governor_mode, send_governor_warmup_enabled, send_governor_cold_gate_enabled",
        )
        .eq("id", input.orgId)
        .maybeSingle();
      mode = normalizeMode(data?.send_governor_mode);
      warmupEnabled = data?.send_governor_warmup_enabled === true;
      coldGateEnabled = data?.send_governor_cold_gate_enabled === true;
    } catch {
      return permissiveState(nowIso);
    }

    // Short-circuit: inert org pays for exactly one read.
    if (mode === "off") return { ...permissiveState(nowIso), mode: "off" };

    let instanceCap = GOVERNOR_DEFAULT_CAP;
    let instanceAgeDays: number | null = null;
    let reputation: ReputationState = "healthy";
    let quarantineUntil: string | null = null;
    let usedToday = 0;

    if (input.instanceId) {
      // 2. Per-number base cap + age.
      try {
        const { data } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("daily_blast_cap, created_at")
          .eq("id", input.instanceId)
          .maybeSingle();
        instanceCap = resolveInstanceCap(data?.daily_blast_cap);
        instanceAgeDays = ageDaysFrom(data?.created_at, nowIso);
      } catch {
        instanceCap = GOVERNOR_DEFAULT_CAP;
      }

      // 3. Reputation.
      try {
        const { data } = await supabaseAdmin
          .from("whatsapp_instance_reputation")
          .select("state, quarantine_until")
          .eq("instance_id", input.instanceId)
          .maybeSingle();
        reputation = normalizeReputation(data?.state);
        quarantineUntil = (data?.quarantine_until as string | null) ?? null;
      } catch {
        reputation = "healthy";
      }

      // 4. Automation usage today (Sao Paulo calendar date). Only automation
      //    is capped; skip the read for mass/system.
      if (input.category === "automation") {
        try {
          const { data } = await supabaseAdmin
            .from("automation_instance_daily_usage")
            .select("sent")
            .eq("instance_id", input.instanceId)
            .eq("usage_date", saoPauloUsageDate())
            .maybeSingle();
          const s = data?.sent;
          usedToday = typeof s === "number" && Number.isFinite(s) && s >= 0
            ? Math.floor(s)
            : 0;
        } catch {
          usedToday = 0; // fail-open (under cap)
        }
      }
    }

    // 5. Cold-contact — only when enabled + automation + a phone is known.
    let isColdContact = false;
    if (
      coldGateEnabled && input.category === "automation" && input.recipientPhone
    ) {
      try {
        isColdContact = await resolveIsColdContact(
          supabaseAdmin,
          input.orgId,
          input.recipientPhone,
        );
      } catch {
        isColdContact = false;
      }
    }

    return {
      mode,
      warmupEnabled,
      coldGateEnabled,
      usedToday,
      instanceCap,
      instanceAgeDays,
      reputation,
      quarantineUntil,
      isColdContact,
      nowIso,
    };
  } catch {
    return permissiveState(nowIso);
  }
}

/**
 * Keyed one-way recipient pseudonym for telemetry. A raw recipient phone is a
 * lead's PII and must never hit runtime_logs (LGPD). A plain hash is NOT enough:
 * the Brazilian mobile keyspace (~10 digits) is small enough to brute-force /
 * rainbow-table any unsalted digest back to the phone. So we use HMAC-SHA256
 * keyed by a server-only secret (SEND_GOVERNOR_HASH_SALT), truncated to 16 hex
 * — irreversible without the key, still stable for correlation.
 *
 * If no salt is configured we return null (log NOTHING) rather than emit a
 * reversible pseudonym. Async + Web Crypto; only reached from recordDecision,
 * which is already Deno-gated, so Node/Vitest never calls this.
 */
async function hashPhone(
  phone: string | null | undefined,
): Promise<string | null> {
  if (!phone) return null;
  const deno = (globalThis as {
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  }).Deno;
  const salt = deno?.env?.get?.("SEND_GOVERNOR_HASH_SALT");
  if (!salt) return null; // no key → do not log a reversible pseudonym
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(salt),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(phone));
    const bytes = new Uint8Array(sig);
    let hex = "";
    for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex; // 16 hex chars
  } catch {
    return null; // never let telemetry hashing surface an error
  }
}

/**
 * Persist the governor decision to runtime_logs (module 'governor'). Fail-soft:
 * telemetry never affects a send. Node/Vitest-safe: logger.ts is imported
 * lazily and only where Deno exists (mirrors reputation-signal.ts).
 */
export async function recordDecision(
  _supabaseAdmin: GovernorSupabaseClient,
  ctx: GovernorContext,
  state: GovernorState,
  decision: GovernorDecision,
): Promise<void> {
  try {
    const deno = (globalThis as {
      Deno?: { env?: { get?: (k: string) => string | undefined } };
    }).Deno;
    if (typeof deno?.env?.get !== "function") return; // Node/Vitest → no-op
    const { logRuntime } = await import("../logger.ts");
    await logRuntime({
      organizationId: ctx.orgId,
      module: "governor",
      action: "governor_decision",
      status: decision.action === "allow" ? "success" : "skipped",
      entityType: "whatsapp_instance",
      entityId: ctx.instanceId ?? undefined,
      payloadSnapshot: {
        mode: decision.mode,
        category: decision.category,
        action: decision.action,
        would_be: decision.wouldBe,
        reason: decision.reason,
        shadowed: decision.shadowed,
        retry_at: decision.retryAt ?? null,
        used_today: state.usedToday,
        instance_cap: state.instanceCap,
        instance_age_days: state.instanceAgeDays,
        reputation: state.reputation,
        recipient_hash: await hashPhone(ctx.recipientPhone),
      },
    });
  } catch {
    // fail-soft — the send outcome must never depend on telemetry
  }
}

/** Atomically add 1 to the per-number automation usage ledger (Sao Paulo date).
 *  Called ONLY after a real successful send. Fail-soft. */
export async function incrementAutomationUsage(
  supabaseAdmin: GovernorSupabaseClient,
  instanceId: string,
  count = 1,
): Promise<void> {
  try {
    await supabaseAdmin.rpc("increment_automation_daily_usage", {
      p_instance_id: instanceId,
      p_usage_date: saoPauloUsageDate(),
      p_count: count,
    });
  } catch {
    // fail-soft — the send already happened; a lost increment is acceptable
  }
}

/** Feed a ban signal into the reputation state machine (record_ban_signal RPC).
 *  The DB-backed bridge, called from a layer that HAS the instance_id (unlike
 *  the uazapi-client physical sink, which only holds a token hash). Fail-soft. */
export async function recordBanSignal(
  supabaseAdmin: GovernorSupabaseClient,
  instanceId: string,
  code: number,
): Promise<void> {
  try {
    await supabaseAdmin.rpc("record_ban_signal", {
      p_instance_id: instanceId,
      p_code: code,
    });
  } catch {
    // fail-soft — telemetry / reputation update never breaks a caller
  }
}
