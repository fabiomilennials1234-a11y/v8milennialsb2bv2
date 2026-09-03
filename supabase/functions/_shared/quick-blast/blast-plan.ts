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
import { personalizationName, personalizationFirstName } from "../lead-name.ts";
import {
  refineBlastAudience,
  type BlastActivitySource,
  type BlastRefinementOptions,
} from "./refinements.ts";
import { saoPauloUsageDate, computeDailyClamp, type BlastUsageSource } from "./daily-budget.ts";
import { planLotCount, selectLotSlice, addDaysIso } from "./plan-slicing.ts";
import { planBlast } from "./blast-planner.ts";
import { assignRecipientsToNumbers } from "./blast-plan-distribution.ts";
import { resolveInstanceCap, type InstanceUsageSource } from "./instance-budget.ts";
import { nextValidSendTime, type QuietWindow } from "./quiet-hours.ts";
import { assessReach, type ReachLimitSource } from "../whatsapp-reach-limit.ts";

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
  /** The WhatsApp number assigned to send this recipient (ADR-0015 multi-number).
   *  Null/undefined for legacy single-number plans — the releaser then falls back
   *  to the plan's own instance_id. */
  instance_id?: string | null;
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
  /** Funil de origem do público (coluna canônica da Fatia B); NULL = sem funil único. */
  pipeline_id?: string | null;
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
  /** Per-leva send window (ADR-0015 / #909). NULL columns = no window (legacy) —
   *  the releaser only defers a lot out of the window when window_days is set. */
  window_days?: number[] | null;
  window_from_minutes?: number | null;
  window_to_minutes?: number | null;
  /** Post-send destination (wizard "Destino"): each lead is moved there when
   *  its message is sent. NULL/absent = no move. Consumed by the edge fns to
   *  inject `onRecipientsSent`; the core treats it as opaque data. */
  post_send_target?: Record<string, unknown> | null;
  /**
   * O Template aprovado, quando o Disparo é pelo Canal Oficial (#1722).
   * NULL em plano de Chip, que manda texto livre em `message`. Congelado: a
   * Meta pode pausar ou reclassificar o Template a qualquer momento, e um
   * Disparo em curso não muda de conteúdo no meio (ADR-0029).
   */
  template?: Record<string, unknown> | null;
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

/**
 * O Canal Oficial NÃO passa pelo `deps.dispatch` (#1722).
 *
 * O motor do Chip é o `/sender/*` do fornecedor: despachar já É enviar, e por
 * isso o lote é marcado `sent` na mesma passada. O canal oficial não tem esse
 * endpoint — quem envia é `process-blast-recipients`, uma linha por vez. Marcar
 * `sent` aqui faria as linhas nascerem enviadas sem ninguém ter enviado: o
 * worker nunca as reivindicaria (ele só olha `pending`) e o Disparo pareceria
 * concluído com zero mensagens entregues.
 *
 * O que continua igual nos dois regimes: o lote é LIBERADO (`lots_released`
 * avança, e é isso que `claim_blast_recipients` enxerga) e os ledgers de
 * orçamento são incrementados — o Orçamento Diário conta pessoas planejadas
 * para hoje, e isso não depende de quem carrega a mensagem.
 */
function ehCanalOficial(instance: { provider?: string } | null | undefined): boolean {
  return (instance?.provider ?? "") === "notificame";
}

export type DispatchFn = (
  instance: { id: string; organization_id: string; provider?: string },
  input: {
    recipients: Array<{ number: string; text?: string; type?: string; file?: string; caption?: string }>;
    delayMin?: number;
    delayMax?: number;
    triggeredByUserId?: string | null;
    triggeredVia?: "ui" | "api" | "cron" | "workflow";
    trackSource?: string;
    /** Dispatch provenance (ADR-0016 §3): the plan+lot that originated this job,
     *  persisted into uazapi_sender_jobs.payload so the mass-send-status poll can
     *  trace a provider folder back to its blast_plan_recipients. Only ever set
     *  by the blast-plan paths — Quick Blast / campaign jobs never carry them. */
    planId?: string;
    lotIndex?: number;
  },
) => Promise<{ sender_job_id: string; uazapi_sender_id: string }>;

