/**
 * runQuickBlast — Quick Blast orchestration core (Module D).
 *
 * A Quick Blast IS a Mass Send (ADR-0002): same dispatch core, different entry
 * point and access policy. No role gate — any authenticated org member fires;
 * the org-level cap is the sole guardrail. RLS/org-scoped reads keep recipients
 * within the caller's organization.
 *
 * The dispatch fn is injected so this is testable without a provider/network.
 */
import { getOrgBlastCap } from "../_shared/quick-blast/org-cap.ts";
import { buildRecipients, type BlastLead } from "../_shared/quick-blast/recipients.ts";
import { buildBlastLogRows } from "../_shared/quick-blast/message-log.ts";
import {
  refineBlastAudience,
  channelMessagesActivitySource,
  type BlastActivitySource,
  type BlastRefinementOptions,
  type BlastRefinementSkips,
} from "../_shared/quick-blast/refinements.ts";
import {
  getDailyBlastBudget,
  blastDailyUsageSource,
  computeDailyClamp,
  saoPauloUsageDate,
  type BlastUsageSource,
} from "../_shared/quick-blast/daily-budget.ts";

export interface QuickBlastDeps {
  // `rpc` is needed by the default daily-budget usage source (atomic ledger
  // increment); optional so callers that inject a `usageSource` need not provide it.
  supabaseAdmin: { from: (t: string) => any; rpc?: (fn: string, args: Record<string, unknown>) => any };
  dispatch: (
    instance: any,
    input: {
      recipients: Array<{ number: string; text?: string; type?: string; file?: string; caption?: string }>;
      delayMin?: number;
      delayMax?: number;
      scheduledFor?: string;
      triggeredByUserId?: string | null;
      triggeredVia?: "ui" | "api" | "cron" | "workflow";
      trackSource?: string;
    },
  ) => Promise<{ sender_job_id: string; uazapi_sender_id: string }>;
  /** Activity source for the Blast Audience refinements (#704). Injected so the
   *  refinement is testable without a live DB; defaults to a channel_messages
   *  read over `supabaseAdmin` when omitted. */
  activitySource?: BlastActivitySource;
  /** Daily Blast Budget ledger source (#706, ADR-0003). Reads today's usage and
   *  atomically increments after a real dispatch. Injected so the budget logic
   *  is unit-testable without a live DB; defaults to a `blast_daily_usage` read
   *  over `supabaseAdmin` when omitted. */
  usageSource?: BlastUsageSource;
}

export interface QuickBlastParams {
  orgId: string;
  userId: string;
  instance: { id: string; organization_id: string; provider?: string };
  leadIds: string[];
  message: string;
  delayMinMs?: number;
  delayMaxMs?: number;
  maxLeads?: number;
  scheduledFor?: string;
  /** Optional single image (Supabase Storage URL). Resolved text becomes the
   *  caption. V1 supports image only (video deferred). */
  imageUrl?: string;
  /** Blast Audience refinements (#704) applied server-side BEFORE dispatch.
   *  Omitted / all-false → current behavior (no narrowing). The engine still
   *  applies its own org cap + phone normalization afterward (fail-closed). */
  refinements?: BlastRefinementOptions;
  /** Resolve audience + refinements and return the would-send count + skip
   *  breakdown WITHOUT dispatching — powers the wizard's live preview. */
  dryRun?: boolean;
  /** Injected clock for deterministic Sao Paulo usage-date resolution. Defaults
   *  to now. Only the calendar date (the ledger partition key) is derived. */
  now?: Date;
}

export interface QuickBlastResult {
  ok: boolean;
  sender_job_id?: string;
  uazapi_sender_id?: string;
  count: number;
  /** Per-reason skip breakdown. `noPhone`/`duplicates`/`overCap` come from the
   *  dispatch engine (buildRecipients + per-blast cap). `alreadyContactedWithinWindow`
   *  + `replied` come from the Blast Audience refinements (#704); they are 0
   *  when no refinement narrowed the set. `overDailyBudget` (#706, ADR-0003) is
   *  the count clipped by the Org-wide daily ceiling shared across all blasts. */
  skipped: {
    noPhone: number;
    duplicates: number;
    overCap: number;
    alreadyContactedWithinWindow: number;
    replied: number;
    overDailyBudget: number;
  };
  /** Daily Blast Budget headroom available to THIS blast before it consumed —
   *  `max(0, daily_blast_budget - usage_today)`. The wizard reads it as "today's
   *  remaining budget" to render "X de Y — N acima do teto diário". */
  remaining?: number;
  error?: string;
}

const EMPTY_SKIPPED = {
  noPhone: 0,
  duplicates: 0,
  overCap: 0,
  alreadyContactedWithinWindow: 0,
  replied: 0,
  overDailyBudget: 0,
};

