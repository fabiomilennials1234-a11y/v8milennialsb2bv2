// deno-lint-ignore-file no-explicit-any
/**
 * blast-plan-create — create an auto-batched Blast Plan (ADR-0003, #707).
 *
 * A Blast Plan is a Mass Send whose audience exceeds one day's remaining Daily
 * Blast Budget (#706): the audience is FROZEN here and sliced into daily lots
 * over consecutive days. Lot 1 fires today (bounded by the remaining shared
 * budget); the rest are released by the blast-plan-release cron, which re-applies
 * the #704 refinements over the frozen membership at send time.
 *
 * Access policy mirrors quick-blast-create (ADR-0002): NO role gate — any
 * authenticated org member may create, scoped to their own organization. The
 * org-wide Daily Blast Budget is the sole, server-enforced, fail-closed
 * guardrail. The caller passes the audience as resolved lead_ids (the wizard's
 * frozen selection); foreign-org ids are excluded by the org-scoped lead fetch.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { runUazapiSenderJob } from "../_shared/dispatch-router.ts";
import { getDailyBlastBudget, blastDailyUsageSource } from "../_shared/quick-blast/daily-budget.ts";
import { channelMessagesActivitySource } from "../_shared/quick-blast/refinements.ts";
import { blastPlanStore } from "../_shared/quick-blast/blast-plan-store.ts";
import { createBlastPlan, type BlastPlanNumber } from "../_shared/quick-blast/blast-plan.ts";
import { instanceDailyUsageSource, resolveInstanceCap } from "../_shared/quick-blast/instance-budget.ts";
import { resolveBlastWindow } from "../_shared/quick-blast/blast-plan-distribution.ts";
import type { BlastLead } from "../_shared/quick-blast/recipients.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withSentry("blast-plan-create", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const corsHeaders = withSecurityHeaders(
      (await import("../_shared/cors.ts")).getCorsHeaders(origin) as Record<string, string>,
    );
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, corsHeaders);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Missing auth" }, corsHeaders);
    }
    const userJwt = authHeader.slice(7);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(userJwt);
    if (userErr || !userData?.user) {
      return jsonResponse(401, { error: "Invalid token" }, corsHeaders);
    }
    const user = userData.user;

    // Resolve caller org — NO role gate (ADR-0002). Any member may create.
    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member?.organization_id) {
      return jsonResponse(403, { error: "No organization" }, corsHeaders);
    }
    const orgId = member.organization_id as string;

    const body = await req.json().catch(() => null);
    if (!body) return jsonResponse(400, { error: "Invalid JSON" }, corsHeaders);

    const {
      instance_id,
      instance_ids,
      caps,
      window: windowRaw,
      lead_ids,
      message,
      delay_min_ms,
      delay_max_ms,
      image_url,
      exclude_blasted_within_days,
      only_non_responders,
      release_time,
      source,
    } = body as {
      instance_id?: string;
      /** ADR-0015 multi-number: all selected numbers. Falls back to [instance_id]. */
      instance_ids?: string[];
      /** Optional per-number cap override, keyed by instance id. Default: the
       *  number's whatsapp_instances.daily_blast_cap. */
      caps?: Record<string, number>;
      /** Optional per-leva send window (ADR-0015 / #909). Default Mon–Sat 08–20. */
      window?: { days?: number[]; from_minutes?: number; to_minutes?: number };
      lead_ids?: string[];
      message?: string;
      delay_min_ms?: number;
      delay_max_ms?: number;
      image_url?: string;
      exclude_blasted_within_days?: number;
      only_non_responders?: boolean;
      release_time?: string;
      source?: Record<string, unknown>;
    };

    // Multi-number when instance_ids[] is supplied; otherwise the legacy single
    // instance_id path (retrocompat — any existing caller keeps working).
    const multiNumber = Array.isArray(instance_ids) && instance_ids.length > 0;
    const idList = multiNumber
      ? Array.from(new Set(instance_ids!.filter((s) => typeof s === "string" && s.length > 0)))
      : instance_id
        ? [instance_id]
        : [];

    if (idList.length === 0 || !Array.isArray(lead_ids) || lead_ids.length === 0 || !message) {
      return jsonResponse(400, { error: "Missing instance_id(s), lead_ids or message" }, corsHeaders);
    }

    // Frozen refinements (#704) — re-applied at each future lot release. A
    // positive recency window engages it; anything else leaves it off (fail-safe).
    const refinements = {
      excludeBlastedWithinDays:
        typeof exclude_blasted_within_days === "number" && exclude_blasted_within_days > 0
          ? Math.floor(exclude_blasted_within_days)
          : undefined,
      onlyNonResponders: only_non_responders === true,
    };

    // Every selected number must exist and belong to the caller's org (tenant
    // guard also re-enforced in the core).
    const { data: instanceRows } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .in("id", idList);
    const instances = (instanceRows ?? []) as any[];
    if (instances.length !== idList.length) {
      return jsonResponse(404, { error: "Instance not found" }, corsHeaders);
    }
    for (const inst of instances) {
      if (inst.organization_id !== orgId) {
        return jsonResponse(403, { error: "instance_org_mismatch" }, corsHeaders);
      }
    }
    const instanceById = new Map(instances.map((i) => [i.id as string, i]));

    // ADR-0015 multi-number distribution params: one BlastPlanNumber per selected
    // line, each carrying its effective Number Daily Cap (payload override → the
    // line's stored daily_blast_cap → fail-closed default).
    const numbers: BlastPlanNumber[] | undefined = multiNumber
      ? idList.map((id) => {
          const inst = instanceById.get(id)!;
          const capRaw = caps && typeof caps[id] === "number" ? caps[id] : inst.daily_blast_cap;
          return { instance: inst, cap: resolveInstanceCap(capRaw) };
        })
      : undefined;
    const window = multiNumber ? resolveBlastWindow(
      windowRaw
        ? { days: windowRaw.days, fromMinutes: windowRaw.from_minutes, toMinutes: windowRaw.to_minutes }
        : null,
    ) : undefined;
    // Legacy single-number path still passes a bare instance row.
    const instance = multiNumber ? undefined : instanceById.get(idList[0]);

    // Freeze the audience: org-scoped lead fetch — foreign-org ids drop out here.
    const { data: leadRows } = await supabaseAdmin
      .from("leads")
      .select("id, name, company, phone")
      .eq("organization_id", orgId)
      .in("id", lead_ids);
    const leads = (leadRows ?? []) as BlastLead[];

    const dailyBudget = await getDailyBlastBudget(supabaseAdmin, orgId);

    try {
      const result = await createBlastPlan(
        {
          store: blastPlanStore(supabaseAdmin),
          usageSource: blastDailyUsageSource(supabaseAdmin as any),
          instanceUsageSource: instanceDailyUsageSource(supabaseAdmin as any),
          activitySource: channelMessagesActivitySource(supabaseAdmin),
          dispatch: (inst, input) =>
            runUazapiSenderJob(supabaseAdmin, inst as any, {
              ...input,
              triggeredVia: "ui",
              trackSource: "blast-plan",
            }),
        },
        {
          orgId,
          userId: user.id,
          instance: instance as any,
          numbers,
          window,
          leads,
          message,
          refinements,
          imageUrl: image_url,
          delayMinMs: delay_min_ms,
          delayMaxMs: delay_max_ms,
          dailyBudget,
          releaseTime: release_time,
          source: source ?? null,
        },
      );

      if (!result.ok) {
        return jsonResponse(400, { error: result.error ?? "plan_failed" }, corsHeaders);
      }

      await logRuntime({
        organizationId: orgId,
        module: "blast-plan-create",
        action: "created",
        status: "success",
        entityType: "blast_plans",
        entityId: result.planId,
        payloadSnapshot: {
          total_recipients: result.totalRecipients,
          lots_total: result.lotsTotal,
        },
      });

      return jsonResponse(200, {
        ok: true,
        plan_id: result.planId,
        total_recipients: result.totalRecipients,
        lots_total: result.lotsTotal,
        breakdown: result.breakdown,
      }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "unknown error";
      await logRuntime({
        organizationId: orgId,
        module: "blast-plan-create",
        action: "failed",
        status: "error",
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  }),
);
