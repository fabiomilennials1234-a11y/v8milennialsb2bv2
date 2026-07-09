// deno-lint-ignore-file no-explicit-any
/**
 * mass-send-status — poll/refresh status de um uazapi_sender_jobs row.
 *
 * Invocado por:
 *  - UI via JWT (usuário quer ver status atual)
 *  - cron process-mass-send-status (1min, all running jobs)
 *
 * Auth: Bearer JWT user (role=admin/master) OU x-cron-secret.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

// Force bundler to include provider modules (used via dynamic import in whatsapp-client)
import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function refreshJob(
  supabaseAdmin: ReturnType<typeof createClient>,
  jobId: string
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const { data: job } = await supabaseAdmin
    .from("uazapi_sender_jobs")
    .select("*, whatsapp_instances(*)")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) return { ok: false, error: "Job not found" };
  if (!(job as any).uazapi_sender_id) return { ok: false, error: "Missing uazapi_sender_id" };

  const instance = (job as any).whatsapp_instances;
  if (!instance) return { ok: false, error: "Instance not found" };

  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    const impl = (provider as any).senderGet as
      | undefined
      | ((id: string) => Promise<{ status: string; sent: number; failed: number; total: number }>);
    if (!impl) return { ok: false, error: "provider does not expose senderGet" };

    const res = await impl.call(provider, (job as any).uazapi_sender_id);
    await supabaseAdmin
      .from("uazapi_sender_jobs")
      .update({
        status: res.status,
        sent: res.sent ?? 0,
        failed: res.failed ?? 0,
        total_messages: res.total ?? (job as any).total_messages,
      })
      .eq("id", jobId);

    return { ok: true, status: res.status };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await supabaseAdmin
      .from("uazapi_sender_jobs")
      .update({ status: "failed" })
      .eq("id", jobId);
    return { ok: false, error: msg };
  }
}

Deno.serve(
  withErrorBoundary("mass-send-status", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const corsHeaders = withSecurityHeaders(
      getCorsHeaders(origin) as Record<string, string>
    );
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, corsHeaders);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Auth: cron secret bypass OR JWT user
    const cronSecret = req.headers.get("x-cron-secret");
    let isCron = false;
    if (!!CRON_SECRET && !!cronSecret && timingSafeCompare(cronSecret, CRON_SECRET)) {
      isCron = true;
    }

    const body = await req.json().catch(() => ({}));
    const { job_id, all_running } = body as { job_id?: string; all_running?: boolean };

    if (isCron && all_running) {
      // Refresh all running jobs (cron use case)
      const { data: runningJobs } = await supabaseAdmin
        .from("uazapi_sender_jobs")
        .select("id")
        .in("status", ["queued", "running"])
        .limit(50);
      const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];
      for (const j of runningJobs ?? []) {
        const r = await refreshJob(supabaseAdmin, (j as any).id);
        results.push({ id: (j as any).id, ...r });
      }
      await logRuntime({
        module: "mass-send-status",
        action: "cron_refresh",
        status: "success",
        payloadSnapshot: { count: results.length },
      });
      return jsonResponse(200, { ok: true, results }, corsHeaders);
    }

    // User path requires JWT + job_id + tenant check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Missing auth" }, corsHeaders);
    }
    const userJwt = authHeader.slice(7);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(userJwt);
    if (userErr || !userData?.user) return jsonResponse(401, { error: "Invalid token" }, corsHeaders);

    if (!job_id) return jsonResponse(400, { error: "Missing job_id" }, corsHeaders);

    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("organization_id, role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!member?.organization_id) return jsonResponse(403, { error: "No organization" }, corsHeaders);

    const { data: job } = await supabaseAdmin
      .from("uazapi_sender_jobs")
      .select("organization_id")
      .eq("id", job_id)
      .maybeSingle();
    if (!job) return jsonResponse(404, { error: "Job not found" }, corsHeaders);
    if ((job as any).organization_id !== member.organization_id) {
      return jsonResponse(403, { error: "Forbidden" }, corsHeaders);
    }

    const r = await refreshJob(supabaseAdmin, job_id);
    return jsonResponse(r.ok ? 200 : 500, r, corsHeaders);
  })
);
