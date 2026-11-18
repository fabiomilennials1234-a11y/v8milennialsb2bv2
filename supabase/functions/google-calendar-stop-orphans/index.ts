/**
 * google-calendar-stop-orphans
 *
 * Para no Google os watch channels que o banco já desativou mas que ainda
 * estão vivos lá (ver _shared/google-watch-orphans.ts e o incidente de
 * 2026-11-18). Operacional: chamado por cron/ops com x-cron-secret.
 *
 * Método: POST   Body opcional: { "limit": number }  (padrão 1500, teto 3000)
 * Resposta: { found, stopped, alreadyGone, failed, usersWithoutToken, remaining }
 * `remaining: true` → chamar de novo.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireCronAuth } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getValidAccessToken, stopGoogleChannel } from "../_shared/google-calendar-utils.ts";
import { stopOrphanWatchChannels } from "../_shared/google-watch-orphans.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_LIMIT = 3000;

Deno.serve(withErrorBoundary("google-calendar-stop-orphans", async (req) => {
  const headers = withSecurityHeaders({ "Content-Type": "application/json" });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!requireCronAuth(req).authorized) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as { limit?: unknown };
  const limit = Number.isInteger(body.limit) && (body.limit as number) > 0
    ? Math.min(body.limit as number, MAX_LIMIT)
    : 1500;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const result = await stopOrphanWatchChannels(supabase, {
    getAccessToken: async (userId) => (await getValidAccessToken(userId, supabase))?.accessToken ?? null,
    stopChannel: stopGoogleChannel,
  }, limit);

  await logRuntime({
    module: "calendar",
    action: "stop_orphan_channels",
    status: result.failed > 0 ? "error" : "success",
    payloadSnapshot: { ...result, limit },
  });

  return json(result);
}));
