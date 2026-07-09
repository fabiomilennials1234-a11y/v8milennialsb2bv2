// deno-lint-ignore-file no-explicit-any
/**
 * blast-plan-control — pause / resume / cancel a Blast Plan (ADR-0003, #707).
 *
 * The Disparos panel needs to pause, resume, or cancel a running Blast Plan, but
 * blast_plans writes are service_role-only (RLS: members have SELECT, no
 * insert/update/delete grant — a plan cannot be mutated to widen a blast outside
 * the server-enforced budget). This function is the authenticated control plane:
 * it resolves the caller's org, tenant-guards the target plan, and applies a
 * guarded status transition via service_role.
 *
 * Access policy mirrors blast-plan-create (ADR-0002): NO role gate — any
 * authenticated org member who can fire a blast may control THEIR org's plans.
 * The tenant guard (plan.organization_id === callerOrg) is the boundary; a plan
 * in another org is reported as 404 (existence not leaked).
 *
 * Transitions (illegal ones rejected, never silently no-op):
 *   pause   active            → paused
 *   resume  paused            → active   (re-arm next_release_date to tomorrow BRT
 *                                          if null, so the daily releaser picks it up)
 *   cancel  active | paused   → cancelled (still-pending recipients → skipped,
 *                                          reason 'plan_cancelled')
 * Completed / cancelled plans reject any further control (terminal states).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { saoPauloUsageDate } from "../_shared/quick-blast/daily-budget.ts";
import { addDaysIso } from "../_shared/quick-blast/plan-slicing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type ControlAction = "pause" | "resume" | "cancel";

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/**
 * Pure transition decision. Given the current plan status and the requested
 * action, return the next status (or an error for an illegal transition). Kept
 * IO-free so it is unit-testable without a live DB and the guard logic is
 * inspectable in one place. `reRelease` flags resume needing next_release_date
 * re-armed; `cancelRecipients` flags cancel needing pending rows skipped.
 */
export function decideTransition(
  current: string,
  action: ControlAction,
): { ok: true; next: string; reRelease: boolean; cancelRecipients: boolean } | { ok: false; error: string } {
  switch (action) {
    case "pause":
      if (current === "active") return { ok: true, next: "paused", reRelease: false, cancelRecipients: false };
      return { ok: false, error: `cannot_pause_${current}` };
    case "resume":
      if (current === "paused") return { ok: true, next: "active", reRelease: true, cancelRecipients: false };
      return { ok: false, error: `cannot_resume_${current}` };
    case "cancel":
      if (current === "active" || current === "paused") {
        return { ok: true, next: "cancelled", reRelease: false, cancelRecipients: true };
      }
      return { ok: false, error: `cannot_cancel_${current}` };
    default:
      return { ok: false, error: "invalid_action" };
  }
}

Deno.serve(
  withErrorBoundary("blast-plan-control", async (req: Request) => {
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

    // Resolve caller org — NO role gate (ADR-0002). Any member may control their
    // org's plans (same gate as blast-plan-create).
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

    const { plan_id, action } = body as { plan_id?: string; action?: string };
    if (!plan_id || typeof plan_id !== "string") {
      return jsonResponse(400, { error: "Missing plan_id" }, corsHeaders);
    }
    if (action !== "pause" && action !== "resume" && action !== "cancel") {
      return jsonResponse(400, { error: "Invalid action" }, corsHeaders);
    }

    // Load the plan via service_role (RLS-bypassing) and tenant-guard it. A plan
    // outside the caller's org is reported as 404 — existence is not leaked.
    const { data: plan } = await supabaseAdmin
      .from("blast_plans")
      .select("id, organization_id, status, next_release_date")
      .eq("id", plan_id)
      .maybeSingle();
    if (!plan) return jsonResponse(404, { error: "Plan not found" }, corsHeaders);
    if ((plan as any).organization_id !== orgId) {
      return jsonResponse(404, { error: "Plan not found" }, corsHeaders);
    }

    const decision = decideTransition((plan as any).status as string, action);
    if (!decision.ok) {
      return jsonResponse(409, { error: decision.error }, corsHeaders);
    }

    try {
      // Cancel: skip every still-pending recipient across ALL lots before flipping
      // the plan to cancelled, so the releaser (active-only) and the progress view
      // see a clean terminal state with no orphaned pending rows.
      if (decision.cancelRecipients) {
        const { error: recErr } = await supabaseAdmin
          .from("blast_plan_recipients")
          .update({ status: "skipped", reason: "plan_cancelled" })
          .eq("plan_id", plan_id)
          .eq("status", "pending");
        if (recErr) throw new Error(`cancel recipients failed: ${recErr.message}`);
      }

      // Build the plan patch. Resume re-arms next_release_date to tomorrow (BRT)
      // when it is null so the daily releaser picks the plan back up; an existing
      // future date is left untouched (it was set when the plan paused).
      const patch: Record<string, unknown> = { status: decision.next };
      if (decision.next === "cancelled") {
        patch.next_release_date = null;
      } else if (decision.reRelease && !(plan as any).next_release_date) {
        patch.next_release_date = addDaysIso(saoPauloUsageDate(), 1);
      }

      const { error: planErr } = await supabaseAdmin
        .from("blast_plans")
        .update(patch)
        .eq("id", plan_id);
      if (planErr) throw new Error(`update blast_plans failed: ${planErr.message}`);

      await logRuntime({
        organizationId: orgId,
        module: "campaign",
        action,
        status: "success",
        entityType: "blast_plans",
        entityId: plan_id,
        payloadSnapshot: { from: (plan as any).status, to: decision.next },
      });

      return jsonResponse(200, { ok: true, status: decision.next }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "unknown error";
      await logRuntime({
        organizationId: orgId,
        module: "campaign",
        action,
        status: "error",
        entityType: "blast_plans",
        entityId: plan_id,
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  }),
);
