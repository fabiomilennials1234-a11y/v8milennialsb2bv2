/**
 * blast-plan — Blast Plan orchestration (ADR-0003, #707).
 *
 * A Blast Plan is a Mass Send whose audience exceeds one day's remaining Daily
 * Blast Budget. The audience is FROZEN at creation (snapshot — Leads entering the
 * source Stage afterward are NOT added) and drained over consecutive days, each
 * day's lot bounded by the shared #706 ledger.
 *
 *   createBlastPlan      — freeze the snapshot into blast_plan_recipients, slice
 *     into budget-sized daily lots, dispatch lot 1 TODAY consuming the remaining
 *     budget, persist the plan with next_release_date = tomorrow.
 *   releaseBlastPlanLot  — the daily releaser: take the next lot's frozen
 *     recipients, RE-APPLY the #704 refinements over the frozen membership (drop
 *     replied / recently-contacted), request remaining budget, dispatch at most
 *     that many, mark sent/skipped, defer the remainder, increment the shared
 *     ledger, advance next_release_date, and mark the plan completed when the
 *     membership is exhausted.
 *
 * Frozen-not-requery is deliberate (ADR-0003 §4): it keeps a Plan a finite,
 * self-terminating broadcast rather than a standing Stage rule (that is a
 * Workflow). The releaser NEVER re-queries the source Stage — it only ever reads
 * the plan's own frozen recipient rows.
 *
 * All IO is injected (the BlastPlanStore, the #706 usage ledger, the #704
 * activity source, the dispatch fn) so the orchestration is unit-testable
 * without a live DB — mirroring runQuickBlast.
 */
import { buildRecipients, type BlastLead, type BlastRecipient } from "./recipients.ts";
import { resolveBlastMessage } from "./message-resolver.ts";
import {
  refineBlastAudience,
  type BlastActivitySource,
  type BlastRefinementOptions,
} from "./refinements.ts";
import { saoPauloUsageDate, computeDailyClamp, type BlastUsageSource } from "./daily-budget.ts";
import { planLotCount, selectLotSlice, addDaysIso } from "./plan-slicing.ts";

// ── Frozen per-recipient snapshot ────────────────────────────────────────────

/** A row in blast_plan_recipients (the frozen membership). */
export interface PlanRecipientRow {
  plan_id: string;
  lead_id: string;
  phone: string | null;
  /** Frozen per-lead template variables, resolved at creation. */
  variable_snapshot: Record<string, unknown>;
  /** Which day's lot this recipient belongs to (0-based). */
  lot_index: number;
  /** pending | sent | skipped. */
  status: string;
  reason: string | null;
}

/** The persisted plan record, as the store sees it. */
export interface PlanRow {
  id?: string;
  organization_id: string;
  instance_id: string;
  created_by?: string;
  status: string;
  source?: Record<string, unknown> | null;
  message: string;
  refinements: Record<string, unknown> | null;
  image_url: string | null;
  delay_min_ms: number | null;
  delay_max_ms: number | null;
  total_recipients: number;
  lots_total: number;
  lots_released: number;
  release_time?: string;
  next_release_date: string | null;
  /** The instance row, needed by the releaser to dispatch. Persisted as a column
   *  in production via the FK + a read; carried inline here for the store seam. */
  instance?: { id: string; organization_id: string; provider?: string };
}

// ── IO seam: the Blast Plan store ────────────────────────────────────────────

export interface BlastPlanStore {
  insertPlan(row: Omit<PlanRow, "id">): Promise<string>;
  insertRecipients(rows: PlanRecipientRow[]): Promise<void>;
  getPlan(planId: string): Promise<PlanRow | null>;
  updatePlan(planId: string, patch: Partial<PlanRow>): Promise<void>;
  getLotRecipients(planId: string, lotIndex: number): Promise<PlanRecipientRow[]>;
  markRecipients(planId: string, leadIds: string[], status: string, reason: string | null): Promise<void>;
  /** Move deferred (still-pending) recipients to a later lot index. */
  moveRecipientsToLot(planId: string, leadIds: string[], lotIndex: number): Promise<void>;
  /** Active plans whose next_release_date <= today (the cron pull). */
  listActivePlansDue(today: string): Promise<PlanRow[]>;
}

// ── Shared deps + dispatch ───────────────────────────────────────────────────

export type DispatchFn = (
  instance: { id: string; organization_id: string; provider?: string },
  input: {
    recipients: Array<{ number: string; text?: string; type?: string; file?: string; caption?: string }>;
    delayMin?: number;
    delayMax?: number;
    triggeredByUserId?: string | null;
    triggeredVia?: "ui" | "api" | "cron" | "workflow";
    trackSource?: string;
  },
) => Promise<{ sender_job_id: string; uazapi_sender_id: string }>;

