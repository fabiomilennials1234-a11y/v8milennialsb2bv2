/**
 * google-calendar-connect
 *
 * Gera a URL de autorização OAuth do Google para o usuário conectar sua conta.
 * Retorna { authorization_url: string }.
 *
 * Requer: Authorization: Bearer <supabase_jwt>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  encodeState,
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES,
} from "../_shared/google-calendar-utils.ts";

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY        =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

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

    // ── Busca org_id do usuário ──────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: member } = await supabase
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const orgId = member?.organization_id ?? "";

    // ── Gera URL OAuth ───────────────────────────────────────────────────────
    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
      return new Response(
        JSON.stringify({ error: "Configuração incompleta", message: "GOOGLE_CLIENT_ID ou GOOGLE_REDIRECT_URI não configurados" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const state = encodeState(user.id, orgId);

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

    return new Response(
      JSON.stringify({ authorization_url, state }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[google-calendar-connect]", err);
    return new Response(
      JSON.stringify({ error: "Erro interno", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
