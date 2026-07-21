/**
 * send-governor — WhatsApp anti-ban Send Governor for AUTOMATION (workflow) sends.
 *
 * The single choke every workflow-driven WhatsApp send passes through, replacing
 * the ad-hoc fixed 3s throttle. It NEVER fails a send: when a volume/time control
 * trips, it DEFERS (reschedules the workflow node) instead of erroring. Every
 * lever sits behind its own sub-flag with a `shadow → enforce` progression, and
 * the whole thing is gated by an org master flag that is a PERFECT NO-OP when off.
 *
 * ─── Inviolable safety property ──────────────────────────────────────────────
 * With the master flag OFF (organizations.workflow_send_governor_enabled = false),
 * governOutboundSend() behaves EXACTLY like the pre-existing code: the legacy
 * fixed 3s inter-message throttle, no cap, no quiet-hours, no defer. Flag OFF =
 * byte-identical behaviour. This makes the merge/deploy safe by construction.
 *
 * ─── Levers (Onda 1) ─────────────────────────────────────────────────────────
 *  - jitter        : replaces the fixed 3s with a random [3000,8000]ms spacing
 *                    since the last outgoing on the number. REUSES the anti-ban
 *                    Onda 0 module (anti-ban-jitter.ts) as the canonical range —
 *                    a workflow send now jitters identically to the mass/cron
 *                    workers. Small wait → sleep inline; large wait → DEFER
 *                    (protects the edge batch timeout).
 *  - instance cap  : per-WhatsApp-number daily ceiling. Reuses the blast ledger
 *                    (blast_instance_daily_usage) — the budget is SHARED with Mass
 *                    Send on purpose. Exhausted → defer to next BRT midnight.
 *  - org cap       : org-wide daily ceiling. Reuses blast_daily_usage. Shared with
 *                    Mass Send. Exhausted → defer to next BRT midnight.
 *  - quiet hours   : channel-agnostic time guard (default 08:00–20:00 Mon–Sat BRT,
 *                    opt-out). Outside the window → defer to next open + a random
 *                    morning-spread (anti thundering-herd at open).
 *
 * Warm-up ramp and cold-lead gate are Onda 2 (a later PR) — deliberately NOT here.
 * The lever shape (mode per lever, defer-first) is designed to extend to them.
 *
 * ─── Reputation (Onda 0 reconciliation) ──────────────────────────────────────
 * Ban-signal telemetry (reputation-signal.ts) is already wired at the transport
 * layer (uazapi-client.ts) BENEATH every send this governor gates. The governor
 * therefore does NOT re-record ban signals — it would double-count. Consuming that
 * signal to gate cold contacts is the Onda 2 cold-lead gate, not this PR.
 *
 * ─── Defer safety (the biggest risk) ─────────────────────────────────────────
 * A previous incident (wait_business_window) left executions stuck forever in
 * `processing`. Non-negotiable guards, all enforced here + in workflow-executor:
 *  1. deferUntil is ALWAYS clamped to > now + 60s (never past/now → cron 1-min loop).
 *  2. After N defers on a node the governor FAILS OPEN (sends) — a stuck lead is
 *     worse than one extra message.
 *  3. A DB READ blip on a cap ledger → SHORT defer (minutes), not defer-till-reset,
 *     so a transient blip can never freeze automation for a whole day.
 *  4. The executor adds a loop-detection skip marker for governor-deferred nodes.
 *  5. claim_workflow_executions filters next_run_at <= now, so a future defer holds.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";
import { enforceWhatsAppRateLimit, getLastOutgoingAt } from "./whatsapp-helpers.ts";
import { JITTER_MIN_MS, JITTER_MAX_MS, jitterDelayMs } from "../anti-ban-jitter.ts";
import {
  blastDailyUsageSource,
  computeDailyClamp,
  resolveDailyBudget,
  saoPauloUsageDate,
  BLAST_BUDGET_TIMEZONE,
  DEFAULT_DAILY_BUDGET,
  type BlastUsageSource,
} from "../quick-blast/daily-budget.ts";
import {
  instanceDailyUsageSource,
  resolveInstanceCap,
  type InstanceUsageSource,
} from "../quick-blast/instance-budget.ts";
import { nextValidSendTime, type QuietWindow } from "../quick-blast/quiet-hours.ts";
import { addDaysIso } from "../quick-blast/plan-slicing.ts";
import { buildDateInTimezone, getHourMinutesInTimezone } from "../copilot/time-context.ts";
import { logRuntime } from "../logger.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Pre-existing fixed inter-message throttle. The flag-OFF / shadow behaviour. */
export const LEGACY_INTERVAL_MS = 3000;
/** Jitter waits up to this are slept inline; longer waits DEFER (batch safety). */
export const MAX_INLINE_WAIT_MS = 3000;
/** A DB-blip transient defer — short, so a hiccup never freezes a whole day. */
export const SHORT_DEFER_MS = 5 * 60_000;
/** Guard #1: every deferUntil is pushed to at least now + this. */
export const MIN_DEFER_LEAD_MS = 60_000;

