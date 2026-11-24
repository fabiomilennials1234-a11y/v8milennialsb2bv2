/**
 * contact-avatar-sync — baixa e grava a foto de perfil do contato WhatsApp
 * (Uazapi) no bucket privado `contact-avatars`.
 *
 * Disparo: pg_cron → public.invoke_contact_avatar_sync() → net.http_post
 * (migration 20280128000100). Auth: x-cron-secret, comparação em tempo
 * constante (`requireCronAuth`). verify_jwt = false no config.toml.
 * A rodada mora em ./sync.ts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireCronAuth } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { UazapiClient } from "../_shared/uazapi-client.ts";
import { runContactAvatarSync, supabaseAvatarStore, type SupabaseLike } from "./sync.ts";

Deno.serve(
  withErrorBoundary("contact-avatar-sync", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders({ ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }
    if (!requireCronAuth(req).authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";
    if (!SUPABASE_URL || !SERVICE_ROLE || !UAZAPI_BASE_URL) {
      return new Response(JSON.stringify({ error: "not_configured" }), { status: 500, headers });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const report = await runContactAvatarSync({
      store: supabaseAvatarStore(supabase as unknown as SupabaseLike),
      detailsClient: (token, instanceId) => new UazapiClient({ baseUrl: UAZAPI_BASE_URL, token, instanceId }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      random: () => Math.random(),
      log: (action, payloadSnapshot, status = "success") => {
        void logRuntime({ module: "media", action, status, payloadSnapshot });
      },
    });

    void logRuntime({
      module: "media",
      action: "contact_avatar_sync_run",
      status: "success",
      payloadSnapshot: { ...report },
    });
    return new Response(JSON.stringify({ ok: true, ...report }), { status: 200, headers });
  }),
);
