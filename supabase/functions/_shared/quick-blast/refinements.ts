/**
 * refineBlastAudience — Blast Audience refinements (Disparo F1, #704).
 *
 * Narrows a candidate set of Lead ids BEFORE a Quick Blast fires, returning a
 * skip breakdown so the wizard can show a live count. Three independent
 * refinements (CONTEXT.md — "Blast Audience"):
 *
 *   - contact recency  → exclude Leads who already received a blast within a
 *     configurable window (default 7 days);
 *   - reply status     → "não respondeu": keep only Leads with zero inbound
 *     Messages after their most recent blast send;
 *   - no phone         → drop Leads without a phone (the engine drops these
 *     anyway via buildRecipients; opting in here surfaces them in the live
 *     count instead of as a post-dispatch surprise).
 *
 * The core is pure: candidates + options + an injected activity source → kept
 * ids + skip breakdown. The activity source is the ONLY IO seam, so the core is
 * unit-testable without a live DB (mirrors quick-blast-run.test.ts). Deterministic
 * — input order of kept leads is preserved, and each skipped lead is counted
 * exactly once by a fixed precedence (noPhone → recency → replied).
 *
 * Source of truth (verified against prod 2026-06-05): channel_messages, keyed by
 * lead_id, scoped by organization_id, with direction in {'outgoing','incoming'}
 * (NOT 'inbound'/'outbound') and a `timestamp` column. "Received a blast" is the
 * lead's most recent OUTGOING row; "replied since" is an INCOMING row whose
 * timestamp is strictly after that. A blast send is an outgoing message, so the
 * full outgoing history is the fail-closed superset for recency — re-messaging
 * someone contacted N days ago is exactly what the refinement prevents.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-lead conversation activity, resolved by the injected source. */
export interface LeadActivity {
  /** Timestamp of the lead's most recent OUTGOING message, or null if never. */
  lastOutgoingAt: Date | null;
  /** Timestamp of the lead's most recent INCOMING message, or null if never. */
  lastIncomingAt: Date | null;
}

/** IO seam — resolves activity for a batch of leads. Injected so the core is
 *  testable without a live DB. Implementations MUST scope by org. */
export interface BlastActivitySource {
  getLeadActivity(orgId: string, leadIds: string[]): Promise<Map<string, LeadActivity>>;
}

export interface BlastAudienceCandidate {
  leadId: string;
  phone?: string | null;
}

export interface BlastRefinementOptions {
  /** Exclude leads whose most recent blast send was within this many days.
   *  Undefined / <= 0 → recency refinement off. Default applied by the caller
   *  (the wizard) is 7; this module does not assume a default when unset. */
  excludeBlastedWithinDays?: number;
  /** Keep only "não respondeu" leads — zero inbound after their last blast. */
  onlyNonResponders?: boolean;
  /** Drop phone-less leads here (surfaced in the live count) instead of letting
   *  the dispatch engine drop them silently. */
  excludeNoPhone?: boolean;
}

export interface BlastRefinementSkips {
  alreadyContactedWithinWindow: number;
  replied: number;
  noPhone: number;
}

export interface BlastRefinementResult {
  keptLeadIds: string[];
  skipped: BlastRefinementSkips;
}

export interface RefineBlastAudienceArgs {
  orgId: string;
  candidates: BlastAudienceCandidate[];
  options: BlastRefinementOptions;
  source: BlastActivitySource;
  /** Injected clock for deterministic recency windows. Defaults to now. */
  now?: Date;
}

function hasPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && phone.trim().length > 0;
}

/**
 * Apply the Blast Audience refinements to a candidate set.
 *
 * Precedence (each lead counted once): noPhone → recency → replied → kept.
 * The activity source is queried only when an activity-based refinement
 * (recency or non-responder) is actually requested.
 */
