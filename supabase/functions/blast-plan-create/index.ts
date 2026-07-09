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
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { runUazapiSenderJob } from "../_shared/dispatch-router.ts";
import { getDailyBlastBudget, blastDailyUsageSource } from "../_shared/quick-blast/daily-budget.ts";
import { channelMessagesActivitySource } from "../_shared/quick-blast/refinements.ts";
import { blastPlanStore } from "../_shared/quick-blast/blast-plan-store.ts";
import { createBlastPlan } from "../_shared/quick-blast/blast-plan.ts";
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
  withErrorBoundary("blast-plan-create", async (req: Request) => {
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

    if (!instance_id || !Array.isArray(lead_ids) || lead_ids.length === 0 || !message) {
      return jsonResponse(400, { error: "Missing instance_id, lead_ids or message" }, corsHeaders);
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

    // Instance must belong to the caller's org (tenant guard also enforced in core).
    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instance_id)
      .maybeSingle();
    if (!instance) return jsonResponse(404, { error: "Instance not found" }, corsHeaders);
    if ((instance as any).organization_id !== orgId) {
      return jsonResponse(403, { error: "instance_org_mismatch" }, corsHeaders);
    }

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
        module: "campaign",
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
        module: "campaign",
        action: "failed",
        status: "error",
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  }),
);