export async function runQuickBlast(
  deps: QuickBlastDeps,
  params: QuickBlastParams,
): Promise<QuickBlastResult> {
  const { supabaseAdmin, dispatch } = deps;

  // Tenant guard: the chosen instance must belong to the caller's org.
  if (params.instance.organization_id !== params.orgId) {
    return { ok: false, count: 0, skipped: { ...EMPTY_SKIPPED }, error: "instance_org_mismatch" };
  }

  if (!params.dryRun && (!params.message || params.message.trim().length === 0)) {
    return { ok: false, count: 0, skipped: { ...EMPTY_SKIPPED }, error: "empty_message" };
  }
  if (!Array.isArray(params.leadIds) || params.leadIds.length === 0) {
    return { ok: false, count: 0, skipped: { ...EMPTY_SKIPPED }, error: "no_leads" };
  }

  // Per-blast clamp (ADR-0002): org cap is the ceiling, per-blast max clamps
  // within it. This is now the INNER clamp — the daily budget (ADR-0003) is the
  // outer, Org-wide ceiling shared across every blast that day.
  const orgCap = await getOrgBlastCap(supabaseAdmin, params.orgId);
  const perBlastCap = params.maxLeads && params.maxLeads > 0
    ? Math.min(params.maxLeads, orgCap)
    : orgCap;

  // Daily Blast Budget (ADR-0003, #706) — fail-closed Org-wide daily ceiling.
  // `remaining` is today's headroom shared by manual blasts + Plan lots; the
  // effective cap is the tightest of (per-blast cap, daily budget, remaining).
  // A ledger read error resolves to remaining 0 (block), never unlimited.
  const usageSource = deps.usageSource ?? blastDailyUsageSource(supabaseAdmin as any);
  const usageDate = saoPauloUsageDate(params.now ?? new Date());
  const dailyBudget = await getDailyBlastBudget(supabaseAdmin, params.orgId);
  const usedToday = await usageSource.getUsedToday(params.orgId, usageDate, dailyBudget);
  const { remaining, effectiveCap } = computeDailyClamp({
    dailyBudget,
    usedToday,
    perBlastMax: perBlastCap,
  });

  // Org-scoped fetch — foreign-org lead ids are excluded by the org filter.
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, name, company, phone")
    .eq("organization_id", params.orgId)
    .in("id", params.leadIds);

  const baseLeads = (leads ?? []) as BlastLead[];

  // Blast Audience refinements (#704) — narrow the candidate set BEFORE building
  // recipients: drop leads contacted within the recency window and/or leads that
  // already replied to their last blast. Runs against the org-scoped leads only,
  // so foreign-org ids can never leak in. Default (no refinements) is a no-op.
  const refineSkips = await applyRefinements(deps, params, baseLeads);
  const refinedLeads = refineSkips.kept;

  // Left-join carteira data so {segmento}/{ticket_medio}/{dias_sem_pedido}/{ltv}
  // resolve when the lead is also a portfolio client. Absent → empty (Slice 2).
  const merged = await mergePortfolioData(supabaseAdmin, params.orgId, refinedLeads);

  const { recipients, skipped: engineSkips } = buildRecipients(merged, {
    template: params.message ?? "",
    cap: effectiveCap,
    imageUrl: params.imageUrl,
  });

  // Attribute the engine's over-cap drops (valid-phone candidates beyond the
  // effective cap) to the binding constraint. When the daily budget `remaining`
  // is the tightest limit, the overflow is reported as `overDailyBudget` so the
  // wizard can show "N acima do teto diário"; otherwise it stays per-blast
  // `overCap`. Same total — only the label changes.
  const dailyIsBinding = remaining <= perBlastCap && remaining === effectiveCap;
  const overDailyBudget = dailyIsBinding ? engineSkips.overCap : 0;
  const overCap = dailyIsBinding ? 0 : engineSkips.overCap;

  // Single reconciled breakdown: refinement skips (pre-dispatch narrowing) +
  // engine skips (phone/dedup/cap) + daily-budget overflow. Counts never double —
  // a lead removed by a refinement is no longer present for buildRecipients to
  // skip, and each over-cap lead is labelled exactly once.
  const skipped = {
    noPhone: engineSkips.noPhone,
    duplicates: engineSkips.duplicates,
    overCap,
    alreadyContactedWithinWindow: refineSkips.skipped.alreadyContactedWithinWindow,
    replied: refineSkips.skipped.replied,
    overDailyBudget,
  };

  // Preview (dry run): resolved audience + refinements + daily clamp, no
  // dispatch, no logging, and crucially NO ledger increment — a preview must
  // never consume budget.
  if (params.dryRun) {
    return { ok: true, count: recipients.length, skipped, remaining };
  }

  // Daily budget exhausted — nothing may go out today. Reject explicitly so the
  // wizard distinguishes "blocked by the daily ceiling" from "no recipients".
  // With remaining 0 the effective cap is 0, so every valid-phone candidate fell
  // into the engine's over-cap bucket, which `dailyIsBinding` already relabelled
  // as `overDailyBudget` — no recomputation needed.
  if (remaining <= 0) {
    return { ok: false, count: 0, skipped, remaining, error: "daily_budget_exhausted" };
  }

  if (recipients.length === 0) {
    return { ok: false, count: 0, skipped, remaining, error: "no_recipients" };
  }

  const { sender_job_id, uazapi_sender_id } = await dispatch(params.instance, {
    recipients: recipients.map((r) => ({
      number: r.number,
      text: r.text,
      type: r.type,
      file: r.file,
      caption: r.caption,
    })),
    delayMin: params.delayMinMs,
    delayMax: params.delayMaxMs,
    scheduledFor: params.scheduledFor,
    triggeredByUserId: params.userId,
    triggeredVia: "ui",
    trackSource: "quick-blast",
  });

  // Consume the Daily Blast Budget by the ACTUALLY-dispatched count (ADR-0003).
  // Atomic UPSERT-increment so concurrent same-day blasts never lose a count.
  // Only reached after a real (non-dry-run) dispatch — a preview short-circuits
  // above. Best-effort: a ledger write failure must not fail a blast that has
  // already left for the provider; it is logged, not thrown.
  try {
    await usageSource.increment(params.orgId, usageDate, recipients.length);
  } catch {
    // ledger increment is best-effort; the blast already dispatched
  }

  // Per-lead conversation logging — optimistic at enqueue, non-fatal. Lets the
  // rep see what was sent and gives the Copilot context if the lead replies.
  try {
    const logRows = buildBlastLogRows({
      orgId: params.orgId,
      userId: params.userId,
      senderJobId: sender_job_id,
      recipients,
    });
    if (logRows.length > 0) {
      await supabaseAdmin.from("channel_messages").insert(logRows);
    }
  } catch {
    // logging is best-effort; the blast already dispatched
  }

  return { ok: true, sender_job_id, uazapi_sender_id, count: recipients.length, skipped, remaining };
}