const DEFAULTS = {
  // Canonical jitter range is OWNED by anti-ban-jitter.ts (Onda 0). Reusing the
  // constants keeps the workflow governor and the mass/cron workers on one range.
  jitterMin: JITTER_MIN_MS, // 3000
  jitterMax: JITTER_MAX_MS, // 8000
  quietDays: [1, 2, 3, 4, 5, 6], // Mon–Sat (0=Sun … 6=Sat)
  quietFrom: 480, // 08:00
  quietTo: 1200, // 20:00
  morningSpreadMaxMin: 90,
  timezone: BLAST_BUDGET_TIMEZONE, // America/Sao_Paulo
  maxDefers: 5,
  /** Governor ON ⇒ protections ON (opt-out per lever via the JSONB). */
  defaultLeverMode: "enforce" as LeverMode,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type SendClass = "automation" | "operator_notification" | "reminder" | "campaign";
export type LeverMode = "off" | "shadow" | "enforce";

export interface QuietHoursConfig {
  mode: LeverMode;
  days: number[];
  fromMinutes: number;
  toMinutes: number;
  morningSpreadMaxMin: number;
  timezone: string;
}

export interface GovernorConfig {
  /** Master flag (organizations.workflow_send_governor_enabled). OFF = no-op. */
  enabled: boolean;
  jitter: { mode: LeverMode; minMs: number; maxMs: number };
  instanceCap: { mode: LeverMode };
  orgCap: { mode: LeverMode };
  quietHours: QuietHoursConfig;
  /** organizations.daily_blast_budget (fail-closed resolved). */
  orgDailyBudget: number;
  maxDefers: number;
}

export interface GovernorDecision {
  decision: "send" | "defer";
  /** ISO. Present only for defer. Always > now + 60s (clamped). */
  deferUntil?: string;
  reason?: string;
  /** The instant the decision was taken (reused by the caller for commit). */
  now: Date;
}

type UsageRead = { ok: true; used: number } | { ok: false };

export interface GovernorInput {
  supabase: SupabaseClient;
  organizationId: string;
  /** WhatsApp instance id. Absent for non-WhatsApp channels (e.g. Meta). */
  instanceId?: string;
  /** whatsapp_instances.daily_blast_cap (per-number ceiling). */
  instanceCapRaw?: number | null;
  /** Graph node id — the defer-count key (matches workflow-executor). */
  nodeId: string;
  /** How many times this node has already been governor-deferred. */
  deferCount: number;
  sendClass: SendClass;
  config: GovernorConfig;
  now?: Date;
  rng?: () => number;
  // Injectable IO seams (default to production impls) — keeps the core unit-testable.
  readInstanceUsage?: (instanceId: string, usageDate: string) => Promise<UsageRead>;
  readOrgUsage?: (orgId: string, usageDate: string) => Promise<UsageRead>;
  getLastOutgoing?: (instanceId: string) => Promise<number | null>;
}

// ─── Pure helpers (heavily unit-tested) ──────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x) || x < 0) return 0;
  if (x >= 1) return 0.999999;
  return x;
}

/** Random integer in [minMs, maxMs] (inclusive). Used for a config-overridden
 *  jitter range; the DEFAULT range delegates to anti-ban-jitter.ts (see
 *  pickJitterTarget). */