export interface BlastPlanDeps {
  store: BlastPlanStore;
  usageSource: BlastUsageSource;
  dispatch: DispatchFn;
  /** #704 activity source — only consulted when an activity-based refinement is
   *  requested. Injected so the releaser is testable without a live DB. */
  activitySource?: BlastActivitySource;
  /** Per-number daily ledger (ADR-0015). Required for multi-number plans (the
   *  edge fn always injects it); absent for legacy single-number plans/tests. */
  instanceUsageSource?: InstanceUsageSource;
  /** WhatsApp's own reach ceiling for the sending number (#1168).
   *
   *  Here the response to an exhausted ceiling is to DEFER the lot, not to
   *  refuse it: the releaser is a cron with nobody watching, and a plan whose
   *  remaining lots simply move to tomorrow is the behaviour the elastic-
   *  duration design already expects. Refusing would strand recipients.
   *
   *  Fail-open like everywhere else this gate appears — absent seam or unknown
   *  reading never holds a lot back. */
  reachLimitSource?: ReachLimitSource;
  /** Resolves the full whatsapp_instances row by id for the releaser, which only
   *  has the persisted instance_id (the in-memory `instance` is not a column).
   *  Tests inject `plan.instance` inline so they need not provide this. Returns
   *  the row including daily_blast_cap so the per-number cap can be enforced. */
  instanceResolver?: (
    instanceId: string,
  ) => Promise<{ id: string; organization_id: string; provider?: string; daily_blast_cap?: number | null } | null>;
  /** Post-send hook: invoked with the lead ids just marked "sent" (per dispatch
   *  batch — skipped/deferred leads never reach it). BEST-EFFORT: the core
   *  wraps every call in try/catch; a failure is logged and NEVER propagates —
   *  the leads already received their message, the send cannot fail because of
   *  the hook. Injected by the edge fns when the plan has a post_send_target. */
  onRecipientsSent?: (leadIds: string[]) => Promise<void>;
}

/** Invoke the post-send hook best-effort: log-and-swallow, never throw. */
async function notifyRecipientsSent(deps: BlastPlanDeps, leadIds: string[]): Promise<void> {
  if (!deps.onRecipientsSent || leadIds.length === 0) return;
  try {
    await deps.onRecipientsSent(leadIds);
  } catch (e) {
    console.warn(
      `[blast-plan] onRecipientsSent failed for ${leadIds.length} lead(s) (best-effort, ignored): ${(e as Error)?.message ?? e}`,
    );
  }
}

// ── createBlastPlan ──────────────────────────────────────────────────────────

/** A selected WhatsApp number + its per-number daily cap (ADR-0015). */
export interface BlastPlanNumber {
  instance: { id: string; organization_id: string; provider?: string };
  /** That number's Number Daily Cap (whatsapp_instances.daily_blast_cap). */
  cap: number;
}

export interface CreateBlastPlanParams {
  orgId: string;
  userId: string;
  /** The single sending number (legacy single-number path, ADR-0003). Optional
   *  when `numbers` is supplied for the multi-number path. */
  instance?: { id: string; organization_id: string; provider?: string };
  /** Selected numbers + per-number caps (ADR-0015). When present (length >= 1),
   *  the audience is distributed across them via planBlast and each recipient is
   *  stamped with its sending instance_id; the per-number ledger is enforced.
   *  Absent → the legacy single-number, org-budget path runs unchanged. */
  numbers?: BlastPlanNumber[];
  /** Per-leva send window (ADR-0015 / #909). Stored on the plan; the releaser
   *  defers a lot whose day falls outside it. Default applied by the caller. */
  window?: QuietWindow;
  /** The RESOLVED audience (org-scoped by the caller). Frozen here. */
  leads: BlastLead[];
  message: string;
  /**
   * O Template aprovado do Canal Oficial (#1722). Ausente em Disparo de Chip.
   * Quando presente, `message` carrega o CORPO renderizado do Template — é o
   * texto que a pessoa recebe, e é o que a Revisão e o histórico mostram.
   */
  template?: Record<string, unknown> | null;
  refinements: BlastRefinementOptions;
  imageUrl?: string;
  delayMinMs?: number;
  delayMaxMs?: number;
  /** Resolved Daily Blast Budget (#706). The caller reads it fail-closed. */
  dailyBudget: number;
  releaseTime?: string;
  /** Descriptor of how the audience was resolved (for the record only). */
  source?: Record<string, unknown> | null;
  /** Funil de origem do público (Fatia B — canônico, uuid JÁ validado na org
   *  pelo edge fn). NULL = público sem funil único (planilha, todos os funis). */
  pipelineId?: string | null;
  /** Post-send destination (already validated fail-closed by the edge fn).
   *  Persisted on the plan so the releaser can rebuild the move hook. */
  postSendTarget?: Record<string, unknown> | null;
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

