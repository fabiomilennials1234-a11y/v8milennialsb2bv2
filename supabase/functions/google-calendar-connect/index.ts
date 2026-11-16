/**
 * google-calendar-connect
 *
 * Gera a URL de autorização OAuth do Google para o usuário conectar sua conta.
 * Retorna { authorization_url: string }.
 *
 * Requer: Authorization: Bearer <supabase_jwt>
 * Query:  ?organization_id=<uuid> — org em que o usuário está agindo. Opcional
 *         só para quem tem exatamente UMA membership ativa.
 *
 * SEGURANÇA: o `state` sai daqui assinado (HMAC) e com nonce de uso único
 * gravado em google_calendar_oauth_nonces. Sem membership ativa na org, não há
 * conexão — antes caía em `orgId ?? ""` e seguia.
 */

import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES,
} from "../_shared/google-calendar-utils.ts";
import { signGoogleCalendarState } from "../_shared/google-calendar-oauth-state.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY        =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

Deno.serve(withErrorBoundary('google-calendar-connect', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const jwt = req.headers
      .get("Authorization")
      ?.replace(/^Bearer\s+/i, "")
      ?.trim();

    if (!jwt) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: "Token JWT ausente" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !user?.id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: "JWT inválido ou expirado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const json = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      return json(500, {
        error: "Configuração incompleta",
        message: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_REDIRECT_URI não configurados",
      });
    }

    // ── Resolve a org pela membership ativa ─────────────────────────────────
    // Mesmo critério que google_calendar_consume_oauth_nonce revalida no
    // callback: team_members ativo. Multi-org sem org explícita é ambíguo e
    // é recusado — nunca "a primeira org".
    const requestedOrg = new URL(req.url).searchParams.get("organization_id")?.trim() || null;
    if (requestedOrg && !UUID_RE.test(requestedOrg)) {
      return json(400, { error: "organization_id inválido", message: "organization_id precisa ser um UUID" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: memberships, error: membershipError } = await supabase
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (membershipError) throw membershipError;

    const orgIds = [...new Set((memberships ?? []).map((m) => m.organization_id as string))];
    let orgId: string;
    if (requestedOrg) {
      if (!orgIds.includes(requestedOrg)) {
        return json(403, { error: "Forbidden", message: "Você não pertence a esta organização" });
      }
      orgId = requestedOrg;
    } else if (orgIds.length === 1) {
      orgId = orgIds[0];
    } else if (orgIds.length === 0) {
      return json(403, { error: "Forbidden", message: "Sem membership ativa em nenhuma organização" });
    } else {
      return json(400, {
        error: "organization_id obrigatório",
        message: "Usuário com mais de uma organização precisa informar organization_id",
      });
    }

    // ── Nonce de uso único + state assinado ─────────────────────────────────
    const nonce = crypto.randomUUID();
    const { state, expiresAt } = await signGoogleCalendarState(
      { userId: user.id, orgId, nonce },
      GOOGLE_CLIENT_SECRET,
    );

    const { error: nonceError } = await supabase.from("google_calendar_oauth_nonces").insert({
      nonce,
      user_id: user.id,
      organization_id: orgId,
      expires_at: new Date(expiresAt).toISOString(),
    });
    if (nonceError) {
      console.error("[google-calendar-connect] nonce insert error:", nonceError);
      return json(503, { error: "state_storage_unavailable", message: "Não foi possível iniciar a conexão" });
    }

    // ── Gera URL OAuth ───────────────────────────────────────────────────────
    const params = new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      redirect_uri:  GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope:         GOOGLE_SCOPES,
      access_type:   "offline",
      prompt:        "consent",
      state,
    });

    const authorization_url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    await logRuntime({
      organizationId: orgId,
      module: "calendar",
      action: "connect",
      status: "success",
      triggeredBy: "user",
      entityType: "user",
      entityId: user.id,
    });

    return json(200, { authorization_url });
  } catch (err) {
    console.error("[google-calendar-connect]", err);

    await logRuntime({
      module: "calendar",
      action: "connect",
      status: "error",
      errorMessage: String(err),
      triggeredBy: "system",
    });

    return new Response(
      JSON.stringify({ error: "Erro interno", message: "Não foi possível iniciar a conexão" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