export function pickJitterInterval(minMs: number, maxMs: number, rng: () => number): number {
  const lo = Math.max(0, Math.floor(minMs));
  const hi = Math.max(lo, Math.floor(maxMs));
  return lo + Math.floor(clamp01(rng()) * (hi - lo + 1));
}

/**
 * Resolve the target inter-message spacing (ms). REUSES the Onda 0 canonical
 * jitter (anti-ban-jitter.jitterDelayMs) whenever the org keeps the default
 * range, so workflow sends space out exactly like the mass/cron workers. Only an
 * org that tuned min_ms/max_ms in its JSONB takes the config-driven path.
 */
export function pickJitterTarget(
  jitter: { minMs: number; maxMs: number },
  rng: () => number,
): number {
  if (jitter.minMs === JITTER_MIN_MS && jitter.maxMs === JITTER_MAX_MS) {
    return jitterDelayMs(rng);
  }
  return pickJitterInterval(jitter.minMs, jitter.maxMs, rng);
}

/** Wait still owed before the next send, given the target spacing. */
export function computeJitterWait(
  targetIntervalMs: number,
  lastOutgoingAt: number | null,
  nowMs: number,
): number {
  if (lastOutgoingAt == null) return 0;
  return Math.max(0, targetIntervalMs - (nowMs - lastOutgoingAt));
}

/** Guard #1 — force a deferUntil to sit safely in the future (> now + lead). */
export function clampDeferUntil(deferUntil: Date, now: Date, minLeadMs = MIN_DEFER_LEAD_MS): Date {
  const floor = now.getTime() + minLeadMs;
  return deferUntil.getTime() < floor ? new Date(floor) : deferUntil;
}

/** Guard #2 — after N defers on a node, stop deferring and let the send through. */
export function shouldFailOpen(deferCount: number, maxDefers: number): boolean {
  return deferCount >= maxDefers;
}

