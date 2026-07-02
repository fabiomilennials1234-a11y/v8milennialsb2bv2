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
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { syncFolderFailures } from "../_shared/quick-blast/failure-sync-runner.ts";
import type { FailureSyncRecipient } from "../_shared/quick-blast/failure-sync.ts";

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

/**
 * Per-recipient delivery-failure sync (ADR-0016, #948) — runs after every
 * successful aggregate refresh. The handler only builds the seams; the
 * decision logic lives in syncFolderFailures (unit-tested with fake deps):
 * no provenance / provider without /sender/listmessages → silent skip.
 *
 * Contract: NEVER throws (runner captures errors; this wrapper only logs), so
 * a failure-visibility problem can never break the job refresh the operators
 * and the cron depend on.
 */
async function syncRecipientFailures(
  supabaseAdmin: ReturnType<typeof createClient>,
  provider: unknown,
  job: { id: string; uazapi_sender_id: string | null; payload: unknown; organization_id?: string }
): Promise<void> {
  const listImpl = (provider as any).senderListMessages as
    | undefined
    | ((folderId: string, opts?: { messageStatus?: string }) => Promise<unknown[]>);

  const result = await syncFolderFailures(
    {
      // Only explicit "Failed" rows matter — server-side filter (spike #943).
      listFolderFailedMessages: listImpl
        ? (folderId) => listImpl.call(provider, folderId, { messageStatus: "Failed" })
        : undefined,
      getSentRecipients: async (planId, lotIndex) => {
        // Paginate past PostgREST's 1000-row page. lead_id null (lead deleted,
        // FK SET NULL) is excluded: the core matches transitions by lead_id,
        // so those rows cannot be addressed — they simply stay `sent`.
        const rows: FailureSyncRecipient[] = [];
        const PAGE = 1000;
        for (let page = 0; page < 20; page++) {
          const from = page * PAGE;
          const { data, error } = await supabaseAdmin
            .from("blast_plan_recipients")
            .select("lead_id, phone, status")
            .eq("plan_id", planId)
            .eq("lot_index", lotIndex)
            .eq("status", "sent")
            .not("lead_id", "is", null)
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const batch = (data ?? []) as unknown as FailureSyncRecipient[];
          rows.push(...batch);
          if (batch.length < PAGE) break;
        }
        return rows;
      },
      markFailed: async (t) => {
        // `status = 'sent'` guard: idempotent under concurrent re-polls and
        // never clobbers a terminal state written elsewhere. Only the
        // canonical reason persists — raw provider text is heuristic input,
        // not schema (ADR-0016; there is no raw-text column by design).
        const { error } = await supabaseAdmin
          .from("blast_plan_recipients")
          .update({ status: "failed", reason: t.reason })
          .eq("plan_id", t.plan_id)
          .eq("lot_index", t.lot_index)
          .eq("lead_id", t.lead_id)
          .eq("status", "sent");
        if (error) throw new Error(error.message);
      },
    },
    { uazapi_sender_id: job.uazapi_sender_id, payload: job.payload }
  );

  if (result.error) {
    await logRuntime({
      module: "mass-send-status",
      action: "failure_sync",
      status: "error",
      organizationId: job.organization_id,
      errorMessage: result.error,
      payloadSnapshot: { job_id: job.id, synced: result.synced },
    });
  } else if (result.synced > 0) {
    await logRuntime({
      module: "mass-send-status",
      action: "failure_sync",
      status: "success",
      organizationId: job.organization_id,
      payloadSnapshot: { job_id: job.id, synced: result.synced },
    });
  }
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

    // Per-recipient failure sync (ADR-0016, #948) — after the aggregates, on
    // this same poll tick (cron = 1/min ⇒ a provider-reported failure lands on
    // blast_plan_recipients within the next cycle, including the final poll
    // that completes the job). Belt-and-braces try/catch: the runner already
    // never throws, and even an unexpected error here must not break the
    // refresh contract (200 + aggregates updated).
    try {
      await syncRecipientFailures(supabaseAdmin, provider, {
        id: (job as any).id,
        uazapi_sender_id: (job as any).uazapi_sender_id,
        payload: (job as any).payload,
        organization_id: (job as any).organization_id,
      });
    } catch (syncErr) {
      await logRuntime({
        module: "mass-send-status",
        action: "failure_sync",
        status: "error",
        organizationId: (job as any).organization_id,
        errorMessage: (syncErr as Error).message ?? String(syncErr),
        payloadSnapshot: { job_id: jobId },
      }).catch(() => {});
    }

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
  withSentry("mass-send-status", async (req: Request) => {
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
