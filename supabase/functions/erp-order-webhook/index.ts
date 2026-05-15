/**
 * erp-order-webhook
 *
 * Receives order data from TinyERP and creates upsell_orders + client_purchase_items.
 * Matches client by company name within the organization.
 * Auth: per-org webhook secret stored in tinyerp_connections.webhook_secret.
 *
 * Payload:
 * {
 *   organization_id: string,
 *   secret: string,
 *   pedido: {
 *     id: string,
 *     numero: string,
 *     cliente: { nome: string, cpf_cnpj?: string },
 *     itens: [{ descricao: string, quantidade: number, valor_unitario: number }],
 *     valor_total: number,
 *     data_pedido?: string,
 *     vendedor?: string
 *   }
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ERP_WEBHOOK_SECRET = Deno.env.get("ERP_ORDER_WEBHOOK_SECRET") || "";

interface ERPOrderPayload {
  organization_id: string;
  secret?: string;
  pedido: {
    id: string;
    numero?: string;
    cliente: {
      nome: string;
      cpf_cnpj?: string;
    };
    itens: Array<{
      descricao: string;
      quantidade: number;
      valor_unitario: number;
      unidade?: string;
    }>;
    valor_total: number;
    data_pedido?: string;
    vendedor?: string;
  };
}

Deno.serve(
  withSentry("erp-order-webhook", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders(
      getCorsHeaders(req.headers.get("origin")),
    );
    const jsonHeaders = { ...headers, "Content-Type": "application/json" };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      const body: ERPOrderPayload = await req.json();
      const { organization_id: orgId, pedido } = body;

      if (!orgId || !pedido?.cliente?.nome || !pedido.itens?.length) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: organization_id, pedido.cliente.nome, pedido.itens" }),
          { status: 400, headers: jsonHeaders },
        );
      }

      // Auth: global secret OR per-payload secret
      const providedSecret =
        req.headers.get("x-webhook-secret") ??
        body.secret ??
        "";

      if (ERP_WEBHOOK_SECRET && (!providedSecret || !timingSafeCompare(providedSecret, ERP_WEBHOOK_SECRET))) {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: jsonHeaders },
        );
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      console.log(`[erp-order-webhook] org=${orgId} pedido=${pedido.id} cliente=${pedido.cliente.nome} itens=${pedido.itens.length}`);

      // Match client by company name (case-insensitive)
      const clientName = pedido.cliente.nome.trim();
      const { data: matchedClients } = await supabase
        .from("upsell_clients")
        .select("id, name, closer_id")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .ilike("name", clientName);

      let clientId: string | null = null;
      let closerId: string | null = null;

      if (matchedClients && matchedClients.length > 0) {
        clientId = matchedClients[0].id;
        closerId = matchedClients[0].closer_id;
      } else {
        // Try matching by company field
        const { data: companyMatch } = await supabase
          .from("upsell_clients")
          .select("id, name, closer_id")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .ilike("company", clientName);

        if (companyMatch && companyMatch.length > 0) {
          clientId = companyMatch[0].id;
          closerId = companyMatch[0].closer_id;
        }
      }

      if (!clientId) {
        console.log(`[erp-order-webhook] No matching client for "${clientName}" in org ${orgId}`);

        await logRuntime({
          organizationId: orgId,
          module: "general",
          action: "erp_order_import",
          status: "skipped",
          payloadSnapshot: {
            reason: "no_client_match",
            cliente: clientName,
            pedido_id: pedido.id,
          },
        });

        return new Response(
          JSON.stringify({
            ok: false,
            reason: "no_client_match",
            message: `No upsell_client matched for "${clientName}"`,
          }),
          { status: 200, headers: jsonHeaders },
        );
      }

      // Dedup: check if order with same TinyERP ID already exists
      const { data: existingOrder } = await supabase
        .from("upsell_orders")
        .select("id")
        .eq("client_id", clientId)
        .eq("source", "erp")
        .eq("notes", `tiny:${pedido.id}`)
        .maybeSingle();

      if (existingOrder) {
        console.log(`[erp-order-webhook] Duplicate order tiny:${pedido.id} for client ${clientId}`);
        return new Response(
          JSON.stringify({ ok: true, message: "duplicate", order_id: existingOrder.id }),
          { status: 200, headers: jsonHeaders },
        );
      }

      // Create upsell_order
      const saleValue = Number(pedido.valor_total) || pedido.itens.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);
      const productName = pedido.itens.length === 1
        ? pedido.itens[0].descricao
        : `Pedido ERP #${pedido.numero || pedido.id} (${pedido.itens.length} itens)`;

      const { data: order, error: orderError } = await supabase
        .from("upsell_orders")
        .insert({
          organization_id: orgId,
          client_id: clientId,
          closer_id: closerId,
          product_name: productName,
          product_type: "unitario",
          sale_value: saleValue,
          origin: "erp",
          source: "erp",
          sold_at: pedido.data_pedido ? new Date(pedido.data_pedido).toISOString() : new Date().toISOString(),
          notes: `tiny:${pedido.id}`,
        })
        .select("id")
        .single();

      if (orderError) {
        console.error(`[erp-order-webhook] Failed to create order:`, orderError);
        return new Response(
          JSON.stringify({ ok: false, error: orderError.message }),
          { status: 500, headers: jsonHeaders },
        );
      }

      // Create purchase items
      const items = pedido.itens.map((item) => ({
        order_id: order.id,
        product_name: item.descricao,
        quantity: item.quantidade,
        unit_price: item.valor_unitario,
        unit: item.unidade ?? "un",
      }));

      const { error: itemsError } = await supabase
        .from("client_purchase_items")
        .insert(items);

      if (itemsError) {
        console.error(`[erp-order-webhook] Failed to insert items:`, itemsError);
      }

      await logRuntime({
        organizationId: orgId,
        module: "general",
        action: "erp_order_import",
        status: "success",
        entityType: "upsell_order",
        entityId: order.id,
        payloadSnapshot: {
          pedido_id: pedido.id,
          client_id: clientId,
          items_count: items.length,
          sale_value: saleValue,
        },
      });

      console.log(`[erp-order-webhook] Created order ${order.id} for client ${clientId} with ${items.length} items`);

      return new Response(
        JSON.stringify({
          ok: true,
          order_id: order.id,
          client_id: clientId,
          items_count: items.length,
        }),
        { status: 200, headers: jsonHeaders },
      );
    } catch (err) {
      console.error("[erp-order-webhook] Error:", err);

      await logRuntime({
        module: "general",
        action: "erp_order_import",
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      return new Response(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Internal error" }),
        { status: 200, headers: jsonHeaders },
      );
    }
  }),
);
