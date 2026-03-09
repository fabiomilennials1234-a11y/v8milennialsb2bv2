/**
 * tinyerp-push-order
 *
 * Envia um pedido (pipe_proposta) para o TinyERP.
 * Mapeia lead → contato, items → itens do pedido.
 * Body: { pipe_proposta_id: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getOrgTinyToken, callTinyApi, logTinyOp } from "../_shared/tinyerp-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

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

    const { pipe_proposta_id } = await req.json();
    if (!pipe_proposta_id) {
      return new Response(
        JSON.stringify({ error: "pipe_proposta_id é obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already pushed
    const { data: existingMapping } = await supabaseAdmin
      .from("tinyerp_order_mappings")
      .select("id, tiny_order_id")
      .eq("pipe_proposta_id", pipe_proposta_id)
      .maybeSingle();

    if (existingMapping) {
      return new Response(
        JSON.stringify({ error: "Pedido já enviado para o TinyERP", tiny_order_id: existingMapping.tiny_order_id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load proposta with lead and items
    const { data: proposta, error: propostaError } = await supabaseAdmin
      .from("pipe_propostas")
      .select(`
        id, valor_total, observacoes,
        lead:leads(id, name, email, phone, cpf_cnpj, company_name, address, city, state, zip_code),
        items:proposta_items(id, quantity, unit_price, product_id, product:products(id, name, sku))
      `)
      .eq("id", pipe_proposta_id)
      .single();

    if (propostaError || !proposta) {
      return new Response(
        JSON.stringify({ error: "Proposta não encontrada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lead = proposta.lead as Record<string, unknown>;
    const items = (proposta.items || []) as Array<Record<string, unknown>>;

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ error: "Proposta sem itens — adicione produtos antes de enviar" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[TinyERP Push] Pushing order for proposta:", pipe_proposta_id);

    // Build TinyERP order payload
    const tinyItems = items.map((item, idx) => ({
      item: {
        descricao: (item.product as Record<string, unknown>)?.name || `Item ${idx + 1}`,
        codigo: (item.product as Record<string, unknown>)?.sku || "",
        unidade: "UN",
        quantidade: item.quantity || 1,
        valor_unitario: item.unit_price || 0,
      },
    }));

    const pedido = {
      pedido: {
        cliente: {
          nome: lead?.name || lead?.company_name || "Cliente",
          cpf_cnpj: lead?.cpf_cnpj || "",
          email: lead?.email || "",
          fone: lead?.phone || "",
          endereco: lead?.address || "",
          cidade: lead?.city || "",
          uf: lead?.state || "",
          cep: lead?.zip_code || "",
        },
        itens: tinyItems,
        valor_frete: 0,
        valor_desconto: 0,
        obs: proposta.observacoes || `Pedido gerado via CRM - Proposta ${pipe_proposta_id.substring(0, 8)}`,
        situacao: "aberto",
      },
    };

    const result = await callTinyApi(tokenData.token, "pedido.incluir.php", {
      pedido: JSON.stringify(pedido),
    });

    if (result.retorno.status_processamento === "3") {
      const errorMsg = result.retorno.erros?.[0]?.erro || "Erro ao criar pedido no TinyERP";

      await logTinyOp(supabaseAdmin, {
        organization_id: orgId,
        operation: "order_push",
        status: "failed",
        error_message: errorMsg,
        local_reference_id: pipe_proposta_id,
        local_reference_type: "pipe_proposta",
        request_payload: pedido,
        response_payload: result,
        initiated_by: "user",
      });

      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract order ID from response
    const registros = result.retorno.registros || [];
    const registro = registros[0]?.registro;
    const tinyOrderId = registro?.id ? String(registro.id) : "";
    const tinyOrderNumber = registro?.numero ? String(registro.numero) : "";

    // Create order mapping
    if (tinyOrderId) {
      await supabaseAdmin
        .from("tinyerp_order_mappings")
        .insert({
          organization_id: orgId,
          pipe_proposta_id,
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
      operation: "order_push",
      status: "success",
      items_processed: items.length,
      items_created: 1,
      local_reference_id: pipe_proposta_id,
      local_reference_type: "pipe_proposta",
      tiny_reference_id: tinyOrderId,
      request_payload: pedido,
      response_payload: result,
      initiated_by: "user",
    });

    console.log("[TinyERP Push] Success:", { tinyOrderId, tinyOrderNumber });

    return new Response(
      JSON.stringify({
        success: true,
        tiny_order_id: tinyOrderId,
        tiny_order_number: tinyOrderNumber,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[TinyERP Push] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
