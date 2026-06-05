// deno-lint-ignore-file no-explicit-any
/**
 * quick-blast-create — fire a Quick Blast (Disparo Rápido) from a kanban/list
 * lead selection. A Quick Blast IS a Mass Send (ADR-0002): it reuses the Mass
 * Send dispatch core (runUazapiSenderJob → Uazapi /sender/advanced) but carries
 * its own access policy.
 *
 * Access policy (ADR-0002): NO role gate. Any authenticated member of an org
 * may fire, scoped to their own organization. The org-level lead cap
 * (organizations.quick_blast_max_leads, default 200, fail-closed) is the sole
 * safety guardrail. This is a deliberate, dedicated path — it does NOT relax
 * the admin-only mass-send-create gate.
 *
 * Tenant validation (instance.organization_id === orgId) is enforced in
 * runQuickBlast. Quick Blast always uses the batch sender directly (it bypasses
 * decideDispatchRoute, whose <threshold path would reject small sends).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { runUazapiSenderJob } from "../_shared/dispatch-router.ts";
import { runQuickBlast } from "./run.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withSentry("quick-blast-create", async (req: Request) => {
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

    // Resolve caller org — NO role gate (ADR-0002). Any member may fire.
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
      max_leads,
      scheduled_for,
      image_url,
      exclude_blasted_within_days,
      only_non_responders,
    } = body as {
      instance_id?: string;
      lead_ids?: string[];
      message?: string;
      delay_min_ms?: number;
      delay_max_ms?: number;
      max_leads?: number;
      scheduled_for?: string;
      image_url?: string;
      exclude_blasted_within_days?: number;
      only_non_responders?: boolean;
    };

    // Blast Audience refinements (#704). Recency window must be a positive
    // integer to engage; anything else leaves the refinement off (fail-safe).
    const refinements = {
      excludeBlastedWithinDays:
        typeof exclude_blasted_within_days === "number" && exclude_blasted_within_days > 0
          ? Math.floor(exclude_blasted_within_days)
          : undefined,
      onlyNonResponders: only_non_responders === true,
    };

    if (!instance_id || !Array.isArray(lead_ids) || lead_ids.length === 0 || !message) {
      return jsonResponse(400, { error: "Missing instance_id, lead_ids or message" }, corsHeaders);
    }

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instance_id)
      .maybeSingle();
    if (!instance) {
      return jsonResponse(404, { error: "Instance not found" }, corsHeaders);
    }

    try {
      const result = await runQuickBlast(
        {
          supabaseAdmin,
          dispatch: (inst, input) =>
            runUazapiSenderJob(supabaseAdmin, inst as any, {
              ...input,
              triggeredVia: "ui",
              trackSource: "quick-blast",
            }),
        },
        {
          orgId,
          userId: user.id,
          instance: instance as any,
          leadIds: lead_ids,
          message,
          delayMinMs: delay_min_ms,
          delayMaxMs: delay_max_ms,
          maxLeads: max_leads,
          scheduledFor: scheduled_for,
          imageUrl: image_url,
          refinements,
        },
      );

      if (!result.ok) {
        return jsonResponse(400, { error: result.error ?? "blast_failed", skipped: result.skipped }, corsHeaders);
      }

      await logRuntime({
        organizationId: orgId,
        module: "quick-blast-create",
        action: "created",
        status: "success",
        entityType: "uazapi_sender_jobs",
        entityId: result.sender_job_id,
        payloadSnapshot: { count: result.count, skipped: result.skipped },
      });

      return jsonResponse(200, {
        ok: true,
        sender_job_id: result.sender_job_id,
        uazapi_sender_id: result.uazapi_sender_id,
        count: result.count,
        skipped: result.skipped,
      }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "unknown error";
      await logRuntime({
        organizationId: orgId,
        module: "quick-blast-create",
        action: "failed",
        status: "error",
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  }),
);