/** The tz calendar date (YYYY-MM-DD) for an instant — the ledger partition key. */
function tzCalendarDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Wall-clock "YYYY-MM-DDTHH:mm" of an instant in a timezone (quiet-hours math). */
function tzWallClock(now: Date, tz: string): string {
  const date = tzCalendarDate(now, tz);
  const { hour, minute } = getHourMinutesInTimezone(now, tz);
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The next midnight (00:00) in `tz`, as a UTC instant — the cap reset boundary. */
export function nextMidnightUtc(now: Date, tz: string): Date {
  const tomorrow = addDaysIso(tzCalendarDate(now, tz), 1);
  const midnight = buildDateInTimezone(tomorrow, "00:00", tz);
  return midnight ?? new Date(now.getTime() + 6 * 3_600_000);
}

/**
 * Quiet-hours defer target, or null when the current instant is inside the window.
 * Outside → next window open + a random spread in [0, morningSpreadMaxMin) minutes
 * (so a herd of executions waiting for 08:00 does not all fire at the same second).
 */
export function quietHoursDeferUntil(
  qh: QuietHoursConfig,
  now: Date,
  rng: () => number,
): Date | null {
  const tz = qh.timezone;
  const localIso = tzWallClock(now, tz);
  const window: QuietWindow = { days: qh.days, fromMinutes: qh.fromMinutes, toMinutes: qh.toMinutes };
  const nextLocal = nextValidSendTime(window, localIso);
  if (nextLocal === localIso) return null; // already inside the window → send now

  const [datePart, timePart] = nextLocal.split("T");
  const openUtc = buildDateInTimezone(datePart, timePart, tz);
  if (!openUtc) return null; // conversion failed → never manufacture a bogus defer

  const spreadMs = Math.floor(clamp01(rng()) * (qh.morningSpreadMaxMin * 60_000));
  return new Date(openUtc.getTime() + spreadMs);
}

function laterOf(a: Date | null, b: Date): Date {
  return a && a.getTime() >= b.getTime() ? a : b;
}

/** Quiet-hours never gates operator hand-off notifications or meeting reminders. */
export function isQuietHoursExempt(sendClass: SendClass): boolean {
  return sendClass === "operator_notification" || sendClass === "reminder";
}

// ─── Config resolution ───────────────────────────────────────────────────────

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function coerceMode(v: unknown, fallback: LeverMode): LeverMode {
  return v === "off" || v === "shadow" || v === "enforce" ? v : fallback;
}

function coerceIntInRange(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const f = Math.floor(n);
  if (f < min || f > max) return fallback;
  return f;
}

function coerceDays(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const days = v
    .map((d) => (typeof d === "number" ? Math.floor(d) : Number(d)))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return days.length > 0 ? Array.from(new Set(days)) : fallback;
}

/** Merge the org's stored JSONB over the code defaults. Pure. */
export function mergeGovernorConfig(
  enabled: boolean,
  raw: Record<string, unknown> | null,
  orgDailyBudget: number,
): GovernorConfig {
  const r = raw ?? {};
  const defMode = DEFAULTS.defaultLeverMode;
  const jitterRaw = asObj(r.jitter);
  const instRaw = asObj(r.instance_cap);
  const orgRaw = asObj(r.org_cap);
  const qhRaw = asObj(r.quiet_hours);

  return {
    enabled,
    jitter: {
      mode: coerceMode(jitterRaw.mode, defMode),
      minMs: coerceIntInRange(jitterRaw.min_ms, DEFAULTS.jitterMin, 0, 600_000),
      maxMs: coerceIntInRange(jitterRaw.max_ms, DEFAULTS.jitterMax, 0, 600_000),
    },
    instanceCap: { mode: coerceMode(instRaw.mode, defMode) },
    orgCap: { mode: coerceMode(orgRaw.mode, defMode) },
    quietHours: {
      mode: coerceMode(qhRaw.mode, defMode),
      days: coerceDays(qhRaw.days, DEFAULTS.quietDays),
      fromMinutes: coerceIntInRange(qhRaw.from_minutes, DEFAULTS.quietFrom, 0, 1440),
      toMinutes: coerceIntInRange(qhRaw.to_minutes, DEFAULTS.quietTo, 0, 1440),
      morningSpreadMaxMin: coerceIntInRange(
        qhRaw.morning_spread_max_min,
        DEFAULTS.morningSpreadMaxMin,
        0,
        720,
      ),
      timezone:
        typeof qhRaw.timezone === "string" && qhRaw.timezone ? qhRaw.timezone : DEFAULTS.timezone,
    },
    orgDailyBudget,
    maxDefers: coerceIntInRange(r.max_defers, DEFAULTS.maxDefers, 1, 100),
  };
}

/**
 * Read the org's master flag + JSONB + daily budget. On ANY read error, resolve
 * to DISABLED (perfect no-op) — a DB blip must NEVER silently enable the governor
 * nor freeze automation across every org.
 */
export async function resolveGovernorConfig(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<GovernorConfig> {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("workflow_send_governor_enabled, workflow_send_governor, daily_blast_budget")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) return mergeGovernorConfig(false, null, DEFAULT_DAILY_BUDGET);
    const enabled = (data as { workflow_send_governor_enabled?: boolean } | null)
      ?.workflow_send_governor_enabled === true;
    const raw = ((data as { workflow_send_governor?: unknown } | null)?.workflow_send_governor ??
      null) as Record<string, unknown> | null;
    const budget = resolveDailyBudget(
      (data as { daily_blast_budget?: number | null } | null)?.daily_blast_budget ?? null,
    );
    return mergeGovernorConfig(enabled, raw, budget);
  } catch {
    return mergeGovernorConfig(false, null, DEFAULT_DAILY_BUDGET);
  }
}

// ─── IO reads (error-aware — distinct from the source fail-closed swallow) ────
// The blast usage sources fail-CLOSED to "cap consumed" on a read error, which is
// right for a one-shot blast but would, here, defer a workflow until midnight on a
// transient blip. Guard #3 needs to tell "genuinely exhausted" from "read failed",
// so the reads below return a discriminated result. The blast ledger tables + the
// atomic increment RPCs (via the sources, in commitOutboundSend) are still reused.

