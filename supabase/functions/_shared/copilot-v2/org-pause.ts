/**
 * org-pause — Copilot v2 org-level kill-switch decision (W10, pure).
 *
 * Sits over the phone-keyed human-pause (human-pause.ts). When an admin (or the
 * hard cost cap) pauses the WHOLE org, every turn for that org is suppressed
 * until the pause expires, with a typed reason for the FE banner. Mirrors
 * decideHumanPauseGate exactly: fail-CLOSED (check error or unparseable
 * paused_until → block); a missing row is an unambiguous "not paused".
 *
 * The border/worker call both gates and `unionPause` them; the org reason wins
 * the banner since an org-wide pause outranks a single-conversation one.
 */

export type OrgPauseReason = 'takeover' | 'loop' | 'teto' | 'baixa_confianca';

/** The closed set of governance reasons (validated by the RPC at write time). */
export const ORG_PAUSE_REASONS: readonly OrgPauseReason[] = [
  'takeover',
  'loop',
  'teto',
  'baixa_confianca',
] as const;

export interface OrgPauseRecord {
  paused_until: string | null;
}

export interface OrgPauseGateInput {
  /** The org-pause row for this org, or null if none exists. */
  record: OrgPauseRecord | null;
  /** True if the lookup itself threw. */
  checkErrored: boolean;
  now: Date;
}

export interface OrgPauseGateDecision {
  blocked: boolean;
  reason: 'org_pause_check_failed' | 'org_pause_active' | null;
}

export function decideOrgPauseGate(input: OrgPauseGateInput): OrgPauseGateDecision {
  if (input.checkErrored) {
    return { blocked: true, reason: 'org_pause_check_failed' };
  }

  const until = input.record?.paused_until ?? null;
  if (until == null) {
    return { blocked: false, reason: null };
  }

  const untilMs = new Date(until).getTime();
  if (Number.isNaN(untilMs)) {
    return { blocked: true, reason: 'org_pause_check_failed' };
  }

  if (untilMs > input.now.getTime()) {
    return { blocked: true, reason: 'org_pause_active' };
  }
  return { blocked: false, reason: null };
}

export interface PauseBlock {
  blocked: boolean;
  reason: string | null;
}

/**
 * Unions the phone-keyed and org-level pause decisions. Blocked if either is.
 * The ORG reason takes precedence (an org-wide pause is the more important
 * thing to surface on the banner).
 */
export function unionPause(phone: PauseBlock, org: PauseBlock): PauseBlock {
  if (org.blocked) return { blocked: true, reason: org.reason };
  if (phone.blocked) return { blocked: true, reason: phone.reason };
  return { blocked: false, reason: null };
}
