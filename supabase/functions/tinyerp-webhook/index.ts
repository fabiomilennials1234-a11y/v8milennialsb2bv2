/**
 * tinyerp-webhook
 *
 * Recebe webhooks do TinyERP (status de pedido, NF-e emitida, etc).
 * Atualiza tinyerp_order_mappings com o status mais recente.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logTinyOp } from "../_shared/tinyerp-utils.ts";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry('tinyerp-webhook', async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json();

    console.log("[TinyERP Webhook] Received:", JSON.stringify(body).substring(0, 500));

    // TinyERP webhook payload varies by event type
    // Common fields: dados.id, dados.numero, dados.situacao
    const dados = body.dados || body;
    const tipo = body.tipo || "unknown";
    const tinyOrderId = dados.idPedido ? String(dados.idPedido) : dados.id ? String(dados.id) : null;

    if (!tinyOrderId) {
      console.log("[TinyERP Webhook] No order ID found, skipping");
      return new Response(
        JSON.stringify({ ok: true, message: "No order ID" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the order mapping
    const { data: mapping } = await supabaseAdmin
      .from("tinyerp_order_mappings")
      .select("id, organization_id, pipe_proposta_id")
      .eq("tiny_order_id", tinyOrderId)
      .maybeSingle();

    if (!mapping) {
      console.log("[TinyERP Webhook] No mapping found for order:", tinyOrderId);
      return new Response(
        JSON.stringify({ ok: true, message: "No mapping found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update mapping with NF-e info if available
    const updateData: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
    };

    if (dados.idNotaFiscal || dados.nfe_id) {
      updateData.tiny_nfe_id = String(dados.idNotaFiscal || dados.nfe_id);
    }

    if (dados.situacao || dados.statusNfe) {
      updateData.tiny_nfe_status = dados.situacao || dados.statusNfe;
    }

    if (dados.numero) {
      updateData.tiny_order_number = String(dados.numero);
    }

    await supabaseAdmin
      .from("tinyerp_order_mappings")
      .update(updateData)
      .eq("id", mapping.id);

    // Fetch full NF-e details (link, number, key) if idNotaFiscal is present
    const idNotaFiscal = dados.idNotaFiscal || dados.nfe_id;
    if (idNotaFiscal) {
      try {
        const nfeUrl = `${SUPABASE_URL}/functions/v1/tinyerp-fetch-nfe`;
        fetch(nfeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            organizationId: mapping.organization_id,
            tinyOrderId,
            idNotaFiscal: String(idNotaFiscal),
          }),
        }).catch((e) => console.warn("[TinyERP Webhook] NF-e fetch fire-and-forget error:", e));
        console.log("[TinyERP Webhook] Triggered NF-e fetch for:", idNotaFiscal);
      } catch (nfeErr) {
        console.warn("[TinyERP Webhook] Failed to trigger NF-e fetch:", nfeErr);
      }
    }

    // Log the webhook
    await logTinyOp(supabaseAdmin, {
      organization_id: mapping.organization_id,
      operation: "webhook_received",
      status: "success",
      tiny_reference_id: tinyOrderId,
      local_reference_id: mapping.pipe_proposta_id,
      local_reference_type: "pipe_proposta",
      response_payload: body,
      initiated_by: "webhook",
    });

    console.log("[TinyERP Webhook] Processed for order:", tinyOrderId, "type:", tipo);

    await logRuntime({
      organizationId: mapping.organization_id,
      module: "general",
      action: "tinyerp_sync",
      status: "success",
      entityType: "tinyerp_order",
      entityId: tinyOrderId,
      payloadSnapshot: { tipo },
    });

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[TinyERP Webhook] Error:", err);
    await logRuntime({
      module: "general",
      action: "tinyerp_sync",
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // Always return 200 for webhooks to prevent retries
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Erro" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