async function readInstanceUsageImpl(
  supabase: SupabaseClient,
  instanceId: string,
  usageDate: string,
): Promise<UsageRead> {
  try {
    const { data, error } = await supabase
      .from("blast_instance_daily_usage")
      .select("leads_sent")
      .eq("instance_id", instanceId)
      .eq("usage_date", usageDate)
      .maybeSingle();
    if (error) return { ok: false };
    const used = (data as { leads_sent?: number } | null)?.leads_sent;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return { ok: true, used: 0 };
    return { ok: true, used: Math.floor(used) };
  } catch {
    return { ok: false };
  }
}

async function readOrgUsageImpl(
  supabase: SupabaseClient,
  orgId: string,
  usageDate: string,
): Promise<UsageRead> {
  try {
    const { data, error } = await supabase
      .from("blast_daily_usage")
      .select("leads_sent")
      .eq("organization_id", orgId)
      .eq("usage_date", usageDate)
      .maybeSingle();
    if (error) return { ok: false };
    const used = (data as { leads_sent?: number } | null)?.leads_sent;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return { ok: true, used: 0 };
    return { ok: true, used: Math.floor(used) };
  } catch {
    return { ok: false };
  }
}

// ─── Shadow / decision logging (no PII: only counters + ids) ──────────────────

async function logGovernor(
  input: GovernorInput,
  event: "would_defer" | "would_block" | "would_throttle" | "fail_open" | "defer",
  mode: LeverMode | "enforce",
  extra: Record<string, unknown>,
): Promise<void> {
  await logRuntime({
    organizationId: input.organizationId,
    module: "whatsapp",
    action: "workflow_send_governor",
    status: mode === "shadow" ? "skipped" : "success",
    entityType: "workflow_node",
    entityId: input.nodeId,
    payloadSnapshot: {
      event,
      mode,
      send_class: input.sendClass,
      instance_id: input.instanceId ?? null,
      defer_count: input.deferCount,
      ...extra,
    },
  }).catch(() => {
    /* telemetry never breaks the send path */
  });
}

// ─── Jitter (inter-message spacing) ──────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function applyJitter(
  input: GovernorInput,
  now: Date,
  rng: () => number,
): Promise<{ defer: false } | { defer: true; deferUntil: Date }> {
  const j = input.config.jitter;
  const instanceId = input.instanceId!;
  const getLast = input.getLastOutgoing ?? ((id: string) => getLastOutgoingAt(input.supabase, id));

  if (j.mode !== "enforce") {
    // OFF or SHADOW → legacy fixed throttle (no timing change). Shadow just logs.
    if (j.mode === "shadow") {
      await logGovernor(input, "would_throttle", "shadow", {
        lever: "jitter",
        would_interval_ms: pickJitterTarget(j, rng),
      });
    }
    await enforceWhatsAppRateLimit(input.supabase, instanceId, LEGACY_INTERVAL_MS);
    return { defer: false };
  }

  const target = pickJitterTarget(j, rng);
  const last = await getLast(instanceId);
  const wait = computeJitterWait(target, last, now.getTime());
  if (wait <= 0) return { defer: false };
  if (wait <= MAX_INLINE_WAIT_MS) {
    await sleep(wait);
    return { defer: false };
  }
  // Long wait → defer instead of blocking the batch (BATCH_SIZE=20 edge timeout).
  return { defer: true, deferUntil: new Date(now.getTime() + wait) };
}

// ─── Main choke ──────────────────────────────────────────────────────────────

