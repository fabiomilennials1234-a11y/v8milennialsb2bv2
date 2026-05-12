// deno-lint-ignore-file no-explicit-any
/**
 * mass-send-control — pause/resume/stop action sobre um uazapi_sender_jobs.
 *
 * Auth: Bearer JWT user (admin/master). Tenant check obrigatório.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";

// Force bundler to include provider modules (used via dynamic import in whatsapp-client)
import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withSentry("mass-send-control", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const corsHeaders = withSecurityHeaders(
      getCorsHeaders(origin) as Record<string, string>
    );
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, corsHeaders);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse(401, { error: "Missing auth" }, corsHeaders);

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(authHeader.slice(7));
    if (userErr || !userData?.user) return jsonResponse(401, { error: "Invalid token" }, corsHeaders);

    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("organization_id, role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!member?.organization_id) return jsonResponse(403, { error: "No organization" }, corsHeaders);
    if (!["admin", "master"].includes(member.role as string)) {
      return jsonResponse(403, { error: "Admin role required" }, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const { job_id, action } = body as { job_id?: string; action?: "pause" | "resume" | "stop" };
    if (!job_id || !action || !["pause", "resume", "stop"].includes(action)) {
      return jsonResponse(400, { error: "Missing job_id or invalid action" }, corsHeaders);
    }

    const { data: job } = await supabaseAdmin
      .from("uazapi_sender_jobs")
      .select("*, whatsapp_instances(*)")
      .eq("id", job_id)
      .maybeSingle();
    if (!job) return jsonResponse(404, { error: "Job not found" }, corsHeaders);
    if ((job as any).organization_id !== member.organization_id) {
      return jsonResponse(403, { error: "Forbidden" }, corsHeaders);
    }

    const instance = (job as any).whatsapp_instances;
    if (!instance) return jsonResponse(404, { error: "Instance not found" }, corsHeaders);

    try {
      const provider = await getWhatsAppProvider(instance, supabaseAdmin);
      const senderId = (job as any).uazapi_sender_id;
      if (!senderId) return jsonResponse(400, { error: "Missing uazapi_sender_id" }, corsHeaders);

      const impl = (provider as any)[
        action === "pause" ? "senderPause" : action === "resume" ? "senderResume" : "senderStop"
      ] as undefined | ((id: string) => Promise<void>);
      if (!impl) return jsonResponse(500, { error: `provider does not support ${action}` }, corsHeaders);

      await impl.call(provider, senderId);

      const newStatus = action === "pause" ? "paused" : action === "resume" ? "running" : "cancelled";
      await supabaseAdmin
        .from("uazapi_sender_jobs")
        .update({ status: newStatus })
        .eq("id", job_id);

      await logRuntime({
        organizationId: member.organization_id,
        module: "mass-send-control",
        action,
        status: "success",
        entityType: "uazapi_sender_jobs",
        entityId: job_id,
      });
      return jsonResponse(200, { ok: true, status: newStatus }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "unknown";
      await logRuntime({
        organizationId: member.organization_id,
        module: "mass-send-control",
        action,
        status: "error",
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  })
);