export interface BlastPlanDeps {
  store: BlastPlanStore;
  usageSource: BlastUsageSource;
  dispatch: DispatchFn;
  /** #704 activity source — only consulted when an activity-based refinement is
   *  requested. Injected so the releaser is testable without a live DB. */
  activitySource?: BlastActivitySource;
  /** Resolves the full whatsapp_instances row by id for the releaser, which only
   *  has the persisted instance_id (the in-memory `instance` is not a column).
   *  Tests inject `plan.instance` inline so they need not provide this. */
  instanceResolver?: (instanceId: string) => Promise<{ id: string; organization_id: string; provider?: string } | null>;
}

// ── createBlastPlan ──────────────────────────────────────────────────────────

export interface CreateBlastPlanParams {
  orgId: string;
  userId: string;
  instance: { id: string; organization_id: string; provider?: string };
  /** The RESOLVED audience (org-scoped by the caller). Frozen here. */
  leads: BlastLead[];
  message: string;
  refinements: BlastRefinementOptions;
  imageUrl?: string;
  delayMinMs?: number;
  delayMaxMs?: number;
  /** Resolved Daily Blast Budget (#706). The caller reads it fail-closed. */
  dailyBudget: number;
  releaseTime?: string;
  /** Descriptor of how the audience was resolved (for the record only). */
  source?: Record<string, unknown> | null;
  /** Injected clock for deterministic Sao Paulo date resolution. */
  now?: Date;
}

export interface CreateBlastPlanResult {
  ok: boolean;
  planId?: string;
  totalRecipients: number;
  lotsTotal: number;
  breakdown: Array<{ lotIndex: number; date: string; count: number }>;
  error?: string;
}

/**
 * Freeze the audience, slice into daily lots, dispatch lot 1 today (bounded by
 * the remaining shared budget), persist the plan.
 */
export async function createBlastPlan(
  deps: BlastPlanDeps,
  params: CreateBlastPlanParams,
): Promise<CreateBlastPlanResult> {
  const empty = { ok: false, totalRecipients: 0, lotsTotal: 0, breakdown: [] as any[] };

  if (params.instance.organization_id !== params.orgId) {
    return { ...empty, error: "instance_org_mismatch" };
  }
  if (!Array.isArray(params.leads) || params.leads.length === 0) {
    return { ...empty, error: "no_audience" };
  }
  if (!params.message || params.message.trim().length === 0) {
    return { ...empty, error: "empty_message" };
  }

  const now = params.now ?? new Date();
  const todayDate = saoPauloUsageDate(now);
  const dailyBudget = params.dailyBudget;

  // Slice the FROZEN audience into daily lots of dailyBudget each. Membership is
  // captured here and never re-queried — new Stage entrants are excluded.
  const total = params.leads.length;
  const lotsTotal = planLotCount(total, dailyBudget);

  // Build the frozen recipient rows up front (variable snapshot per lead). Lot 0
  // is today's; subsequent lots are future days.
  const planRow: Omit<PlanRow, "id"> = {
    organization_id: params.orgId,
    instance_id: params.instance.id,
    created_by: params.userId,
    status: "active",
    source: params.source ?? null,
    message: params.message,
    refinements: (params.refinements as Record<string, unknown>) ?? null,
    image_url: params.imageUrl ?? null,
    delay_min_ms: params.delayMinMs ?? null,
    delay_max_ms: params.delayMaxMs ?? null,
    total_recipients: total,
    lots_total: lotsTotal,
    lots_released: 0,
    release_time: params.releaseTime ?? "09:00",
    next_release_date: todayDate,
    instance: params.instance,
  };
  const planId = await deps.store.insertPlan(planRow);

  const recipientRows: PlanRecipientRow[] = [];
  const breakdown: Array<{ lotIndex: number; date: string; count: number }> = [];
  const cap = dailyBudget > 0 ? dailyBudget : 1; // fail-closed slot size
  for (let i = 0; i < params.leads.length; i++) {
    const lotIndex = Math.floor(i / cap);
    const lead = params.leads[i];
    recipientRows.push({
      plan_id: planId,
      lead_id: lead.id,
      phone: lead.phone ?? null,
      variable_snapshot: snapshotVars(lead),
      lot_index: lotIndex,
      status: "pending",
      reason: null,
    });
  }
  for (let lot = 0; lot < lotsTotal; lot++) {
    breakdown.push({
      lotIndex: lot,
      date: addDaysIso(todayDate, lot),
      count: recipientRows.filter((r) => r.lot_index === lot).length,
    });
  }
  await deps.store.insertRecipients(recipientRows);

  // Dispatch lot 1 (index 0) TODAY, bounded by the remaining shared budget. The
  // releaser logic is reused so creation and daily release share one path — lot 1
  // is just "release lot 0 right now". Refinements are NOT applied to lot 1 at
  // creation: the wizard already resolved the live audience moments ago; the
  // refinements re-run on the FUTURE lots when their day comes.
  const usedToday = await deps.usageSource.getUsedToday(params.orgId, todayDate, dailyBudget);
  const { remaining } = computeDailyClamp({ dailyBudget, usedToday });

  const lot0 = recipientRows.filter((r) => r.lot_index === 0);
  const slice = selectLotSlice({ pendingCount: lot0.length, remainingBudget: remaining });

  let lotsReleased = 0;
  if (slice.toSend > 0) {
    const toSendRows = lot0.slice(0, slice.toSend);
    const recipients = buildPlanRecipients(toSendRows, params.message, params.imageUrl);
    await deps.dispatch(params.instance, {
      recipients,
      delayMin: params.delayMinMs,
      delayMax: params.delayMaxMs,
      triggeredByUserId: params.userId,
      triggeredVia: "ui",
      trackSource: "blast-plan",
    });
    await deps.store.markRecipients(planId, toSendRows.map((r) => r.lead_id), "sent", null);
    await deps.usageSource.increment(params.orgId, todayDate, slice.toSend);
    lotsReleased = 1;
  }

  // Defer whatever did not fit today (budget pressure) into the next lot index so
  // it is retried tomorrow — elastic duration. When the whole lot fit, only the
  // future lots remain.
  const deferredRows = lot0.slice(slice.toSend);
  if (deferredRows.length > 0) {
    await deps.store.moveRecipientsToLot(planId, deferredRows.map((r) => r.lead_id), 1);
  }

  // A plan that drained its only lot today is complete; otherwise it is active
  // with the next release tomorrow.
  const drainedEntirely = lotsReleased >= 1 && lotsTotal <= 1 && deferredRows.length === 0;
  const patch: Partial<PlanRow> = {
    lots_released: lotsReleased,
    status: drainedEntirely ? "completed" : "active",
    next_release_date: drainedEntirely ? null : addDaysIso(todayDate, 1),
  };
  await deps.store.updatePlan(planId, patch);

  return { ok: true, planId, totalRecipients: total, lotsTotal, breakdown };
}