export async function governOutboundSend(input: GovernorInput): Promise<GovernorDecision> {
  const { config } = input;
  const now = input.now ?? new Date();
  const rng = input.rng ?? Math.random;

  // Master flag OFF → PERFECT NO-OP: legacy fixed 3s throttle, always send.
  if (!config.enabled) {
    if (input.instanceId) {
      await enforceWhatsAppRateLimit(input.supabase, input.instanceId, LEGACY_INTERVAL_MS);
    }
    return { decision: "send", now };
  }

  // Guard #2 — fail open after N defers on this node. A stuck lead beats one
  // extra message. Still throttle so we don't machine-gun on the escape hatch.
  if (shouldFailOpen(input.deferCount, config.maxDefers)) {
    await logGovernor(input, "fail_open", "enforce", { max_defers: config.maxDefers });
    if (input.instanceId) {
      await enforceWhatsAppRateLimit(input.supabase, input.instanceId, LEGACY_INTERVAL_MS);
    }
    return { decision: "send", reason: "fail_open_max_defers", now };
  }

  // The ledger date key AND the cap-reset boundary are ALWAYS the Sao Paulo day
  // (shared with Mass Send, which hardcodes it) — independent of the org's
  // quiet-hours timezone, which only shapes the quiet-hours window itself.
  const usageDate = saoPauloUsageDate(now);
  let deferUntil: Date | null = null;
  const reasons: string[] = [];

  // ── Quiet hours (channel-agnostic; applies even without a WhatsApp instance) ──
  if (config.quietHours.mode !== "off" && !isQuietHoursExempt(input.sendClass)) {
    const qhDefer = quietHoursDeferUntil(config.quietHours, now, rng);
    if (qhDefer) {
      if (config.quietHours.mode === "enforce") {
        deferUntil = laterOf(deferUntil, qhDefer);
        reasons.push("quiet_hours");
      } else {
        await logGovernor(input, "would_defer", "shadow", {
          lever: "quiet_hours",
          defer_until: qhDefer.toISOString(),
        });
      }
    }
  }

  // ── Caps (per-number + org-wide) — require a WhatsApp instance/ledger ──
  if (input.instanceId) {
    if (config.instanceCap.mode !== "off") {
      const cap = resolveInstanceCap(input.instanceCapRaw);
      const read = input.readInstanceUsage
        ? await input.readInstanceUsage(input.instanceId, usageDate)
        : await readInstanceUsageImpl(input.supabase, input.instanceId, usageDate);

      let capDefer: Date | null = null;
      let reason = "instance_cap";
      if (!read.ok) {
        capDefer = new Date(now.getTime() + SHORT_DEFER_MS); // Guard #3: blip → short
        reason = "instance_cap_read_error";
      } else if (read.used >= cap) {
        capDefer = nextMidnightUtc(now, BLAST_BUDGET_TIMEZONE);
      }
      if (capDefer) {
        if (config.instanceCap.mode === "enforce") {
          deferUntil = laterOf(deferUntil, capDefer);
          reasons.push(reason);
        } else {
          await logGovernor(input, "would_defer", "shadow", {
            lever: reason,
            used: read.ok ? read.used : null,
            cap,
            defer_until: capDefer.toISOString(),
          });
        }
      }
    }

    if (config.orgCap.mode !== "off") {
      const read = input.readOrgUsage
        ? await input.readOrgUsage(input.organizationId, usageDate)
        : await readOrgUsageImpl(input.supabase, input.organizationId, usageDate);

      let orgDefer: Date | null = null;
      let reason = "org_cap";
      if (!read.ok) {
        orgDefer = new Date(now.getTime() + SHORT_DEFER_MS); // Guard #3: blip → short
        reason = "org_cap_read_error";
      } else {
        const { remaining } = computeDailyClamp({
          dailyBudget: config.orgDailyBudget,
          usedToday: read.used,
        });
        if (remaining <= 0) orgDefer = nextMidnightUtc(now, BLAST_BUDGET_TIMEZONE);
      }
      if (orgDefer) {
        if (config.orgCap.mode === "enforce") {
          deferUntil = laterOf(deferUntil, orgDefer);
          reasons.push(reason);
        } else {
          await logGovernor(input, "would_defer", "shadow", {
            lever: reason,
            used: read.ok ? read.used : null,
            budget: config.orgDailyBudget,
            defer_until: orgDefer.toISOString(),
          });
        }
      }
    }
  }

  if (deferUntil) {
    const clamped = clampDeferUntil(deferUntil, now);
    await logGovernor(input, "defer", "enforce", {
      reason: reasons.join(","),
      defer_until: clamped.toISOString(),
    });
    return { decision: "defer", deferUntil: clamped.toISOString(), reason: reasons.join(","), now };
  }

  // ── Jitter is the last gate before sending (spacing since last outgoing) ──
  if (input.instanceId) {
    const jitter = await applyJitter(input, now, rng);
    if (jitter.defer) {
      const clamped = clampDeferUntil(jitter.deferUntil, now);
      await logGovernor(input, "defer", "enforce", {
        reason: "jitter",
        defer_until: clamped.toISOString(),
      });
      return { decision: "defer", deferUntil: clamped.toISOString(), reason: "jitter", now };
    }
  }

  return { decision: "send", now };
}

