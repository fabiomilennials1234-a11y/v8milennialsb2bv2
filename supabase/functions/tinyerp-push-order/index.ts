/**
 * tinyerp-push-order
 *
 * Envia um pedido (pipe_proposta) para o TinyERP.
 * Mapeia lead → contato, items → itens do pedido.
 * Body: { pipe_proposta_id: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getOrgTinyToken, callTinyApi, logTinyOp, getTinyErrorMessage } from "../_shared/tinyerp-utils.ts";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry('tinyerp-push-order', async (req) => {
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

    const { pipe_proposta_id, client_override, frete, parcelas, meio_pagamento } = await req.json();
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
    // Tables/columns: pipe_propostas(sale_value, notes), leads(name, company, email, phone, faturamento, segment),
    // pipe_proposta_items(quantity, unit_price, sale_value, product_id), products(name, sku)
    const { data: proposta, error: propostaError } = await supabaseAdmin
      .from("pipe_propostas")
      .select(`
        id, sale_value, notes,
        lead:leads(id, name, company, email, phone, faturamento, segment),
        items:pipe_proposta_items(id, quantity, unit_price, sale_value, product_id, product:products(id, name, sku))
      `)
      .eq("id", pipe_proposta_id)
      .single();

    if (propostaError || !proposta) {
      console.error("[TinyERP Push] Proposta query error:", propostaError);
      return new Response(
        JSON.stringify({ error: "Proposta não encontrada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lead = proposta.lead as Record<string, unknown> | null;
    const items = (proposta.items || []) as Array<Record<string, unknown>>;

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ error: "Proposta sem itens — adicione produtos antes de enviar" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[TinyERP Push] Pushing order for proposta:", pipe_proposta_id, "items:", items.length);

    // Build TinyERP order payload
    // pipe_proposta_items has quantity, unit_price (per unit), and sale_value (line total = qty * unit_price)
    const tinyItems = items.map((item, idx) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price) || Number(item.sale_value) || 0;
      return {
        item: {
          descricao: (item.product as Record<string, unknown>)?.name || `Item ${idx + 1}`,
          codigo: (item.product as Record<string, unknown>)?.sku || "",
          unidade: "UN",
          quantidade: qty,
          valor_unitario: unitPrice,
        },
      };
    });

    // Use client_override (from confirmation modal) if provided, otherwise use lead data
    const co = client_override as Record<string, string> | undefined;
    const clienteData = {
      nome: co?.nome || lead?.name || lead?.company || "Cliente",
      cpf_cnpj: co?.cpf_cnpj || "",
      email: co?.email || lead?.email || "",
      fone: co?.fone || lead?.phone || "",
      endereco: co?.endereco || "",
      bairro: co?.bairro || "",
      cidade: co?.cidade || "",
      uf: co?.uf || "",
      cep: co?.cep || "",
    };

    // Search for existing contact in TinyERP, register if not found (best-effort)
    if (clienteData.nome && clienteData.nome !== "Cliente") {
      try {
        let contactFound = false;

        // Search by CNPJ first (most precise), then by name
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
              console.log("[TinyERP Push] Contact already exists for:", term);
              break;
            }
          } catch {
            // Search failed — proceed to create
          }
        }

        if (!contactFound) {
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
          console.log("[TinyERP Push] Contact creation:", contactResult.retorno.status);
        }
      } catch (contactErr) {
        // Best-effort — don't block order creation if contact fails
        console.warn("[TinyERP Push] Contact handling failed (non-blocking):", contactErr);
      }
    }

    // Build freight data
    const freteData = frete as Record<string, unknown> | undefined;
    const valorFrete = Number(freteData?.valor_frete) || 0;

    // Build parcelas for TinyERP
    const parcelasInput = (parcelas || []) as Array<{ dias: number; valor: number }>;
    const meioPagamentoStr = (meio_pagamento || "dinheiro") as string;
    const tinyParcelas = parcelasInput.length > 0
      ? parcelasInput.map((p) => ({
          parcela: {
            dias: p.dias,
            valor: p.valor.toFixed(2),
            forma_pagamento: "",
            meio_pagamento: meioPagamentoStr,
          },
        }))
      : undefined;

    const pedidoObj: Record<string, unknown> = {
      cliente: clienteData,
      itens: tinyItems,
      valor_frete: valorFrete,
      valor_desconto: 0,
      obs: proposta.notes || `Pedido gerado via CRM - Proposta ${pipe_proposta_id.substring(0, 8)}`,
      situacao: "aberto",
      meio_pagamento: meioPagamentoStr,
    };

    // Add freight fields if provided
    if (freteData?.frete_por_conta) pedidoObj.frete_por_conta = freteData.frete_por_conta;
    if (freteData?.nome_transportador) pedidoObj.nome_transportador = freteData.nome_transportador;
    if (freteData?.forma_envio) pedidoObj.forma_envio = freteData.forma_envio;

    // Add parcelas if provided
    if (tinyParcelas && tinyParcelas.length > 0) {
      pedidoObj.parcelas = tinyParcelas;
    }

    const pedido = { pedido: pedidoObj };

    const result = await callTinyApi(tokenData.token, "pedido.incluir.php", {
      pedido: JSON.stringify(pedido),
    });

    console.log("[TinyERP Push] API response:", {
      status: result.retorno.status,
      status_processamento: result.retorno.status_processamento,
      registros: result.retorno.registros,
    });

    // TinyERP API v2 can return status_processamento "3" even on success (status "OK").
    // Check for actual data (registros) or status "OK" before declaring failure.
    const registros = (result.retorno.registros || []) as Array<Record<string, unknown>>;
    const registro = (registros[0] as Record<string, unknown>)?.registro as Record<string, unknown> | undefined;
    const isStatusOk = result.retorno.status === "OK" || result.retorno.status === "Sucesso";
    const hasRegistro = !!registro;

    if (!hasRegistro && !isStatusOk) {
      const errorMsg = getTinyErrorMessage(result) || "Erro ao criar pedido no TinyERP";

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

    await logRuntime({
      organizationId: orgId,
      module: "general",
      action: "tinyerp_push_order",
      status: "success",
      entityType: "pipe_proposta",
      entityId: pipe_proposta_id,
      payloadSnapshot: { tinyOrderId, tinyOrderNumber, items: items.length },
    });

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
    await logRuntime({
      module: "general",
      action: "tinyerp_push_order",
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
