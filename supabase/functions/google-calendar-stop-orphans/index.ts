/**
 * google-calendar-stop-orphans
 *
 * Para no Google os watch channels que o banco já desativou mas que ainda
 * estão vivos lá (ver _shared/google-watch-orphans.ts e o incidente de
 * 2026-11-18). Operacional: chamado por cron/ops com x-cron-secret.
 *
 * Método: POST   Body opcional: { "limit": number (padrão e teto 999 — max_rows),
 *                                 "includeDisconnected": boolean (tenta o refresh
 *                                 token de quem desconectou, só para o stop) }
 * Resposta: { found, stopped, alreadyGone, failed, usersWithoutToken, unreachable, remaining }
 * `remaining: true` → chamar de novo.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireCronAuth } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  decryptToken,
  getValidAccessToken,
  refreshAccessToken,
  stopGoogleChannel,
} from "../_shared/google-calendar-utils.ts";
import { MAX_BATCH, stopOrphanWatchChannels } from "../_shared/google-watch-orphans.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withErrorBoundary("google-calendar-stop-orphans", async (req) => {
  const headers = withSecurityHeaders({ "Content-Type": "application/json" });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!requireCronAuth(req).authorized) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as { limit?: unknown; includeDisconnected?: unknown };
  const includeDisconnected = body.includeDisconnected === true;
  const limit = Number.isInteger(body.limit) && (body.limit as number) > 0
    ? Math.min(body.limit as number, MAX_BATCH)
    : MAX_BATCH;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Dono desconectado: o refresh token gravado só é usado para PARAR canais
  // (reduz acesso, nunca amplia) e nada é escrito no registro do token.
  const disconnectedToken = async (userId: string): Promise<string | null> => {
    const { data } = await supabase
      .from("google_calendar_tokens")
      .select("encrypted_refresh_token, encryption_nonce")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data?.encrypted_refresh_token) return null;
    try {
      const rt = await decryptToken(data.encrypted_refresh_token, data.encryption_nonce);
      return (await refreshAccessToken(rt)).access_token;
    } catch (err) {
      console.warn("[google-calendar-stop-orphans] token do dono desconectado inutilizável:", userId, String(err));
      return null;
    }
  };

  const result = await stopOrphanWatchChannels(supabase, {
    getAccessToken: async (userId) =>
      (await getValidAccessToken(userId, supabase))?.accessToken ??
      (includeDisconnected ? await disconnectedToken(userId) : null),
    stopChannel: stopGoogleChannel,
    includeDisconnected,
  }, limit);

  await logRuntime({
    module: "calendar",
    action: "stop_orphan_channels",
    status: result.failed > 0 ? "error" : "success",
    payloadSnapshot: { ...result, limit, includeDisconnected },
  });

  return json(result);
}));