// ─── Post-dispatch commit (increment shared blast ledgers, exactly 1×) ────────

export interface CommitInput {
  supabase: SupabaseClient;
  organizationId: string;
  instanceId?: string;
  config: GovernorConfig;
  now?: Date;
  instanceUsage?: InstanceUsageSource;
  orgUsage?: BlastUsageSource;
}

/**
 * Increment BOTH shared daily ledgers by 1 AFTER a message is actually delivered.
 * Called exactly once per delivered message — never on a dedup-duplicate path, and
 * only for levers in `enforce` (shadow must never mutate state). No-op when the
 * master flag is off or there is no WhatsApp instance (e.g. Meta). Best-effort:
 * the message already went out, so a ledger hiccup here must never fail the action.
 */
export async function commitOutboundSend(input: CommitInput): Promise<void> {
  const { config } = input;
  if (!config.enabled) return;
  if (!input.instanceId) return;
  const usageDate = saoPauloUsageDate(input.now ?? new Date());
  try {
    if (config.instanceCap.mode === "enforce") {
      const src = input.instanceUsage ?? instanceDailyUsageSource(input.supabase);
      await src.increment(input.instanceId, usageDate, 1);
    }
    if (config.orgCap.mode === "enforce") {
      const src = input.orgUsage ?? blastDailyUsageSource(input.supabase);
      await src.increment(input.organizationId, usageDate, 1);
    }
  } catch (err) {
    console.warn(
      "[send-governor] commit increment failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Handler convenience gate ─────────────────────────────────────────────────

/** Resolve the defer-count key the executor uses (params._nodeId). */
function resolveGovernorNodeId(params: Record<string, unknown>): string {
  return (
    (params._nodeId as string) ||
    (params._executionId as string) ||
    "governor"
  );
}

function readDeferCount(
  executionContext: Record<string, unknown> | undefined,
  nodeId: string,
): number {
  const counts = executionContext?._defer_counts as Record<string, number> | undefined;
  const v = counts?.[nodeId];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export type GateOutcome =
  | { defer: true; result: ActionResult }
  | { defer: false; commit: () => Promise<void> };

/**
 * The one call a WhatsApp send handler makes where it used to call
 * enforceWhatsAppRateLimit. Resolves the org config, runs the governor, and either:
 *  - returns { defer: true, result } — a success ActionResult carrying deferUntil,
 *    which the handler returns immediately (BEFORE dedup/send); the executor
 *    reschedules the node; OR
 *  - returns { defer: false, commit } — the handler sends, then awaits commit()
 *    once per delivered message (after dispatch success).
 */
export async function governGate(args: {
  supabase: SupabaseClient;
  organizationId: string;
  instance?: { daily_blast_cap?: number | null } | null;
  instanceId?: string;
  params: Record<string, unknown>;
  executionContext?: Record<string, unknown>;
  sendClass: SendClass;
}): Promise<GateOutcome> {
  const config = await resolveGovernorConfig(args.supabase, args.organizationId);
  const nodeId = resolveGovernorNodeId(args.params);
  const deferCount = readDeferCount(args.executionContext, nodeId);

  const decision = await governOutboundSend({
    supabase: args.supabase,
    organizationId: args.organizationId,
    instanceId: args.instanceId,
    instanceCapRaw: args.instance?.daily_blast_cap ?? null,
    nodeId,
    deferCount,
    sendClass: args.sendClass,
    config,
  });

  if (decision.decision === "defer") {
    return {
      defer: true,
      result: {
        success: true,
        deferUntil: decision.deferUntil,
        message: `governor_deferred${decision.reason ? `:${decision.reason}` : ""}`,
      },
    };
  }

  return {
    defer: false,
    commit: () =>
      commitOutboundSend({
        supabase: args.supabase,
        organizationId: args.organizationId,
        instanceId: args.instanceId,
        config,
        now: decision.now,
      }),
  };
}
