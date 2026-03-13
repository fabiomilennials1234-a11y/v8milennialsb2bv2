/**
 * google-calendar-disconnect
 *
 * Revoga o token do Google, desativa o registro em google_calendar_tokens,
 * cancela watch channels e limpa o cache de eventos do usuário.
 *
 * Requer: Authorization: Bearer <supabase_jwt>
 * Método: POST
 */

import { withSentry } from '../_shared/sentry.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  cancelWatchChannels,
  decryptToken,
  getValidAccessToken,
  logCalendarOp,
} from "../_shared/google-calendar-utils.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY         =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

Deno.serve(withSentry('google-calendar-disconnect', async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const jwt = req.headers
      .get("Authorization")
      ?.replace(/^Bearer\s+/i, "")
      ?.trim();

    if (!jwt) {
      return json({ error: "Unauthorized", message: "Token JWT ausente" }, 401);
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !user?.id) {
      return json({ error: "Unauthorized", message: "JWT inválido ou expirado" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── Busca token record ───────────────────────────────────────────────────
    const { data: tokenRecord } = await supabase
      .from("google_calendar_tokens")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!tokenRecord) {
      return json({ success: true, message: "Nenhuma conexão ativa encontrada" });
    }

    // ── Obtém access token para revogar watch channels ────────────────────────
    let accessToken: string | null = null;
    try {
      const tokenData = await getValidAccessToken(user.id, supabase);
      accessToken = tokenData?.accessToken ?? null;
    } catch {
      // Ignora — continua a desconexão mesmo sem access token
    }

    // ── Cancela watch channels ───────────────────────────────────────────────
    if (accessToken) {
      await cancelWatchChannels(user.id, accessToken, supabase);
    } else {
      // Apenas marca como inativo sem chamar o Google
      await supabase
        .from("google_calendar_watch_channels")
        .update({ is_active: false })
        .eq("user_id", user.id);
    }

    // ── Revoga refresh token no Google ───────────────────────────────────────
    try {
      const refreshToken = await decryptToken(
        tokenRecord.encrypted_refresh_token,
        tokenRecord.encryption_nonce
      );
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        { method: "POST" }
      );
    } catch (revokeErr) {
      console.warn("[google-calendar-disconnect] Aviso ao revogar token:", revokeErr);
      // Continua — o registro local deve ser removido de qualquer forma
    }

    // ── Desativa registro ────────────────────────────────────────────────────
    await supabase
      .from("google_calendar_tokens")
      .update({
        is_active:  false,
        revoked_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    // ── Limpa cache de eventos ───────────────────────────────────────────────
    await supabase
      .from("google_calendar_events_cache")
      .delete()
      .eq("user_id", user.id);

    // ── Audit log ────────────────────────────────────────────────────────────
    await logCalendarOp(supabase, {
      userId: user.id,
      operation: "revocation",
      status: "success",
      initiatedBy: "user",
    });

    await logRuntime({
      organizationId: tokenRecord.organization_id ?? undefined,
      module: "calendar",
      action: "disconnect",
      status: "success",
      triggeredBy: "user",
      entityType: "user",
      entityId: user.id,
    });

    return json({ success: true, message: "Google Calendar desconectado com sucesso" });
  } catch (err) {
    console.error("[google-calendar-disconnect]", err);

    await logRuntime({
      module: "calendar",
      action: "disconnect",
      status: "error",
      errorMessage: String(err),
      triggeredBy: "system",
    });

    return json({ error: "Erro interno", message: String(err) }, 500);
  }
}));
