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

export interface QuickBlastDeps {
  supabaseAdmin: { from: (t: string) => any };
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
}

export interface QuickBlastResult {
  ok: boolean;
  sender_job_id?: string;
  uazapi_sender_id?: string;
  count: number;
  /** Per-reason skip breakdown. `noPhone`/`duplicates`/`overCap` come from the
   *  dispatch engine (buildRecipients + org cap). `alreadyContactedWithinWindow`
   *  + `replied` come from the Blast Audience refinements (#704); they are 0
   *  when no refinement narrowed the set. */
  skipped: {
    noPhone: number;
    duplicates: number;
    overCap: number;
    alreadyContactedWithinWindow: number;
    replied: number;
  };
  error?: string;
}

const EMPTY_SKIPPED = {
  noPhone: 0,
  duplicates: 0,
  overCap: 0,
  alreadyContactedWithinWindow: 0,
  replied: 0,
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

  // Org cap is the guardrail; per-blast max is clamped within it.
  const orgCap = await getOrgBlastCap(supabaseAdmin, params.orgId);
  const effectiveCap = params.maxLeads && params.maxLeads > 0
    ? Math.min(params.maxLeads, orgCap)
    : orgCap;

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

  // Single reconciled breakdown: refinement skips (pre-dispatch narrowing) +
  // engine skips (phone/dedup/cap). Counts never double — a lead removed by a
  // refinement is no longer present for buildRecipients to skip.
  const skipped = {
    noPhone: engineSkips.noPhone,
    duplicates: engineSkips.duplicates,
    overCap: engineSkips.overCap,
    alreadyContactedWithinWindow: refineSkips.skipped.alreadyContactedWithinWindow,
    replied: refineSkips.skipped.replied,
  };

  // Preview (dry run): resolved audience + refinements, no dispatch, no logging.
  if (params.dryRun) {
    return { ok: true, count: recipients.length, skipped };
  }

  if (recipients.length === 0) {
    return { ok: false, count: 0, skipped, error: "no_recipients" };
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

  return { ok: true, sender_job_id, uazapi_sender_id, count: recipients.length, skipped };
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