export async function refineBlastAudience(
  args: RefineBlastAudienceArgs,
): Promise<BlastRefinementResult> {
  const { orgId, candidates, options, source } = args;
  const now = args.now ?? new Date();

  const skipped: BlastRefinementSkips = {
    alreadyContactedWithinWindow: 0,
    replied: 0,
    noPhone: 0,
  };

  if (candidates.length === 0) {
    return { keptLeadIds: [], skipped };
  }

  const recencyDays =
    typeof options.excludeBlastedWithinDays === "number" && options.excludeBlastedWithinDays > 0
      ? options.excludeBlastedWithinDays
      : null;
  const recencyEnabled = recencyDays !== null;
  const nonResponderEnabled = options.onlyNonResponders === true;
  const noPhoneEnabled = options.excludeNoPhone === true;

  // Activity is only needed for recency / non-responder. Skip the IO otherwise.
  let activity: Map<string, LeadActivity> = new Map();
  if (recencyEnabled || nonResponderEnabled) {
    const needIds: string[] = [];
    for (const c of candidates) {
      // Phone-less leads excluded up front never need an activity lookup.
      if (noPhoneEnabled && !hasPhone(c.phone)) continue;
      needIds.push(c.leadId);
    }
    if (needIds.length > 0) {
      activity = await source.getLeadActivity(orgId, needIds);
    }
  }

  const windowStart = recencyEnabled ? new Date(now.getTime() - recencyDays! * DAY_MS) : null;
  const keptLeadIds: string[] = [];

  for (const c of candidates) {
    if (noPhoneEnabled && !hasPhone(c.phone)) {
      skipped.noPhone += 1;
      continue;
    }

    const act = activity.get(c.leadId);
    const lastOutgoingAt = act?.lastOutgoingAt ?? null;
    const lastIncomingAt = act?.lastIncomingAt ?? null;

    // Contact recency — last blast send inside the window (inclusive of the
    // boundary instant) excludes the lead. Never-contacted → kept.
    if (recencyEnabled && lastOutgoingAt !== null && lastOutgoingAt.getTime() >= windowStart!.getTime()) {
      skipped.alreadyContactedWithinWindow += 1;
      continue;
    }

    // Reply status — a "non-responder" is a lead that WAS blasted and has zero
    // inbound after that send. A never-blasted lead has no send to be silent
    // against, so it is not a non-responder — keep it (fresh contact).
    if (nonResponderEnabled && lastOutgoingAt !== null) {
      const repliedSinceLastSend =
        lastIncomingAt !== null && lastIncomingAt.getTime() > lastOutgoingAt.getTime();
      if (repliedSinceLastSend) {
        skipped.replied += 1;
        continue;
      }
    }

    keptLeadIds.push(c.leadId);
  }

  return { keptLeadIds, skipped };
}

/**
 * Production activity source over channel_messages. Org-scoped; reduces each
 * lead's outgoing/incoming history to its most recent timestamp on each side.
 * One batched read per blast (filtered to the candidate lead ids). Failures are
 * non-fatal — an empty activity map means "no history", so a query error fails
 * OPEN for the refinement (every lead looks never-contacted). The engine's own
 * org cap + phone normalization remain the hard guardrails afterward.
 */
export function channelMessagesActivitySource(
  supabaseAdmin: { from: (t: string) => any },
): BlastActivitySource {
  return {
    async getLeadActivity(orgId: string, leadIds: string[]): Promise<Map<string, LeadActivity>> {
      const result = new Map<string, LeadActivity>();
      for (const id of leadIds) result.set(id, { lastOutgoingAt: null, lastIncomingAt: null });
      if (leadIds.length === 0) return result;

      try {
        const { data } = await supabaseAdmin
          .from("channel_messages")
          .select("lead_id, direction, timestamp")
          .eq("organization_id", orgId)
          .in("lead_id", leadIds)
          .in("direction", ["outgoing", "incoming"]);

        for (const row of (data ?? []) as Array<{
          lead_id: string | null;
          direction: string | null;
          timestamp: string | null;
        }>) {
          if (!row.lead_id || !row.timestamp) continue;
          const entry = result.get(row.lead_id);
          if (!entry) continue;
          const ts = new Date(row.timestamp);
          if (Number.isNaN(ts.getTime())) continue;
          if (row.direction === "outgoing") {
            if (entry.lastOutgoingAt === null || ts.getTime() > entry.lastOutgoingAt.getTime()) {
              entry.lastOutgoingAt = ts;
            }
          } else if (row.direction === "incoming") {
            if (entry.lastIncomingAt === null || ts.getTime() > entry.lastIncomingAt.getTime()) {
              entry.lastIncomingAt = ts;
            }
          }
        }
      } catch {
        // Fail open for the refinement — every lead reads as never-contacted.
        // Org cap + phone normalization downstream remain the hard guardrails.
      }

      return result;
    },
  };
}
