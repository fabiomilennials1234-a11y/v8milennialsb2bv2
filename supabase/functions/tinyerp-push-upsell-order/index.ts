/**
 * tinyerp-push-upsell-order
 *
 * Envia um pedido de upsell para o TinyERP.
 * 1. Busca contato existente no TinyERP (por nome/CNPJ) — se não encontrar, cadastra.
 * 2. Cria o pedido no TinyERP.
 * 3. Salva mapeamento em tinyerp_order_mappings.
 *
 * Body: { upsell_order_id: string, client_override?: { nome, cpf_cnpj, email, fone, endereco, bairro, cidade, uf, cep } }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getOrgTinyToken, callTinyApi, logTinyOp, getTinyErrorMessage } from "../_shared/tinyerp-utils.ts";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry('tinyerp-push-upsell-order', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
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

    const orgId = teamMember.organization_id;

    const tokenData = await getOrgTinyToken(supabaseAdmin, orgId);
    if (!tokenData) {
      return new Response(
        JSON.stringify({ error: "TinyERP não conectado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { upsell_order_id, client_override } = await req.json();
    if (!upsell_order_id) {
      return new Response(
        JSON.stringify({ error: "upsell_order_id é obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already pushed
    const { data: existingMapping } = await supabaseAdmin
      .from("tinyerp_order_mappings")
      .select("id, tiny_order_id")
      .eq("upsell_order_id", upsell_order_id)
      .maybeSingle();

    if (existingMapping) {
      return new Response(
        JSON.stringify({ error: "Pedido já enviado para o TinyERP", tiny_order_id: existingMapping.tiny_order_id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load upsell order with client data
    const { data: order, error: orderError } = await supabaseAdmin
      .from("upsell_orders")
      .select(`
        id, product_name, product_type, sale_value, notes, sold_at,
        client:upsell_clients(id, name, company, email, phone, lead_id)
      `)
      .eq("id", upsell_order_id)
      .single();

    if (orderError || !order) {
      console.error("[TinyERP Upsell Push] Order query error:", orderError);
      return new Response(
        JSON.stringify({ error: "Pedido de upsell não encontrado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const client = order.client as Record<string, unknown> | null;
    const co = client_override as Record<string, string> | undefined;

    const clienteData = {
      nome: co?.nome || (client?.name as string) || (client?.company as string) || "Cliente",
      cpf_cnpj: co?.cpf_cnpj || "",
      email: co?.email || (client?.email as string) || "",
      fone: co?.fone || (client?.phone as string) || "",
      endereco: co?.endereco || "",
      bairro: co?.bairro || "",
      cidade: co?.cidade || "",
      uf: co?.uf || "",
      cep: co?.cep || "",
    };

    console.log("[TinyERP Upsell Push] Pushing order:", upsell_order_id, "client:", clienteData.nome);

    // ─── Step 1: Search for existing contact in TinyERP ──────────────────────
    let contactFound = false;

    if (clienteData.nome && clienteData.nome !== "Cliente") {
      // Try searching by CNPJ first (most precise), then by name
      const searchTerms: string[] = [];
      if (clienteData.cpf_cnpj) searchTerms.push(clienteData.cpf_cnpj.replace(/\D/g, ""));
      searchTerms.push(clienteData.nome);

      for (const term of searchTerms) {
        try {
          const searchResult = await callTinyApi(tokenData.token, "contatos.pesquisa.php", {
            pesquisa: term,
          });

          const contatos = (searchResult.retorno.contatos as Array<Record<string, unknown>>) || [];
          if (contatos.length > 0) {
            contactFound = true;
            console.log("[TinyERP Upsell Push] Contact found in TinyERP for:", term, "count:", contatos.length);
            break;
          }
        } catch (searchErr) {
          console.warn("[TinyERP Upsell Push] Contact search failed (non-blocking):", searchErr);
        }
      }

      // ─── Step 2: Register contact if not found ───────────────────────────
      if (!contactFound) {
        try {
          const contato = {
            contato: {
              nome: clienteData.nome,
              tipo_pessoa: clienteData.cpf_cnpj && clienteData.cpf_cnpj.replace(/\D/g, "").length > 11 ? "J" : "F",
              cpf_cnpj: clienteData.cpf_cnpj,
              email: clienteData.email,
              fone: clienteData.fone,
              endereco: clienteData.endereco,
              bairro: clienteData.bairro,
              cidade: clienteData.cidade,
              uf: clienteData.uf,
              cep: clienteData.cep,
              contribuinte: "9", // Não contribuinte
            },
          };

          const contactResult = await callTinyApi(tokenData.token, "contato.incluir.php", {
            contato: JSON.stringify(contato),
          });
          console.log("[TinyERP Upsell Push] Contact creation:", contactResult.retorno.status);
        } catch (contactErr) {
          // Best-effort — don't block order creation if contact fails
          console.warn("[TinyERP Upsell Push] Contact creation failed (non-blocking):", contactErr);
        }
      }
    }

    // ─── Step 3: Create order in TinyERP ───────────────────────────────────
    const tinyItems = [{
      item: {
        descricao: order.product_name || "Produto",
        codigo: "",
        unidade: "UN",
        quantidade: 1,
        valor_unitario: Number(order.sale_value) || 0,
      },
    }];

    const pedido = {
      pedido: {
        cliente: clienteData,
        itens: tinyItems,
        valor_frete: 0,
        valor_desconto: 0,
        obs: order.notes || `Venda upsell registrada via CRM`,
        situacao: "aberto",
      },
    };

    const result = await callTinyApi(tokenData.token, "pedido.incluir.php", {
      pedido: JSON.stringify(pedido),
    });

    console.log("[TinyERP Upsell Push] API response:", {
      status: result.retorno.status,
      status_processamento: result.retorno.status_processamento,
      registros: result.retorno.registros,
    });

    const registros = (result.retorno.registros || []) as Array<Record<string, unknown>>;
    const registro = (registros[0] as Record<string, unknown>)?.registro as Record<string, unknown> | undefined;
    const isStatusOk = result.retorno.status === "OK" || result.retorno.status === "Sucesso";
    const hasRegistro = !!registro;

    if (!hasRegistro && !isStatusOk) {
      const errorMsg = getTinyErrorMessage(result) || "Erro ao criar pedido no TinyERP";

      await logTinyOp(supabaseAdmin, {
        organization_id: orgId,
        operation: "upsell_order_push",
        status: "failed",
        error_message: errorMsg,
        local_reference_id: upsell_order_id,
        local_reference_type: "upsell_order",
        request_payload: pedido,
        response_payload: result,
        initiated_by: "user",
      });

      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tinyOrderId = registro?.id ? String(registro.id) : "";
    const tinyOrderNumber = registro?.numero ? String(registro.numero) : "";

    // Create order mapping
    if (tinyOrderId) {
      await supabaseAdmin
        .from("tinyerp_order_mappings")
        .insert({
          organization_id: orgId,
          upsell_order_id,
          tiny_order_id: tinyOrderId,
          tiny_order_number: tinyOrderNumber || null,
        });
    }

    // Update last order push timestamp
    await supabaseAdmin
      .from("tinyerp_connections")
      .update({ last_order_push_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    // Log success
    await logTinyOp(supabaseAdmin, {
      organization_id: orgId,
      operation: "upsell_order_push",
      status: "success",
      items_processed: 1,
      items_created: 1,
      local_reference_id: upsell_order_id,
      local_reference_type: "upsell_order",
      tiny_reference_id: tinyOrderId,
      request_payload: pedido,
      response_payload: result,
      initiated_by: "user",
    });

    console.log("[TinyERP Upsell Push] Success:", { tinyOrderId, tinyOrderNumber, contactFound });

    await logRuntime({
      organizationId: orgId,
      module: "general",
      action: "tinyerp_push_upsell",
      status: "success",
      entityType: "upsell_order",
      entityId: upsell_order_id,
      payloadSnapshot: { tinyOrderId, tinyOrderNumber, contactFound },
    });

    return new Response(
      JSON.stringify({
        success: true,
        tiny_order_id: tinyOrderId,
        tiny_order_number: tinyOrderNumber,
        contact_found: contactFound,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[TinyERP Upsell Push] Error:", err);
    await logRuntime({
      module: "general",
      action: "tinyerp_push_upsell",
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