  const numbersMode = Array.isArray(params.numbers) && params.numbers.length > 0;

  if (numbersMode) {
    // Multi-number tenant + cap guard: every selected number must be in-org and
    // carry a positive cap (fail-closed — a zero/negative cap is rejected, never
    // treated as unlimited).
    for (const n of params.numbers!) {
      if (n.instance.organization_id !== params.orgId) {
        return { ...empty, error: "instance_org_mismatch" };
      }
      if (!(Number.isFinite(n.cap) && n.cap > 0)) {
        return { ...empty, error: "invalid_cap" };
      }
    }
  } else {
    if (!params.instance || params.instance.organization_id !== params.orgId) {
      return { ...empty, error: "instance_org_mismatch" };
    }
  }

  if (!Array.isArray(params.leads) || params.leads.length === 0) {
    return { ...empty, error: "no_audience" };
  }
  if (!params.message || params.message.trim().length === 0) {
    return { ...empty, error: "empty_message" };
  }

  const now = params.now ?? new Date();
  const todayDate = saoPauloUsageDate(now);

  // ADR-0015 multi-number path: distribute the frozen audience across the selected
  // numbers via planBlast, stamp each recipient's sending number, enforce the
  // per-number ledger on lot 1. Kept as a dedicated branch so the legacy
  // single-number, org-budget path below is byte-for-byte unchanged.
  if (numbersMode) {
    return createMultiNumberBlastPlan(deps, params, now, todayDate);
  }

  const dailyBudget = params.dailyBudget;
  const singleInstance = params.instance!;

  // Slice the FROZEN audience into daily lots of dailyBudget each. Membership is
  // captured here and never re-queried — new Stage entrants are excluded.
  const total = params.leads.length;
  const lotsTotal = planLotCount(total, dailyBudget);

