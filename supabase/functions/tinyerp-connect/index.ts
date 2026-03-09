/**
 * tinyerp-connect
 *
 * Valida o API token do TinyERP e armazena encriptado.
 * Body: { api_token: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { encryptToken, callTinyApi, logTinyOp, ENCRYPTION_KEY_ID } from "../_shared/tinyerp-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

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
      // Try to get account info — Tiny doesn't have a dedicated info endpoint,
      // so we list products with limit 1 to validate the token
      const testResult = await callTinyApi(api_token.trim(), "produtos.pesquisa.php", {
        pesquisa: "",
        pagina: 1,
      });

      if (testResult.retorno.status_processamento === "3") {
        const errorMsg = testResult.retorno.erros?.[0]?.erro || "Token inválido";
        return new Response(
          JSON.stringify({ error: `Token inválido: ${errorMsg}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Try to get CNPJ from contacts
      try {
        const contactResult = await callTinyApi(api_token.trim(), "contatos.pesquisa.php", {
          pesquisa: "",
          pagina: 1,
        });
        if (contactResult.retorno.status_processamento !== "3") {
          accountName = "TinyERP Conectado";
        }
      } catch {
        // Ignore - not critical
      }
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
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
