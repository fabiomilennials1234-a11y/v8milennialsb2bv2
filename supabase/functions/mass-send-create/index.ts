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
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  decideDispatchRoute,
  runUazapiSenderJob,
} from "../_shared/dispatch-router.ts";
import { assertPermission, permissionDeniedResponse } from "../_shared/assert-permission.ts";

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
  withSentry("mass-send-create", async (req: Request) => {
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
        module: "mass-send-create",
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

    // Normalize recipients with template_text if provided. Every item MUST
    // carry a `type` — Uazapi silently rejects (count=0) any item without one.
    // Infer "image" when a file is present, otherwise "text".
    const msgs = recipients.map((r) => {
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

    try {
      const { sender_job_id, uazapi_sender_id } = await runUazapiSenderJob(
        supabaseAdmin,
        instance as any,
        {
          recipients: msgs,
          delayMin: delay_min_ms,
          delayMax: delay_max_ms,
          scheduledFor: scheduled_for,
          campaignId: campaign_id ?? null,
          triggeredByUserId: user.id,
          triggeredVia: "ui",
          trackSource: "mass-send-create",
        }
      );

      await logRuntime({
        organizationId: orgId,
        module: "mass-send-create",
        action: "created",
        status: "success",
        entityType: "uazapi_sender_jobs",
        entityId: sender_job_id,
        payloadSnapshot: { count: recipients.length },
      });

      return jsonResponse(
        200,
        { ok: true, sender_job_id, uazapi_sender_id },
        corsHeaders
      );
    } catch (e) {
      const msg = (e as Error).message ?? "unknown error";
      await logRuntime({
        organizationId: orgId,
        module: "mass-send-create",
        action: "failed",
        status: "error",
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  })
);