// ── releaseBlastPlanLot ──────────────────────────────────────────────────────

export interface ReleaseBlastPlanLotParams {
  planId: string;
  /** Resolved Daily Blast Budget for the org (#706). */
  dailyBudget: number;
  now?: Date;
}

export interface ReleaseBlastPlanLotResult {
  ok: boolean;
  sent: number;
  deferred: number;
  skippedRecency: number;
  skippedReplied: number;
  completed: boolean;
  error?: string;
}

/**
 * Release the next lot of a single active plan. Re-applies the #704 refinements
 * over the FROZEN lot, budget-bounds the dispatch via the shared #706 ledger,
 * marks sent/skipped, defers the remainder forward, and completes the plan when
 * its membership is exhausted.
 */
export async function releaseBlastPlanLot(
  deps: BlastPlanDeps,
  params: ReleaseBlastPlanLotParams,
): Promise<ReleaseBlastPlanLotResult> {
  const empty = { ok: false, sent: 0, deferred: 0, skippedRecency: 0, skippedReplied: 0, completed: false };

  const plan = await deps.store.getPlan(params.planId);
  if (!plan) return { ...empty, error: "plan_not_found" };
  // Paused / cancelled / already-completed plans are never released.
  if (plan.status !== "active") return { ...empty, error: "not_releasable" };

  const now = params.now ?? new Date();
  const todayDate = saoPauloUsageDate(now);
  const orgId = plan.organization_id;
  const lotIndex = plan.lots_released; // 0-based — lot 0 fired at creation

  // The releaser dispatches against the plan's instance. In production the row
  // carries only instance_id, so resolve the full row (provider, secrets) via the
  // injected resolver; tests inject `plan.instance` inline.
  let instance = plan.instance ?? null;
  if (!instance && deps.instanceResolver) {
    instance = await deps.instanceResolver(plan.instance_id);
  }
  if (!instance) return { ...empty, error: "instance_not_found" };
  // Tenant guard: the resolved instance must belong to the plan's org.
  if (instance.organization_id !== orgId) return { ...empty, error: "instance_org_mismatch" };

  // The plan's own frozen recipients for this lot still pending. NO re-query of
  // the source Stage — frozen membership only (ADR-0003 §4).
  const lot = (await deps.store.getLotRecipients(params.planId, lotIndex)).filter(
    (r) => r.status === "pending",
  );

  // Re-apply the Blast Audience refinements (#704) at SEND time over the frozen
  // membership: drop anyone who replied or was contacted since the snapshot.
  const refOpts = (plan.refinements ?? {}) as BlastRefinementOptions;
  const recencyOn = typeof refOpts.excludeBlastedWithinDays === "number" && refOpts.excludeBlastedWithinDays > 0;
  const nonResponderOn = refOpts.onlyNonResponders === true;

  let kept = lot;
  let skippedRecency = 0;
  let skippedReplied = 0;
  if ((recencyOn || nonResponderOn) && lot.length > 0) {
    const source = deps.activitySource;
    if (source) {
      const { keptLeadIds, skipped } = await refineBlastAudience({
        orgId,
        candidates: lot.map((r) => ({ leadId: r.lead_id, phone: r.phone })),
        options: { excludeBlastedWithinDays: refOpts.excludeBlastedWithinDays, onlyNonResponders: nonResponderOn },
        source,
        now,
      });
      const keepSet = new Set(keptLeadIds);
      const dropped = lot.filter((r) => !keepSet.has(r.lead_id));
      kept = lot.filter((r) => keepSet.has(r.lead_id));
      skippedRecency = skipped.alreadyContactedWithinWindow;
      skippedReplied = skipped.replied;
      if (dropped.length > 0) {
        await deps.store.markRecipients(params.planId, dropped.map((r) => r.lead_id), "skipped", "refined");
      }
    }
  }

  // Budget-bound the release against the shared ledger for today.
  const usedToday = await deps.usageSource.getUsedToday(orgId, todayDate, params.dailyBudget);
  const { remaining } = computeDailyClamp({ dailyBudget: params.dailyBudget, usedToday });
  const slice = selectLotSlice({ pendingCount: kept.length, remainingBudget: remaining });

  let sent = 0;
  if (slice.toSend > 0) {
    const toSendRows = kept.slice(0, slice.toSend);
    const recipients = buildPlanRecipients(toSendRows, plan.message, plan.image_url ?? undefined);
    await deps.dispatch(instance, {
      recipients,
      delayMin: plan.delay_min_ms ?? undefined,
      delayMax: plan.delay_max_ms ?? undefined,
      triggeredByUserId: plan.created_by ?? null,
      triggeredVia: "cron",
      trackSource: "blast-plan",
    });
    await deps.store.markRecipients(params.planId, toSendRows.map((r) => r.lead_id), "sent", null);
    await deps.usageSource.increment(orgId, todayDate, slice.toSend);
    sent = slice.toSend;
  }

  // Defer the budget-pressured remainder forward to the next lot index so it is
  // retried tomorrow (elastic duration).
  const deferredRows = kept.slice(slice.toSend);
  const deferred = deferredRows.length;
  if (deferred > 0) {
    await deps.store.moveRecipientsToLot(params.planId, deferredRows.map((r) => r.lead_id), lotIndex + 1);
  }

  // This lot is fully resolved (everything either sent, skipped, or deferred).
  // Advance lots_released. The plan is complete when the lot we just resolved was
  // the last one AND nothing deferred forward.
  const nextLotsReleased = lotIndex + 1;
  const lastLot = nextLotsReleased >= plan.lots_total;
  const completed = lastLot && deferred === 0;

  await deps.store.updatePlan(params.planId, {
    lots_released: nextLotsReleased,
    status: completed ? "completed" : "active",
    next_release_date: completed ? null : addDaysIso(todayDate, 1),
  });

  return { ok: true, sent, deferred, skippedRecency, skippedReplied, completed };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Per-lead frozen template variables, resolved at creation time (same shape as
 *  buildRecipients' leadVars; carried here so the wizard preview matches what the
 *  releaser sends). */
function snapshotVars(lead: BlastLead): Record<string, unknown> {
  const name = (lead.name ?? "").trim();
  return {
    nome: lead.name ?? "",
    primeiro_nome: name.split(/\s+/)[0] ?? "",
    empresa: lead.company ?? "",
  };
}

/** Build provider-ready recipients from frozen rows: normalize phone, resolve the
 *  message against each row's FROZEN variable snapshot (not a fresh lead read),
 *  apply the image shape, dedup by number. Phone-less rows are dropped by
 *  buildRecipients' own guard. The per-lead template is resolved here (one literal
 *  per recipient) so the frozen snapshot is honoured rather than re-reading leads;
 *  the budget was already applied by selectLotSlice, so cap never re-clamps. */
function buildPlanRecipients(
  rows: PlanRecipientRow[],
  message: string,
  imageUrl?: string,
): BlastRecipient[] {
  const out: BlastRecipient[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const built = buildRecipients([{ id: r.lead_id, phone: r.phone }], {
      template: resolveBlastMessage(message, r.variable_snapshot as Record<string, string | number | null | undefined>),
      cap: 1,
      imageUrl,
    });
    for (const rec of built.recipients) {
      if (seen.has(rec.number)) continue;
      seen.add(rec.number);
      out.push(rec);
    }
  }
  return out;
}