/**
 * Apply the Blast Audience refinements to the org-scoped candidate leads and
 * return the kept leads + the refinement skip counts.
 *
 * Only the activity-based refinements (contact recency, non-responder) run here:
 * `excludeNoPhone` is deliberately left to the dispatch engine (buildRecipients
 * already counts `noPhone`), so phone-less leads are counted exactly once. When
 * no activity-based refinement is requested this is a pure pass-through and no
 * channel_messages read is issued.
 */
async function applyRefinements(
  deps: QuickBlastDeps,
  params: QuickBlastParams,
  leads: BlastLead[],
): Promise<{ kept: BlastLead[]; skipped: BlastRefinementSkips }> {
  const r = params.refinements;
  const recencyOn = typeof r?.excludeBlastedWithinDays === "number" && r.excludeBlastedWithinDays > 0;
  const nonResponderOn = r?.onlyNonResponders === true;

  if (!recencyOn && !nonResponderOn) {
    return { kept: leads, skipped: { alreadyContactedWithinWindow: 0, replied: 0, noPhone: 0 } };
  }

  const source = deps.activitySource ?? channelMessagesActivitySource(deps.supabaseAdmin);
  const { keptLeadIds, skipped } = await refineBlastAudience({
    orgId: params.orgId,
    candidates: leads.map((l) => ({ leadId: l.id, phone: l.phone })),
    options: {
      excludeBlastedWithinDays: r?.excludeBlastedWithinDays,
      onlyNonResponders: nonResponderOn,
      // noPhone stays with the dispatch engine to avoid double-counting.
    },
    source,
  });

  const keep = new Set(keptLeadIds);
  return { kept: leads.filter((l) => keep.has(l.id)), skipped };
}

/**
 * Merge carteira (upsell_clients) fields into leads by lead_id. Leads without a
 * portfolio row are returned unchanged. Failures are non-fatal — the blast
 * proceeds with lead-only variables.
 */
async function mergePortfolioData(
  supabaseAdmin: { from: (t: string) => any },
  orgId: string,
  leads: BlastLead[],
): Promise<BlastLead[]> {
  if (leads.length === 0) return leads;
  try {
    const leadIds = leads.map((l) => l.id);
    const { data: clients } = await supabaseAdmin
      .from("upsell_clients")
      .select("lead_id, segment, avg_ticket, days_since_last_order, lifetime_value")
      .eq("organization_id", orgId)
      .in("lead_id", leadIds);
    const byLead = new Map<string, any>();
    for (const c of (clients ?? []) as any[]) {
      if (c?.lead_id) byLead.set(c.lead_id, c);
    }
    if (byLead.size === 0) return leads;
    return leads.map((l) => {
      const c = byLead.get(l.id);
      return c
        ? {
            ...l,
            segment: c.segment,
            avg_ticket: c.avg_ticket,
            days_since_last_order: c.days_since_last_order,
            lifetime_value: c.lifetime_value,
          }
        : l;
    });
  } catch {
    return leads;
  }
}
