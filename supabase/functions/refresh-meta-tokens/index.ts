/**
 * refresh-meta-tokens
 *
 * Cron job diario que renova tokens Meta proximos de expirar.
 * Tokens com menos de 7 dias para expirar sao renovados automaticamente.
 *
 * Schedule: Daily at 2:00 AM (via Supabase cron)
 * SQL: SELECT cron.schedule('refresh-meta-tokens', '0 2 * * *', $$...$$);
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { refreshLongLivedToken } from "../_shared/meta-api.ts";
import { withSentry } from '../_shared/sentry.ts';
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry('refresh-meta-tokens', async (req) => {
  // Cron secret is mandatory — reject if env var missing or mismatch
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  const expectedSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!expectedSecret || !cronSecret || !timingSafeCompare(cronSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401, headers: withSecurityHeaders({}) });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log("[refresh-meta-tokens] Starting token refresh job...");

  // Buscar conexoes com tokens que expiram em menos de 7 dias
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: connections, error } = await supabase
    .from("meta_connections")
    .select("id, access_token, token_expires_at, facebook_user_name")
    .eq("status", "connected")
    .lt("token_expires_at", sevenDaysFromNow);

  if (error) {
    console.error("[refresh-meta-tokens] Error fetching connections:", error);
    await logRuntime({
      module: "general",
      action: "refresh_tokens",
      status: "error",
      errorMessage: error.message,
    });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: withSecurityHeaders({ "Content-Type": "application/json" }) });
  }

  if (!connections?.length) {
    console.log("[refresh-meta-tokens] No tokens need refreshing");
    return new Response(JSON.stringify({ refreshed: 0, expired: 0 }), {
      status: 200,
      headers: withSecurityHeaders({ "Content-Type": "application/json" }),
    });
  }

  console.log(`[refresh-meta-tokens] Found ${connections.length} tokens to refresh`);

  let refreshed = 0;
  let expired = 0;

  for (const conn of connections) {
    try {
      const newToken = await refreshLongLivedToken(conn.access_token);
      const expiresInSeconds = newToken.expires_in || 60 * 24 * 3600;
      const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

      // Atualizar token na conexao
      await supabase
        .from("meta_connections")
        .update({
          access_token: newToken.access_token,
          token_expires_at: newExpiresAt,
          status: "connected",
        })
        .eq("id", conn.id);

      // Atualizar page tokens tambem (page tokens derivam do user token)
      // Na pratica, page tokens nao expiram se o user token e valido,
      // mas e bom manter a referencia atualizada
      console.log(
        `[refresh-meta-tokens] Refreshed token for ${conn.facebook_user_name || conn.id}`
      );
      refreshed++;
    } catch (err) {
      console.error(
        `[refresh-meta-tokens] Failed to refresh token for ${conn.facebook_user_name || conn.id}:`,
        err
      );

      // Marcar como expirado
      await supabase
        .from("meta_connections")
        .update({ status: "expired" })
        .eq("id", conn.id);

      expired++;
    }
  }

  const result = { refreshed, expired, total: connections.length };
  console.log("[refresh-meta-tokens] Job complete:", result);

  await logRuntime({
    module: "general",
    action: "refresh_tokens",
    status: expired > 0 && refreshed === 0 ? "error" : "success",
    payloadSnapshot: result,
    errorMessage: expired > 0 ? `${expired} token(s) expired` : undefined,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: withSecurityHeaders({ "Content-Type": "application/json" }),
  });
}));
