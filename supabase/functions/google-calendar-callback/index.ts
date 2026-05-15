/**
 * google-calendar-callback
 *
 * Endpoint público (GET) para onde o Google redireciona após o usuário autorizar.
 * Troca o code por tokens, criptografa e armazena, registra watch channel,
 * e redireciona o usuário para /configuracoes?google=connected.
 *
 * URL: ${SUPABASE_URL}/functions/v1/google-calendar-callback?code=...&state=...
 */

import { withSentry } from '../_shared/sentry.ts';
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "../_shared/logger.ts";
import {
  decodeState,
  encryptToken,
  ENCRYPTION_KEY_ID,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  logCalendarOp,
  registerWatchChannel,
} from "../_shared/google-calendar-utils.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL                   = Deno.env.get("APP_URL") ?? "http://localhost:5173";

Deno.serve(withSentry('google-calendar-callback', async (req) => {
  try {
    const url    = new URL(req.url);
    const code   = url.searchParams.get("code");
    const state  = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");

    const redirect = (params: Record<string, string>) => {
      const p = new URLSearchParams(params);
      return Response.redirect(`${APP_URL}/configuracoes?${p}`, 302);
    };

    // ── Erro retornado pelo Google ───────────────────────────────────────────
    if (errParam) {
      return redirect({ google: "error", reason: errParam });
    }

    if (!code || !state) {
      return redirect({ google: "error", reason: "parametros_ausentes" });
    }

    // ── Valida state (CSRF) ──────────────────────────────────────────────────
    const stateData = decodeState(state);
    if (!stateData) {
      return redirect({ google: "error", reason: "state_invalido_ou_expirado" });
    }
    const { userId, orgId } = stateData;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── Troca code por tokens ────────────────────────────────────────────────
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  GOOGLE_REDIRECT_URI,
        grant_type:    "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json();
      console.error("[google-calendar-callback] token exchange error:", err);
      await logCalendarOp(supabase, {
        userId,
        operation: "connection",
        status: "failed",
        errorMessage: err.error_description ?? err.error,
        initiatedBy: "user",
      });
      return redirect({ google: "error", reason: "falha_na_troca_de_tokens" });
    }

    const tokens: {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
      id_token?: string;
    } = await tokenRes.json();

    if (!tokens.refresh_token) {
      // Isso ocorre se o usuário já tinha autorizado antes sem prompt=consent
      return redirect({ google: "error", reason: "refresh_token_ausente_revogue_e_tente_novamente" });
    }

    // ── Busca informações da conta Google ────────────────────────────────────
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const userInfo: { email: string; id: string } = userInfoRes.ok
      ? await userInfoRes.json()
      : { email: "desconhecido@google.com", id: "unknown" };

    // ── Criptografa refresh token ─────────────────────────────────────────────
    const { encrypted, nonce } = await encryptToken(tokens.refresh_token);

    // ── Upsert em google_calendar_tokens ─────────────────────────────────────
    const scopesArray = tokens.scope ? tokens.scope.split(" ") : [];
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { error: upsertError } = await supabase
      .from("google_calendar_tokens")
      .upsert(
        {
          user_id:                 userId,
          organization_id:         orgId || null,
          google_email:            userInfo.email,
          google_account_id:       userInfo.id,
          encrypted_refresh_token: encrypted,
          encryption_nonce:        nonce,
          encryption_key_id:       ENCRYPTION_KEY_ID,
          access_token_expires_at: expiresAt,
          scopes_granted:          scopesArray,
          is_active:               true,
          connected_at:            new Date().toISOString(),
          revoked_at:              null,
          last_error:              null,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("[google-calendar-callback] upsert error:", upsertError);
      return redirect({ google: "error", reason: "erro_ao_salvar_tokens" });
    }

    // ── Registra watch channel (push notifications) ───────────────────────────
    await registerWatchChannel(userId, orgId, tokens.access_token, supabase);

    // ── Audit log ────────────────────────────────────────────────────────────
    await logCalendarOp(supabase, {
      userId,
      operation: "connection",
      status: "success",
      initiatedBy: "user",
      responsePayload: { email: userInfo.email, scopes: scopesArray },
    });

    await logRuntime({
      organizationId: orgId,
      module: "calendar",
      action: "oauth_callback",
      status: "success",
      triggeredBy: "user",
      payloadSnapshot: { email: userInfo.email, scopes: scopesArray },
    });

    return redirect({ google: "connected", email: userInfo.email });
  } catch (err) {
    console.error("[google-calendar-callback] unexpected error:", err);

    await logRuntime({
      module: "calendar",
      action: "oauth_callback",
      status: "error",
      errorMessage: String(err),
      triggeredBy: "system",
    });

    const APP_URL_FALLBACK = Deno.env.get("APP_URL") ?? "http://localhost:5173";
    return Response.redirect(
      `${APP_URL_FALLBACK}/configuracoes?google=error&reason=erro_interno`,
      302
    );
  }
}));
