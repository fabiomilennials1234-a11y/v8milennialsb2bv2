// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-api-proxy — Edge Function
 *
 * ONLY entry point for the frontend to manage WhatsApp instances.
 * Enforces:
 *  1. Valid JWT authentication (Supabase Auth)
 *  2. Tenant isolation — instance must belong to caller's org
 *  3. Rate limit — 60 req/min per org (in-memory; Phase 2 migrates to KV)
 *  4. Service role token never reaches client
 *  5. Error messages sanitised — no stack traces leaked
 *
 * Phase 1 actions: createInstance, getStatus, connectQR, deleteInstance, logoutInstance
 * Phase 3 adds: sendText, sendMedia (via senders)
 */

import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getWhatsAppProvider,
  type WhatsAppInstance,
} from "../_shared/whatsapp-client.ts";

// ---------------------------------------------------------------------------
// Rate limit state (in-memory, per org)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(orgId: string): boolean {
  const now = Date.now();
  const rl = rateLimitState.get(orgId);
  if (rl && rl.resetAt > now) {
    if (rl.count >= RATE_LIMIT_MAX) return false;
    rl.count += 1;
    return true;
  }
  rateLimitState.set(orgId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  return true;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(
  withSentry("whatsapp-api-proxy", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const corsHeaders = withSecurityHeaders(
      getCorsHeaders(origin) as Record<string, string>
    );

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" }, corsHeaders);
    }

    // -------------------------------------------------------------------------
    // 1. Authenticate — validate JWT via Supabase
    // -------------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Missing auth" }, corsHeaders);
    }
    const userJwt = authHeader.slice(7);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userErr } =
      await supabaseUser.auth.getUser(userJwt);

    if (userErr || !userData?.user) {
      return jsonResponse(401, { error: "Invalid token" }, corsHeaders);
    }
    const user = userData.user;

    // -------------------------------------------------------------------------
    // 2. Parse body (needed before org resolution for master targeting)
    // -------------------------------------------------------------------------
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" }, corsHeaders);
    }

    const action = body?.action;
    if (!action || typeof action !== "string") {
      return jsonResponse(400, { error: "Missing action" }, corsHeaders);
    }

    const instanceId = body?.instance_id as string | undefined;
    const payload = (body?.payload ?? {}) as Record<string, unknown>;
    const targetOrgId = (body?.organization_id ?? payload?.organization_id) as
      | string
      | undefined;

    // -------------------------------------------------------------------------
    // 3. Resolve caller's organization_id with master bypass
    // -------------------------------------------------------------------------
    const { data: masterRow } = await supabaseAdmin
      .from("master_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    const isMaster = !!masterRow;

    let callerOrgId: string;

    if (isMaster) {
      // Master can act on any org. Require explicit target so we never assume.
      if (!targetOrgId) {
        return jsonResponse(
          400,
          { error: "Master must provide organization_id" },
          corsHeaders
        );
      }
      const { data: orgRow } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .eq("id", targetOrgId)
        .maybeSingle();
      if (!orgRow) {
        return jsonResponse(404, { error: "Organization not found" }, corsHeaders);
      }
      callerOrgId = targetOrgId;
    } else {
      const { data: userOrg, error: orgErr } = await supabaseAdmin
        .from("team_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (orgErr || !userOrg?.organization_id) {
        return jsonResponse(403, { error: "No organization" }, corsHeaders);
      }
      callerOrgId = userOrg.organization_id;

      // If a target org was supplied, it must match the user's own org —
      // prevents a regular user from acting on another tenant via the param.
      if (targetOrgId && targetOrgId !== callerOrgId) {
        return jsonResponse(
          403,
          { error: "Cannot target a different organization" },
          corsHeaders
        );
      }
    }

    // -------------------------------------------------------------------------
    // 4. Rate limit (per org)
    // -------------------------------------------------------------------------
    if (!checkRateLimit(callerOrgId)) {
      return jsonResponse(429, { error: "Rate limit exceeded" }, corsHeaders);
    }

    // -------------------------------------------------------------------------
    // 5. Action routing
    // -------------------------------------------------------------------------
    try {
      // -----------------------------------------------------------------------
      // createInstance — does not require existing instance_id
      // -----------------------------------------------------------------------
      if (action === "createInstance") {
        const instanceName = payload.instance_name as string | undefined;
        if (!instanceName) {
          return jsonResponse(
            400,
            { error: "Missing payload.instance_name" },
            corsHeaders
          );
        }

        // Resolve provider: org override > payload > default uazapi
        let targetProvider: "uazapi" | "evolution" = "uazapi";
        try {
          const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("whatsapp_provider_override")
            .eq("id", callerOrgId)
            .maybeSingle();
          const override = (org as any)?.whatsapp_provider_override as
            | "uazapi"
            | "evolution"
            | null;
          if (override === "uazapi" || override === "evolution") {
            targetProvider = override;
          }
        } catch {
          // Fall back to default (uazapi)
        }

        const webhookBaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const webhookSecret = Deno.env.get("UAZAPI_WEBHOOK_SECRET") ?? "";

        // Insert row first to obtain a stable UUID
        const { data: newRow, error: insertErr } = await supabaseAdmin
          .from("whatsapp_instances")
          .insert({
            organization_id: callerOrgId,
            instance_name: instanceName,
            provider: targetProvider,
            status: "connecting",
          })
          .select("*")
          .single();

        if (insertErr || !newRow) {
          throw new Error(
            `Failed to create whatsapp_instances row: ${insertErr?.message}`
          );
        }

        const instance = newRow as WhatsAppInstance;

        // Bootstrap: new instance has no credentials yet — factory skips credential lookup
        const provider = await getWhatsAppProvider(instance, supabaseAdmin, { bootstrap: true });

        let result;
        try {
          result = await provider.createInstance({
            instance_id: instance.id,
            organization_id: callerOrgId,
            instance_name: instanceName,
            webhook_url: `${webhookBaseUrl}/functions/v1/whatsapp-webhook`,
            webhook_secret: webhookSecret,
          });
        } catch (initErr) {
          // Roll back the placeholder row so the unique
          // (organization_id, instance_name) constraint does not block retries.
          await supabaseAdmin
            .from("whatsapp_instances")
            .delete()
            .eq("id", instance.id);
          throw initErr;
        }

        // Update status from provider response
        await supabaseAdmin
          .from("whatsapp_instances")
          .update({ status: result.status.connected ? "connected" : "connecting" })
          .eq("id", instance.id);

        await logRuntime({
          organizationId: callerOrgId,
          module: "whatsapp-api-proxy",
          action: "createInstance",
          status: "success",
          entityType: "whatsapp_instances",
          entityId: instance.id,
        });

        return jsonResponse(200, { ok: true, result, instance_id: instance.id }, corsHeaders);
      }

      // -----------------------------------------------------------------------
      // All other actions require instance_id + tenant check
      // -----------------------------------------------------------------------
      if (!instanceId) {
        return jsonResponse(400, { error: "Missing instance_id" }, corsHeaders);
      }

      const { data: instance, error: instErr } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("*")
        .eq("id", instanceId)
        .maybeSingle();

      if (instErr || !instance) {
        return jsonResponse(404, { error: "Instance not found" }, corsHeaders);
      }

      // CRITICAL: tenant boundary check
      if ((instance as WhatsAppInstance).organization_id !== callerOrgId) {
        await logRuntime({
          organizationId: callerOrgId,
          module: "whatsapp-api-proxy",
          action: "cross_tenant_attempt",
          status: "error",
          payloadSnapshot: {
            caller_org: callerOrgId,
            instance_org: (instance as WhatsAppInstance).organization_id,
            user_id: user.id,
            action,
            instance_id: instanceId,
          },
        });
        return jsonResponse(403, { error: "Forbidden" }, corsHeaders);
      }

      const provider = await getWhatsAppProvider(
        instance as WhatsAppInstance,
        supabaseAdmin
      );

      let result: unknown;

      switch (action) {
        case "getStatus": {
          result = await provider.getStatus();
          break;
        }

        case "connectQR": {
          const phone = payload.phone as string | undefined;
          result = await provider.connectQR(phone);
          break;
        }

        case "deleteInstance": {
          await provider.deleteInstance();
          // Cascade handles whatsapp_instance_secrets
          await supabaseAdmin
            .from("whatsapp_instances")
            .delete()
            .eq("id", instanceId);

          await logRuntime({
            organizationId: callerOrgId,
            module: "whatsapp-api-proxy",
            action: "deleteInstance",
            status: "success",
            entityType: "whatsapp_instances",
            entityId: instanceId,
          });

          return jsonResponse(200, { ok: true }, corsHeaders);
        }

        case "logoutInstance": {
          await provider.logoutInstance();
          // Update local status
          await supabaseAdmin
            .from("whatsapp_instances")
            .update({ status: "disconnected" })
            .eq("id", instanceId);
          result = { loggedOut: true };
          break;
        }

        // -------------------------------------------------------------------
        // Direct send actions — routed through adapter
        // -------------------------------------------------------------------
        case "sendText": {
          const { number, text, delay, replyid } = payload as {
            number?: string;
            text?: string;
            delay?: number;
            replyid?: string;
          };
          if (!number || !text) {
            return jsonResponse(400, { error: "Missing number/text" }, corsHeaders);
          }
          result = await provider.sendText({
            number,
            text,
            delay,
            replyid,
            trackSource: "whatsapp-api-proxy",
          });
          break;
        }

        case "sendMedia": {
          const { number, type, file, filename, caption, delay } = payload as {
            number?: string;
            type?: "image" | "video" | "document" | "audio" | "ptt" | "sticker";
            file?: string;
            filename?: string;
            caption?: string;
            delay?: number;
          };
          if (!number || !type || !file) {
            return jsonResponse(400, { error: "Missing number/type/file" }, corsHeaders);
          }
          result = await provider.sendMedia({
            number,
            type,
            file,
            filename,
            caption,
            delay,
            trackSource: "whatsapp-api-proxy",
          });
          break;
        }

        case "sendAudio": {
          const { number, file, delay } = payload as {
            number?: string;
            file?: string;
            delay?: number;
          };
          if (!number || !file) {
            return jsonResponse(400, { error: "Missing number/file" }, corsHeaders);
          }
          result = await provider.sendMedia({
            number,
            type: "ptt",
            file,
            delay,
            trackSource: "whatsapp-api-proxy",
          });
          break;
        }

        // -------------------------------------------------------------------
        // Message actions — Uazapi-only.
        // -------------------------------------------------------------------
        case "react": {
          if (!provider.react) throw new Error("Provider does not support react");
          const { message_id, number, emoji } = payload as {
            message_id?: string;
            number?: string;
            emoji?: string;
          };
          if (!message_id || !number || !emoji) {
            return jsonResponse(400, { error: "Missing message_id/number/emoji" }, corsHeaders);
          }
          await provider.react(message_id, number, emoji);
          result = { ok: true };
          break;
        }

        case "editMessage": {
          if (!provider.edit) throw new Error("Provider does not support edit");
          const { message_id, number, text } = payload as {
            message_id?: string;
            number?: string;
            text?: string;
          };
          if (!message_id || !number || !text) {
            return jsonResponse(400, { error: "Missing message_id/number/text" }, corsHeaders);
          }
          await provider.edit(message_id, number, text);
          // Reflect locally
          await supabaseAdmin
            .from("whatsapp_messages")
            .update({ content: text })
            .eq("message_id", message_id)
            .eq("instance_id", instanceId);
          result = { ok: true };
          break;
        }

        case "pinMessage": {
          if (!provider.pin) throw new Error("Provider does not support pin");
          const { message_id, number } = payload as {
            message_id?: string;
            number?: string;
          };
          if (!message_id || !number) {
            return jsonResponse(400, { error: "Missing message_id/number" }, corsHeaders);
          }
          await provider.pin(message_id, number);
          result = { ok: true };
          break;
        }

        case "deleteMessage": {
          if (!provider.deleteForAll) throw new Error("Provider does not support deleteForAll");
          const { message_id, number } = payload as {
            message_id?: string;
            number?: string;
          };
          if (!message_id || !number) {
            return jsonResponse(400, { error: "Missing message_id/number" }, corsHeaders);
          }
          await provider.deleteForAll(message_id, number);
          // Reflect locally
          await supabaseAdmin
            .from("whatsapp_messages")
            .update({ status: "deleted" })
            .eq("message_id", message_id)
            .eq("instance_id", instanceId);
          result = { ok: true };
          break;
        }

        case "markRead": {
          if (!provider.markRead) throw new Error("Provider does not support markRead");
          const { message_id, number } = payload as {
            message_id?: string;
            number?: string;
          };
          if (!message_id || !number) {
            return jsonResponse(400, { error: "Missing message_id/number" }, corsHeaders);
          }
          await provider.markRead(message_id, number);
          result = { ok: true };
          break;
        }

        default:
          return jsonResponse(
            400,
            { error: `Unknown action: ${action}` },
            corsHeaders
          );
      }

      return jsonResponse(200, { ok: true, result }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "Internal error";

      await logRuntime({
        organizationId: callerOrgId,
        module: "whatsapp-api-proxy",
        action,
        status: "error",
        errorMessage: msg,
        entityType: instanceId ? "whatsapp_instances" : undefined,
        entityId: instanceId,
      });

      // Never leak stack trace to client
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  })
);
