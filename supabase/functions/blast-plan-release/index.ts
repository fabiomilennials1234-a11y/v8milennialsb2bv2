// deno-lint-ignore-file no-explicit-any
/**
 * blast-plan-release — daily Blast Plan lot releaser (ADR-0003, #707).
 *
 * Cron-only (pg_cron → pg_net → here, auth via x-cron-secret). Once per day it
 * pulls every ACTIVE plan whose next_release_date <= today (BRT) and releases the
 * plan's next lot:
 *
 *   - reads the lot's FROZEN pending recipients (NO re-query of the source Stage),
 *   - re-applies the #704 refinements (drops replied / recently-contacted since
 *     the snapshot),
 *   - dispatches at most the day's remaining shared Daily Blast Budget (#706),
 *   - marks sent/skipped, defers the budget-pressured remainder to the next day,
 *   - advances next_release_date, and marks the plan completed when its
 *     membership is exhausted.
 *
 * Paused / cancelled plans are never released (the active-only pull + the core's
 * status guard both enforce it). Each org's budget is read fresh per plan so two
 * plans in the same org share one day's ledger.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { runUazapiSenderJob } from "../_shared/dispatch-router.ts";
import {
  getDailyBlastBudget,
  blastDailyUsageSource,
  saoPauloUsageDate,
} from "../_shared/quick-blast/daily-budget.ts";
import { channelMessagesActivitySource } from "../_shared/quick-blast/refinements.ts";
import { blastPlanStore } from "../_shared/quick-blast/blast-plan-store.ts";
import { releaseBlastPlanLot } from "../_shared/quick-blast/blast-plan.ts";
import { instanceDailyUsageSource } from "../_shared/quick-blast/instance-budget.ts";
import { buildPostSendMover } from "../_shared/quick-blast/post-send-target.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const MAX_PLANS_PER_RUN = 100;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(
  withSentry("blast-plan-release", async (req: Request) => {
    const providedSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !providedSecret || !timingSafeCompare(providedSecret, CRON_SECRET)) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = new Date();
    const today = saoPauloUsageDate(now);
    const store = blastPlanStore(supabase);
    const usageSource = blastDailyUsageSource(supabase as any);
    const instanceUsageSource = instanceDailyUsageSource(supabase as any);
    const activitySource = channelMessagesActivitySource(supabase);

    // Resolve the plan's whatsapp_instances row by id (the releaser dispatches
    // against the full provider row). Cached per run to avoid refetching when an
    // org has several due plans on one instance.
    const instanceCache = new Map<string, any>();
    const instanceResolver = async (instanceId: string) => {
      if (instanceCache.has(instanceId)) return instanceCache.get(instanceId);
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("id", instanceId)
        .maybeSingle();
      instanceCache.set(instanceId, data ?? null);
      return data ?? null;
    };

    // Per-org budget cache — every plan in an org shares one day's ledger; the
    // ledger usage itself is read fresh inside the core (it changes as lots fire).
    const budgetCache = new Map<string, number>();
    const dailyBudgetFor = async (orgId: string) => {
      if (budgetCache.has(orgId)) return budgetCache.get(orgId)!;
      const b = await getDailyBlastBudget(supabase, orgId);
      budgetCache.set(orgId, b);
      return b;
    };

    const due = await store.listActivePlansDue(today);
    const plans = due.slice(0, MAX_PLANS_PER_RUN);

    let released = 0;
    let completed = 0;
    let totalSent = 0;
    const errors: Array<{ plan_id: string; error: string }> = [];

    for (const plan of plans) {
      try {
        const dailyBudget = await dailyBudgetFor(plan.organization_id);
        // Post-send move (wizard "Destino"): rebuild the per-lead mover from the
        // plan's own persisted target + org (never from any payload). Best-effort
        // — the core try/catches every call; a move failure never fails the send.
        const onRecipientsSent = plan.post_send_target
          ? buildPostSendMover(supabase, plan.organization_id, plan.post_send_target)
          : undefined;
        const result = await releaseBlastPlanLot(
          { store, usageSource, instanceUsageSource, dispatch: dispatchFor(supabase), activitySource, instanceResolver, onRecipientsSent },
          { planId: plan.id!, dailyBudget, now },
        );
        if (!result.ok) {
          errors.push({ plan_id: plan.id!, error: result.error ?? "release_failed" });
          continue;
        }
        released += 1;
        totalSent += result.sent;
        if (result.completed) completed += 1;

        await logRuntime({
          organizationId: plan.organization_id,
          module: "blast-plan-release",
          action: "lot_released",
          status: "success",
          entityType: "blast_plans",
          entityId: plan.id,
          payloadSnapshot: {
            sent: result.sent,
            deferred: result.deferred,
            skipped_recency: result.skippedRecency,
            skipped_replied: result.skippedReplied,
            completed: result.completed,
          },
        });
      } catch (e) {
        const msg = (e as Error).message ?? "unknown error";
        errors.push({ plan_id: plan.id!, error: msg });
        await logRuntime({
          organizationId: plan.organization_id,
          module: "blast-plan-release",
          action: "lot_released",
          status: "error",
          entityType: "blast_plans",
          entityId: plan.id,
          errorMessage: msg,
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      due: due.length,
      processed: plans.length,
      released,
      completed,
      total_sent: totalSent,
      errors,
    });
  }),
);

function dispatchFor(supabaseAdmin: any) {
  return (inst: any, input: any) =>
    runUazapiSenderJob(supabaseAdmin, inst, {
      ...input,
      triggeredVia: "cron",
      trackSource: "blast-plan",
    });
}