  // Build the frozen recipient rows up front (variable snapshot per lead). Lot 0
  // is today's; subsequent lots are future days.
  const planRow: Omit<PlanRow, "id"> = {
    organization_id: params.orgId,
    instance_id: singleInstance.id,
    created_by: params.userId,
    status: "active",
    source: params.source ?? null,
    pipeline_id: params.pipelineId ?? null,
    message: params.message,
    template: params.template ?? null,
    refinements: (params.refinements as Record<string, unknown>) ?? null,
    image_url: params.imageUrl ?? null,
    delay_min_ms: params.delayMinMs ?? null,
    delay_max_ms: params.delayMaxMs ?? null,
    total_recipients: total,
    lots_total: lotsTotal,
    lots_released: 0,
    release_time: params.releaseTime ?? "09:00",
    next_release_date: todayDate,
    post_send_target: params.postSendTarget ?? null,
    instance: singleInstance,
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

  // Per-number Daily Cap (ADR-0015) on the single-number path too: lot 0 is
  // additionally bounded by the number's OWN ledger headroom, mirroring the
  // multi-number branch. Seam absent (legacy tests) → org budget alone.
  let numberRemaining = Number.POSITIVE_INFINITY;
  if (deps.instanceUsageSource) {
    const cap = resolveInstanceCap(
      (singleInstance as { daily_blast_cap?: number | null }).daily_blast_cap,
    );
    const used = await deps.instanceUsageSource.getUsedToday(singleInstance.id, todayDate, cap);
    numberRemaining = Math.max(0, cap - used);
  }

  const lot0 = recipientRows.filter((r) => r.lot_index === 0);
  const slice = selectLotSlice({
    pendingCount: lot0.length,
    remainingBudget: Math.min(remaining, numberRemaining),
  });

  let lotsReleased = 0;
  if (slice.toSend > 0) {
    const toSendRows = lot0.slice(0, slice.toSend);
    if (!ehCanalOficial(singleInstance)) {
      const recipients = buildPlanRecipients(toSendRows, params.message, params.imageUrl);
      await deps.dispatch(singleInstance, {
        recipients,
        delayMin: params.delayMinMs,
        delayMax: params.delayMaxMs,
        triggeredByUserId: params.userId,
        triggeredVia: "ui",
        trackSource: "blast-plan",
        planId,
        lotIndex: 0,
      });
      await deps.store.markRecipients(planId, toSendRows.map((r) => r.lead_id), "sent", null);
      await notifyRecipientsSent(deps, toSendRows.map((r) => r.lead_id));
    }
    await deps.usageSource.increment(params.orgId, todayDate, slice.toSend);
    if (deps.instanceUsageSource) {
      await deps.instanceUsageSource.increment(singleInstance.id, todayDate, slice.toSend);
    }
    lotsReleased = 1;
  }

  // Defer whatever did not fit today (budget pressure) into the next lot index
  // so it is retried tomorrow — elastic duration. Move ONLY when something was
  // released (mirrors the multi-number branch): with lotsReleased=0 the next
  // release reads lot `lots_released` = 0, so moving the rows to lot 1 would
  // strand them — the releaser would find lot 0 empty and complete the plan
  // with every recipient stuck pending (reachable when the number's daily cap
  // is already exhausted at creation).
  const deferredRows = lot0.slice(slice.toSend);
  if (deferredRows.length > 0 && lotsReleased >= 1) {
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

// ── createMultiNumberBlastPlan (ADR-0015) ────────────────────────────────────

/**
 * Multi-number Blast Plan creation. The frozen audience is distributed across the
 * selected numbers via planBlast (round-robin per number per day, each capped at
 * its Number Daily Cap); every recipient is stamped with the number that will
 * send it. Lot 1 (today) fires per-number, bounded by each number's remaining
 * daily ledger headroom; the budget-pressured remainder defers forward. The
 * org-wide #706 ledger is still incremented (cross-blast visibility), but the
 * binding control here is the per-number cap.
 */
async function createMultiNumberBlastPlan(
  deps: BlastPlanDeps,
  params: CreateBlastPlanParams,
  _now: Date,
  todayDate: string,
): Promise<CreateBlastPlanResult> {
  const numbers = params.numbers!;
  const total = params.leads.length;

  // planBlast decides per-day counts per number; assign turns counts into a
  // concrete per-recipient (lot_index, instance_id) over the ordered audience.
  const planResult = planBlast({
    totalRecipients: total,
    numbers: numbers.map((n) => ({ id: n.instance.id, cap: n.cap })),
    startDateIso: todayDate,
  });
  const lotsTotal = planResult.dayCount;
  const assignments = assignRecipientsToNumbers(params.leads, planResult);

  // The plan row keeps ONE instance_id (NOT NULL column) — the first number, used
  // only as the legacy fallback; the real per-recipient routing lives on each
  // blast_plan_recipients.instance_id.
  const primary = numbers[0].instance;
  const planRow: Omit<PlanRow, "id"> = {
    organization_id: params.orgId,
    instance_id: primary.id,
    created_by: params.userId,
    status: "active",
    source: params.source ?? null,
    pipeline_id: params.pipelineId ?? null,
    message: params.message,
    template: params.template ?? null,
    refinements: (params.refinements as Record<string, unknown>) ?? null,
    image_url: params.imageUrl ?? null,
    delay_min_ms: params.delayMinMs ?? null,
    delay_max_ms: params.delayMaxMs ?? null,
    total_recipients: total,
    lots_total: lotsTotal,
    lots_released: 0,
    release_time: params.releaseTime ?? "09:00",
    next_release_date: todayDate,
    window_days: params.window?.days ?? null,
    window_from_minutes: params.window?.fromMinutes ?? null,
    window_to_minutes: params.window?.toMinutes ?? null,
    post_send_target: params.postSendTarget ?? null,
    instance: primary,
  };
  const planId = await deps.store.insertPlan(planRow);

  const recipientRows: PlanRecipientRow[] = assignments.map((a) => ({
    plan_id: planId,
    lead_id: a.lead.id,
    phone: a.lead.phone ?? null,
    variable_snapshot: snapshotVars(a.lead),
    lot_index: a.lotIndex,
    instance_id: a.instanceId,
    status: "pending",
    reason: null,
  }));
  const breakdown: Array<{ lotIndex: number; date: string; count: number }> = [];
  for (let lot = 0; lot < lotsTotal; lot++) {
    breakdown.push({
      lotIndex: lot,
      date: addDaysIso(todayDate, lot),
      count: recipientRows.filter((r) => r.lot_index === lot).length,
    });
  }
  await deps.store.insertRecipients(recipientRows);

  // Dispatch lot 0 TODAY, per number, each bounded by that number's remaining cap.
  const lot0 = recipientRows.filter((r) => r.lot_index === 0);
  const byInstance = groupByInstance(lot0, primary.id);

  let totalSent = 0;
  const deferredRows: PlanRecipientRow[] = [];
  for (const n of numbers) {
    const rows = byInstance.get(n.instance.id) ?? [];
    if (rows.length === 0) continue;

    let allowed = rows.length;
    if (deps.instanceUsageSource) {
      const used = await deps.instanceUsageSource.getUsedToday(n.instance.id, todayDate, n.cap);
      allowed = Math.max(0, Math.min(rows.length, n.cap - used));
    }
    const toSendRows = rows.slice(0, allowed);
    deferredRows.push(...rows.slice(allowed));

    if (toSendRows.length > 0) {
      if (!ehCanalOficial(n.instance)) {
        const recipients = buildPlanRecipients(toSendRows, params.message, params.imageUrl);
        await deps.dispatch(n.instance, {
          recipients,
          delayMin: params.delayMinMs,
          delayMax: params.delayMaxMs,
          triggeredByUserId: params.userId,
          triggeredVia: "ui",
          trackSource: "blast-plan",
          planId,
          lotIndex: 0,
        });
        await deps.store.markRecipients(planId, toSendRows.map((r) => r.lead_id), "sent", null);
        await notifyRecipientsSent(deps, toSendRows.map((r) => r.lead_id));
      }
      if (deps.instanceUsageSource) {
        await deps.instanceUsageSource.increment(n.instance.id, todayDate, toSendRows.length);
      }
      totalSent += toSendRows.length;
    }
  }
  // Org-wide ledger records the day's total (defense in depth; keeps single-number
  // Quick Blasts later today aware of what these numbers already consumed).
  if (totalSent > 0) {
    await deps.usageSource.increment(params.orgId, todayDate, totalSent);
  }

  const lotsReleased = totalSent > 0 ? 1 : 0;
  // Where the budget-pressured remainder retries: the next lot the releaser will
  // read is `lots_released`. When lot 1 fired (lotsReleased=1) the leftovers join
  // lot 1; when nothing fired today (lotsReleased=0) they stay at lot 0.
  const patch: Partial<PlanRow> = { lots_released: lotsReleased };
  if (deferredRows.length > 0 && lotsReleased >= 1) {
    await deps.store.moveRecipientsToLot(planId, deferredRows.map((r) => r.lead_id), lotsReleased);
    patch.lots_total = Math.max(lotsTotal, lotsReleased + 1);
  }
  const drainedEntirely = lotsReleased >= 1 && lotsTotal <= 1 && deferredRows.length === 0;
  patch.status = drainedEntirely ? "completed" : "active";
  patch.next_release_date = drainedEntirely ? null : addDaysIso(todayDate, 1);
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
  /** Numbers held back by WhatsApp's reach ceiling this run (#1168). Empty when
   *  none were. Lets the cron's runtime log distinguish a lot deferred for
   *  reach from one deferred for budget, and is the calibration signal from the
   *  highest-volume path. */
  reachBlockedInstances?: string[];
}

/**
 * Release the next lot of a single active plan. Re-applies the #704 refinements
 * over the FROZEN lot, budget-bounds the dispatch via the shared #706 ledger,
 * marks sent/skipped, defers the remainder forward, and completes the plan when
 * its membership is exhausted.
 */
/**
 * Reach allowance expressed as a headroom clamp for one sending number.
 *
 * Returns 0 when WhatsApp clearly says the number is at its ceiling, and
 * Infinity otherwise — including for an absent seam, an unknown reading, or a
 * throwing source. Callers `Math.min` it into the headroom they already
 * compute, so an exhausted number defers its rows through the SAME path the
 * daily caps already use. No new branch, no stranded recipients.
 *
 * It deliberately does NOT clamp to the reported headroom. That counter tracks
 * NEW CONTACTS reached, which is not one-to-one with messages sent — a lot
 * aimed largely at known contacts would be throttled for no reason. Only a
 * fully exhausted ceiling is unambiguous enough to act on.
 */
async function reachClamp(
  deps: BlastPlanDeps,
  instanceId: string,
): Promise<number> {
  if (!deps.reachLimitSource) return Number.POSITIVE_INFINITY;
  try {
    const verdict = assessReach(await deps.reachLimitSource.get(instanceId));
    return verdict.exhausted ? 0 : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

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

  // ADR-0015 / #909: honour the plan's send window. When today (BRT) falls outside
  // the allowed days, defer the WHOLE release to the next valid day without
  // dispatching. Only engages when window_days is populated (legacy plans skip).
  if (plan.window_days && plan.window_days.length > 0) {
    const win: QuietWindow = {
      days: plan.window_days,
      fromMinutes: plan.window_from_minutes ?? 0,
      toMinutes: plan.window_to_minutes ?? 24 * 60,
    };
    const validDate = nextValidSendTime(win, `${todayDate}T00:00`).split("T")[0];
    if (validDate > todayDate) {
      await deps.store.updatePlan(params.planId, { next_release_date: validDate });
      return { ok: true, sent: 0, deferred: 0, skippedRecency: 0, skippedReplied: 0, completed: false };
    }
  }

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

  // Two dispatch modes share the remainder/defer/complete tail below:
  //   - multi-number (ADR-0015): each frozen recipient carries its sending number;
  //     group by number and bound each group by that number's own daily cap.
  //   - legacy single-number (ADR-0003): one number, bounded by the org-wide
  //     #706 ledger. Unchanged.
  const dispatchOpts = {
    delayMin: plan.delay_min_ms ?? undefined,
    delayMax: plan.delay_max_ms ?? undefined,
    triggeredByUserId: plan.created_by ?? null,
    triggeredVia: "cron" as const,
    trackSource: "blast-plan",
    // Dispatch provenance (ADR-0016 §3): deferred recipients carry the lot index
    // they are RELEASED under (this one), not the lot they were frozen into.
    planId: params.planId,
    lotIndex,
  };

  let sent = 0;
  let deferredRows: PlanRecipientRow[] = [];
  // Numbers held back by WhatsApp's ceiling this run. Without this a lot
  // deferred for reach is indistinguishable from one deferred for budget —
  // and this cron is precisely where nobody is watching to tell them apart.
  const reachBlocked: string[] = [];

  const multiNumber = !!deps.instanceUsageSource && kept.some((r) => r.instance_id);
  if (multiNumber) {
    const groups = groupByInstance(kept, instance.id);
    for (const [instanceId, rows] of groups) {
      // Resolve the sending number's row (provider + cap). Reuse the primary when
      // the stamp matches it; otherwise fetch via the resolver.
      let inst = instanceId === instance.id ? instance : null;
      if (!inst && deps.instanceResolver) inst = await deps.instanceResolver(instanceId);
      if (!inst || inst.organization_id !== orgId) {
        // Unresolvable / foreign number → defer the whole group, never send.
        deferredRows.push(...rows);
        continue;
      }
      const cap = resolveInstanceCap((inst as { daily_blast_cap?: number | null }).daily_blast_cap);
      const used = await deps.instanceUsageSource!.getUsedToday(instanceId, todayDate, cap);
      // Local headroom first. Only ask the provider when this number could
      // actually send — same principle the Quick Blast gate follows: never
      // spend a network read to refuse what the ledgers already refused.
      const localAllowed = Math.max(0, Math.min(rows.length, cap - used));
      let allowed = localAllowed;
      if (localAllowed > 0 && (await reachClamp(deps, instanceId)) === 0) {
        allowed = 0;
        reachBlocked.push(instanceId);
      }
      const toSendRows = rows.slice(0, allowed);
      deferredRows.push(...rows.slice(allowed));
      if (toSendRows.length > 0) {
        if (!ehCanalOficial(inst)) {
          const recipients = buildPlanRecipients(toSendRows, plan.message, plan.image_url ?? undefined);
          await deps.dispatch(inst, { recipients, ...dispatchOpts });
          await deps.store.markRecipients(params.planId, toSendRows.map((r) => r.lead_id), "sent", null);
          await notifyRecipientsSent(deps, toSendRows.map((r) => r.lead_id));
        }
        await deps.instanceUsageSource!.increment(instanceId, todayDate, toSendRows.length);
        sent += toSendRows.length;
      }
    }
    // Org-wide ledger records the day's total (cross-blast visibility).
    if (sent > 0) await deps.usageSource.increment(orgId, todayDate, sent);
  } else {
    // Budget-bound the release against the shared ledger for today, AND the
    // number's OWN Daily Cap (ADR-0015) when the seam is present — mirrors the
    // multi-number branch; seam absent (legacy tests) → org budget alone.
    const usedToday = await deps.usageSource.getUsedToday(orgId, todayDate, params.dailyBudget);
    const { remaining } = computeDailyClamp({ dailyBudget: params.dailyBudget, usedToday });
    let numberRemaining = Number.POSITIVE_INFINITY;
    if (deps.instanceUsageSource) {
      const cap = resolveInstanceCap(
        (instance as { daily_blast_cap?: number | null }).daily_blast_cap,
      );
      const used = await deps.instanceUsageSource.getUsedToday(instance.id, todayDate, cap);
      numberRemaining = Math.max(0, cap - used);
    }
    // WhatsApp's own ceiling clamps the same headroom the daily caps do, so an
    // exhausted number defers its lot instead of burning itself further. Only
    // consulted when the local ledgers left room — see the multi-number branch.
    if (
      Math.min(remaining, numberRemaining) > 0 &&
      (await reachClamp(deps, instance.id)) === 0
    ) {
      numberRemaining = 0;
      reachBlocked.push(instance.id);
    }
    const slice = selectLotSlice({
      pendingCount: kept.length,
      remainingBudget: Math.min(remaining, numberRemaining),
    });
    if (slice.toSend > 0) {
      const toSendRows = kept.slice(0, slice.toSend);
      if (!ehCanalOficial(instance)) {
        const recipients = buildPlanRecipients(toSendRows, plan.message, plan.image_url ?? undefined);
        await deps.dispatch(instance, { recipients, ...dispatchOpts });
        await deps.store.markRecipients(params.planId, toSendRows.map((r) => r.lead_id), "sent", null);
        await notifyRecipientsSent(deps, toSendRows.map((r) => r.lead_id));
      }
      await deps.usageSource.increment(orgId, todayDate, slice.toSend);
      if (deps.instanceUsageSource) {
        await deps.instanceUsageSource.increment(instance.id, todayDate, slice.toSend);
      }
      sent = slice.toSend;
    }
    deferredRows = kept.slice(slice.toSend);
  }

  // Defer the budget-pressured remainder forward to the next lot index so it is
  // retried tomorrow (elastic duration).
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

  return { ok: true, sent, deferred, skippedRecency, skippedReplied, completed, reachBlockedInstances: reachBlocked };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Group recipient rows by their sending number, preserving first-seen order. A
 *  row without an instance_id (legacy) falls back to `fallbackId` (the plan's own
 *  number). */
function groupByInstance(
  rows: PlanRecipientRow[],
  fallbackId: string,
): Map<string, PlanRecipientRow[]> {
  const map = new Map<string, PlanRecipientRow[]>();
  for (const r of rows) {
    const key = r.instance_id ?? fallbackId;
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(r);
  }
  return map;
}

/** Per-lead frozen template variables, resolved at creation time (same shape as
 *  buildRecipients' leadVars; carried here so the wizard preview matches what the
 *  releaser sends). */
function snapshotVars(lead: BlastLead): Record<string, unknown> {
  const safeName = personalizationName(lead.name);
  return {
    nome: safeName,
    primeiro_nome: personalizationFirstName(lead.name),
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
