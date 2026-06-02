/**
 * proactive-scheduler — Copilot v2 outbound proactivity (Slice 11, ADR #11).
 *
 * PURE decision layer for the proactive scheduler. The cron edge shell selects
 * candidates and performs the I/O (DB reads, enqueue RPC); THIS module decides
 * the fail-CLOSED gates (business-hours, rate-limit) and computes the STABLE
 * idempotency key that kills the v1 double-send (#7/#8/#9). No Date.now(), no
 * DB — every clock/effect is injected, so the whole policy is unit-testable.
 */

/** Per-org commercial window. tz is an IANA zone (Intl is available in Deno). */
export interface BusinessHoursWindow {
  /** ISO weekdays allowed, 1=Mon … 7=Sun. */
  days: number[];
  /** "HH:MM" 24h, in `tz`. */
  start: string;
  /** "HH:MM" 24h, in `tz`. */
  end: string;
  /** IANA tz, e.g. "America/Sao_Paulo". */
  tz: string;
}

export type GateDecision = { allowed: boolean; reason: string | null };

function parseHHMM(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Local wall-clock (weekday 1-7, minutes-of-day) of `now` in `tz`, fail-safe. */
function localParts(now: Date, tz: string): { isoDow: number; minutes: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hh = parts.find((p) => p.type === "hour")?.value ?? "";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "";
    const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const isoDow = dowMap[wd];
    const minutes = Number(hh) * 60 + Number(mm);
    if (!isoDow || Number.isNaN(minutes)) return null;
    return { isoDow, minutes };
  } catch {
    return null;
  }
}

/**
 * Business-hours gate, fail-CLOSED: a missing/malformed window or any error
 * blocks the proactive send (never initiate outside the org's commercial window).
 */
export function decideBusinessHoursGate(
  input: { window: BusinessHoursWindow | null | undefined; now: Date },
): GateDecision {
  const w = input.window;
  if (!w || !Array.isArray(w.days) || w.days.length === 0 || typeof w.tz !== "string") {
    return { allowed: false, reason: "no_business_hours_window" };
  }
  const startMin = parseHHMM(w.start);
  const endMin = parseHHMM(w.end);
  if (startMin == null || endMin == null || startMin >= endMin) {
    return { allowed: false, reason: "outside_business_hours" };
  }
  const local = localParts(input.now, w.tz);
  if (!local) return { allowed: false, reason: "outside_business_hours" };
  const dayOk = w.days.includes(local.isoDow);
  const timeOk = local.minutes >= startMin && local.minutes < endMin;
  return dayOk && timeOk
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "outside_business_hours" };
}

export type ProactiveKind = "first_touch" | "followup" | "carteira_rescue";

export interface ProactiveKeyArgs {
  orgId: string;
  leadId: string;
  kind: ProactiveKind;
  /** Discretiza o motivo: "1" (first-touch), "d3"/"d7" (cadência), rodada de resgate. NUNCA timestamp do tick. */
  slot: string;
}

/**
 * Chave de idempotência ESTÁVEL do proativo. Determinística por
 * (org, lead, kind, slot) — sem timestamp — pra que o cron 1/min possa
 * re-selecionar o mesmo candidato e a fila colapse pra UMA row via
 * ON CONFLICT (org, idempotency_key). Prefixo "proactive:" garante que
 * nunca colide com a dedup key de inbound (dedup-lock.ts). Mata #7/#8/#9.
 */
export function buildProactiveIdempotencyKey(args: ProactiveKeyArgs): string {
  return `proactive:${args.orgId}:${args.kind}:${args.leadId}:${args.slot}`;
}

/** Daily per-org rate-limit, fail-CLOSED (ceiling ≤ 0 or NaN → blocks). */
export function decideRateLimitGate(input: { sentToday: number; ceiling: number }): GateDecision {
  if (!Number.isFinite(input.ceiling) || input.ceiling <= 0) {
    return { allowed: false, reason: "no_rate_ceiling" };
  }
  return input.sentToday >= input.ceiling
    ? { allowed: false, reason: "rate_limit_reached" }
    : { allowed: true, reason: null };
}

/**
 * Composed proactive gate: business-hours → rate-limit. Returns the FIRST
 * blocking reason; fail-CLOSED throughout. The caller still relies on the
 * claim RPC (Task 4) for the atomic anti-double-send — this is the cheap
 * pre-filter that avoids even attempting an enqueue out of hours / over budget.
 */
export function decideProactiveSend(
  input: { window: BusinessHoursWindow | null | undefined; now: Date; sentToday: number; ceiling: number },
): GateDecision {
  const hours = decideBusinessHoursGate({ window: input.window, now: input.now });
  if (!hours.allowed) return hours;
  return decideRateLimitGate({ sentToday: input.sentToday, ceiling: input.ceiling });
}

/** Fail-CLOSED interpretation of copilot_v2_claim_proactive_slot's return. */
export function interpretClaim(
  result: { claimed: boolean; reason: string | null } | null | undefined,
): { enqueue: boolean; reason: string | null } {
  if (!result || result.claimed !== true) {
    return { enqueue: false, reason: result?.reason ?? "claim_unavailable" };
  }
  return { enqueue: true, reason: null };
}
