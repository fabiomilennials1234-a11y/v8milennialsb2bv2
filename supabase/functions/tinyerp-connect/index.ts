/**
 * tinyerp-connect
 *
 * Valida o API token do TinyERP e armazena encriptado.
 * Body: { api_token: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { encryptToken, callTinyApi, logTinyOp, getTinyErrorMessage, isTinyNoRecordsError, ENCRYPTION_KEY_ID } from "../_shared/tinyerp-utils.ts";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry('tinyerp-connect', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Não autorizado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Usuário não autenticado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's organization
    const { data: teamMember } = await supabaseAdmin
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!teamMember?.organization_id) {
      return new Response(
        JSON.stringify({ error: "Usuário não vinculado a uma organização" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { api_token } = await req.json();
    if (!api_token || typeof api_token !== "string" || api_token.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: "Token de API inválido" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Test the token by calling TinyERP info endpoint
    console.log("[TinyERP Connect] Testing token for org:", teamMember.organization_id);

    let accountName = "TinyERP";
    let cnpj = "";

    try {
      // Validate the token by calling produtos.pesquisa.php
      // IMPORTANT: TinyERP API v2 returns status_processamento "3" even on SUCCESS
      // with status "OK" and actual data. We cannot rely on status_processamento alone.
      // Instead, check if the response has actual error indicators.
      const testResult = await callTinyApi(api_token.trim(), "produtos.pesquisa.php", {
        pesquisa: "",
        pagina: 1,
      });

      console.log("[TinyERP Connect] API response status:", testResult.retorno.status, "processamento:", testResult.retorno.status_processamento);

      const hasData = testResult.retorno.produtos || testResult.retorno.numero_paginas;
      const isStatusOk = testResult.retorno.status === "OK" || testResult.retorno.status === "Sucesso";

      if (!hasData && !isStatusOk) {
        // No data and not OK — likely a real auth error
        const errorMsg = getTinyErrorMessage(testResult) || "Erro de autenticação";
        // Check if it's just "no records" (valid token, no products)
        if (!isTinyNoRecordsError(testResult)) {
          return new Response(
            JSON.stringify({ error: `Token inválido: ${errorMsg}` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.log("[TinyERP Connect] Token valid (no products found)");
      }

      accountName = "TinyERP Conectado";
    } catch (apiError) {
      const msg = apiError instanceof Error ? apiError.message : "Erro ao conectar";
      return new Response(
        JSON.stringify({ error: `Falha ao testar conexão: ${msg}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Encrypt and store the token
    const { encrypted, nonce } = await encryptToken(api_token.trim());

    const { error: upsertError } = await supabaseAdmin
      .from("tinyerp_connections")
      .upsert({
        organization_id: teamMember.organization_id,
        user_id: user.id,
        encrypted_api_token: encrypted,
        encryption_nonce: nonce,
        encryption_key_id: ENCRYPTION_KEY_ID,
        tiny_account_name: accountName,
        tiny_cnpj: cnpj || null,
        status: "connected",
        connected_at: new Date().toISOString(),
        last_error: null,
      }, {
        onConflict: "organization_id",
      });

    if (upsertError) {
      console.error("[TinyERP Connect] Upsert error:", upsertError);
      return new Response(
        JSON.stringify({ error: "Erro ao salvar conexão" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the operation
    await logTinyOp(supabaseAdmin, {
      organization_id: teamMember.organization_id,
      operation: "connection_test",
      status: "success",
      initiated_by: "user",
    });

    console.log("[TinyERP Connect] Success for org:", teamMember.organization_id);

    await logRuntime({
      organizationId: teamMember.organization_id,
      module: "general",
      action: "tinyerp_connect",
      status: "success",
      payloadSnapshot: { account_name: accountName },
    });

    return new Response(
      JSON.stringify({
        success: true,
        account_name: accountName,
        cnpj: cnpj || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[TinyERP Connect] Error:", err);
    await logRuntime({
      module: "general",
      action: "tinyerp_connect",
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
