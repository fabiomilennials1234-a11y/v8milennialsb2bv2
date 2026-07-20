// deno-lint-ignore-file no-explicit-any
/**
 * mass-send-create — cria job de envio em massa via Uazapi /sender/advanced.
 *
 * Auth: JWT user (valida membership admin/master no org alvo).
 * Delega policy ao dispatch-router.decideDispatchRoute pra respeitar
 * threshold + non-chained actions + non-dynamic audio.
 * Persiste row em uazapi_sender_jobs.
 *
 * Etapa B (vínculo user-instância de escrita) — EXCEÇÃO ARQUITETURAL:
 * Mass-send é um broadcast 1-instância → N-recipients. Admin/master escolhe
 * uma única instância no UI e dispara em lote. NÃO chama
 * resolveLeadWriteInstance — vínculo user-instância é enforced em fluxos 1:1
 * (outbound copilot, followup, pipe rules, workflow actions, scheduled msgs).
 * Validação de tenant (instance.organization_id === orgId) já é feita abaixo.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  decideDispatchRoute,
  runUazapiSenderJob,
} from "../_shared/dispatch-router.ts";
import { assertPermission, permissionDeniedResponse } from "../_shared/assert-permission.ts";
import { assertPlanFeature, PlanFeatureDeniedError, planDeniedResponse } from "../_shared/plan-gate.ts";
import {
  resolveInstanceCap,
  instanceDailyUsageSource,
} from "../_shared/quick-blast/instance-budget.ts";
import { saoPauloUsageDate } from "../_shared/quick-blast/daily-budget.ts";
import { humanizeBatch } from "../_shared/humanize-batch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = (
  Deno.env.get("ALLOWED_ORIGINS") ?? "https://torquecrm.com.br,http://localhost:8080"
).split(",");

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withErrorBoundary("mass-send-create", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const corsHeaders = withSecurityHeaders(
      (await import("../_shared/cors.ts")).getCorsHeaders(origin) as Record<string, string>
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

    // Resolve caller org + role
    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member?.organization_id) {
      return jsonResponse(403, { error: "No organization" }, corsHeaders);
    }
    if (!["admin", "master"].includes(member.role as string)) {
      return jsonResponse(403, { error: "Admin role required" }, corsHeaders);
    }
    const orgId = member.organization_id;

    // Permission gate — server-side enforcement (#189)
    const permission = await assertPermission(supabaseAdmin, user.id, orgId, "mass_send");
    if (!permission.allowed) {
      return permissionDeniedResponse(permission.reason, corsHeaders);
    }

    // Plan gate — whatsapp_bulk fora do plano → 403 antes de qualquer side-effect
    try {
      await assertPlanFeature(supabaseAdmin, orgId, "whatsapp_bulk");
    } catch (e) {
      if (e instanceof PlanFeatureDeniedError) return planDeniedResponse(e, corsHeaders);
      throw e;
    }

    const body = await req.json().catch(() => null);
    if (!body) return jsonResponse(400, { error: "Invalid JSON" }, corsHeaders);

    const {
      instance_id,
      campaign_id,
      recipients, // [{ number, text?, type?, file?, caption? }]
      template_text,
      delay_min_ms,
      delay_max_ms,
      scheduled_for,
    } = body as {
      instance_id?: string;
      campaign_id?: string;
      recipients?: Array<{
        number: string;
        text?: string;
        type?: string;
        file?: string;
        caption?: string;
      }>;
      template_text?: string;
      delay_min_ms?: number;
      delay_max_ms?: number;
      scheduled_for?: string;
    };

    if (!instance_id || !Array.isArray(recipients) || recipients.length === 0) {
      return jsonResponse(400, { error: "Missing instance_id or recipients" }, corsHeaders);
    }

    // Tenant check
    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instance_id)
      .maybeSingle();
    if (!instance) return jsonResponse(404, { error: "Instance not found" }, corsHeaders);
    if ((instance as any).organization_id !== orgId) {
      await logRuntime({
        organizationId: orgId,
        module: "campaign",
        action: "cross_tenant_attempt",
        status: "error",
        payloadSnapshot: { caller: orgId, target: (instance as any).organization_id },
      });
      return jsonResponse(403, { error: "Forbidden" }, corsHeaders);
    }

    const decision = decideDispatchRoute(
      {
        recipients: recipients.length,
        isStaticTemplate: !!template_text,
        hasChainedActions: false,
        hasDynamicAudio: false,
      },
      (instance as any).provider ?? "uazapi"
    );

    if (decision.route !== "uazapi_sender") {
      return jsonResponse(
        400,
        {
          error: "mass send not eligible for server-side /sender/*",
          reason: decision.reason,
          suggested_route: decision.route,
        },
        corsHeaders
      );
    }

    // Drop recipients whose number can't be a real phone. A lead with a blank /
    // whitespace / non-numeric phone arrives here as "55" (or fewer digits); Uazapi
    // rejects each such item ("could not parse phone number: 55") and, when the WHOLE
    // batch is invalid, the job creation itself 500s → the UI shows the opaque
    // "Edge Function returned a non-2xx status code". Floor = 10 digits (shortest BR
    // number, DDD + 8). Skipped count is surfaced so the caller can warn the user.
    const eligible = recipients.filter(
      (r) => String(r.number ?? "").replace(/\D/g, "").length >= 10,
    );
    const skippedInvalid = recipients.length - eligible.length;

    if (eligible.length === 0) {
      return jsonResponse(
        400,
        { error: "Nenhum destinatário com telefone válido", skipped: skippedInvalid },
        corsHeaders,
      );
    }

    // Normalize recipients with template_text if provided. Every item MUST
    // carry a `type` — Uazapi silently rejects (count=0) any item without one.
    // Infer "image" when a file is present, otherwise "text".
    const msgs = eligible.map((r) => {
      const type: "text" | "image" =
        r.type === "image" || (r.type == null && r.file) ? "image" : "text";
      return {
        number: r.number,
        type,
        text: r.text ?? template_text,
        file: r.file,
        caption: r.caption,
      };
    });

    // Per-number Daily Cap (ADR-0015): trim the batch to the number's remaining
    // headroom in the SAME ledger the Quick Blast / Blast Plan paths consume
    // (blast_instance_daily_usage). Fail-closed — a ledger read error resolves
    // the headroom to 0 and blocks; protecting the number outranks one more send.
    const instanceCap = resolveInstanceCap((instance as any).daily_blast_cap);
    const instanceUsage = instanceDailyUsageSource(supabaseAdmin);
    // Ledger keys off the day the messages LEAVE the chip: a batch scheduled
    // for tomorrow checks/consumes tomorrow's headroom, not today's (otherwise
    // the scheduled batch + the send-day's organic blasts stack to 2x the cap).
    const scheduledMs = scheduled_for ? Date.parse(scheduled_for) : NaN;
    const usageDate = saoPauloUsageDate(
      Number.isNaN(scheduledMs) ? new Date() : new Date(scheduledMs)
    );
    const usedToday = await instanceUsage.getUsedToday(instance_id, usageDate, instanceCap);
    const headroom = Math.max(0, instanceCap - usedToday);
    if (headroom <= 0) {
      return jsonResponse(
        429,
        { error: "instance_daily_cap_exhausted", cap: instanceCap, used_today: usedToday },
        corsHeaders
      );
    }
    const acceptedMsgs = msgs.slice(0, headroom);
    const trimmedCount = msgs.length - acceptedMsgs.length;

    // Humanizer (anti-ban Onda 0 QW6): per-recipient rewrite kills the
    // byte-identical fan-out. Fail-open + time-boxed by contract — a humanizer
    // outage or a huge batch degrades the variation, never the send. The
    // rewritten array is the frozen variant set that ships to /sender.
    const humanizedMsgs = await humanizeBatch(acceptedMsgs);

    try {
      const { sender_job_id, uazapi_sender_id } = await runUazapiSenderJob(
        supabaseAdmin,
        instance as any,
        {
          recipients: humanizedMsgs,
          delayMin: delay_min_ms,
          delayMax: delay_max_ms,
          scheduledFor: scheduled_for,
          campaignId: campaign_id ?? null,
          triggeredByUserId: user.id,
          triggeredVia: "ui",
          trackSource: "mass-send-create",
        }
      );

      // Consume the per-number ledger by the ENQUEUED batch size — the /sender
      // queue accepted the whole lot server-side. Best-effort: the batch
      // already left for the provider.
      try {
        await instanceUsage.increment(instance_id, usageDate, acceptedMsgs.length);
      } catch {
        // ledger increment is best-effort; the job is already queued at Uazapi
      }

      await logRuntime({
        organizationId: orgId,
        module: "campaign",
        action: "created",
        status: "success",
        entityType: "uazapi_sender_jobs",
        entityId: sender_job_id,
        payloadSnapshot: {
          count: acceptedMsgs.length,
          trimmed_over_instance_cap: trimmedCount,
          skipped_invalid_number: skippedInvalid,
        },
      });

      return jsonResponse(
        200,
        {
          ok: true,
          sender_job_id,
          uazapi_sender_id,
          accepted_count: acceptedMsgs.length,
          trimmed_count: trimmedCount,
          skipped_invalid: skippedInvalid,
        },
        corsHeaders
      );
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
  })
);
