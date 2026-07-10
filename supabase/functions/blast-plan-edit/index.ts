// deno-lint-ignore-file no-explicit-any
/**
 * blast-plan-edit — edit a live Blast Plan's message / release time (ADR-0003, #911).
 *
 * The AUDIENCE of a Blast Plan is immutable (frozen at creation — ADR-0003), but
 * its message template and daily release time are still editable while the plan
 * runs: future lots read `blast_plans.message` at release, so an edit reaches
 * every not-yet-sent recipient (already-sent ones are untouched).
 *
 * blast_plans writes are service_role-only (RLS: members SELECT, no write grant),
 * so this is the authenticated edit plane — same access policy as
 * blast-plan-control (ADR-0002): NO role gate; any authenticated org member who
 * can fire a blast may edit THEIR org's plans. The tenant guard
 * (plan.organization_id === callerOrg) is the boundary; a plan in another org is
 * reported as 404 (existence not leaked). Terminal plans (completed/cancelled)
 * reject edits.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** HH:MM (24h) — the daily releaser's time-of-day. */
function isValidReleaseTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

Deno.serve(
  withErrorBoundary("blast-plan-edit", async (req: Request) => {
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

    // Resolve caller org — NO role gate (ADR-0002), same gate as control/create.
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

    const { plan_id, message, release_time } = body as {
      plan_id?: string;
      message?: string;
      release_time?: string;
    };
    if (!plan_id || typeof plan_id !== "string") {
      return jsonResponse(400, { error: "Missing plan_id" }, corsHeaders);
    }

    // Build the validated patch. At least one editable field must be present.
    const patch: Record<string, unknown> = {};
    if (message !== undefined) {
      if (typeof message !== "string" || message.trim().length === 0) {
        return jsonResponse(400, { error: "Invalid message" }, corsHeaders);
      }
      patch.message = message.trim();
    }
    if (release_time !== undefined) {
      if (typeof release_time !== "string" || !isValidReleaseTime(release_time)) {
        return jsonResponse(400, { error: "Invalid release_time" }, corsHeaders);
      }
      patch.release_time = release_time;
    }
    if (Object.keys(patch).length === 0) {
      return jsonResponse(400, { error: "Nothing to update" }, corsHeaders);
    }

    // Load + tenant-guard via service_role. Out-of-org → 404 (no existence leak).
    const { data: plan } = await supabaseAdmin
      .from("blast_plans")
      .select("id, organization_id, status")
      .eq("id", plan_id)
      .maybeSingle();
    if (!plan) return jsonResponse(404, { error: "Plan not found" }, corsHeaders);
    if ((plan as any).organization_id !== orgId) {
      return jsonResponse(404, { error: "Plan not found" }, corsHeaders);
    }
    const status = (plan as any).status as string;
    if (status !== "active" && status !== "paused") {
      return jsonResponse(409, { error: `cannot_edit_${status}` }, corsHeaders);
    }

    try {
      const { error: updErr } = await supabaseAdmin
        .from("blast_plans")
        .update(patch)
        .eq("id", plan_id);
      if (updErr) throw new Error(`update blast_plans failed: ${updErr.message}`);

      await logRuntime({
        organizationId: orgId,
        module: "blast-plan-edit",
        action: "edit",
        status: "success",
        entityType: "blast_plans",
        entityId: plan_id,
        payloadSnapshot: { fields: Object.keys(patch) },
      });

      return jsonResponse(200, { ok: true }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "unknown error";
      await logRuntime({
        organizationId: orgId,
        module: "blast-plan-edit",
        action: "edit",
        status: "error",
        entityType: "blast_plans",
        entityId: plan_id,
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  }),
);
