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
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ERP_WEBHOOK_SECRET = Deno.env.get("ERP_ORDER_WEBHOOK_SECRET") || "";

// CNPJ/CPF só dígitos; vazio → null
function normalizeDoc(v?: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

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
  withErrorBoundary("erp-order-webhook", async (req: Request): Promise<Response> => {
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

      // Fail-closed: se o secret não está configurado, rejeita (antes: pulava o check = fail-open).
      if (!ERP_WEBHOOK_SECRET) {
        return new Response(
          JSON.stringify({ error: "Webhook secret not configured" }),
          { status: 503, headers: jsonHeaders },
        );
      }
      if (!providedSecret || !timingSafeCompare(providedSecret, ERP_WEBHOOK_SECRET)) {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: jsonHeaders },
        );
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      console.log(`[erp-order-webhook] org=${orgId} pedido=${pedido.id} cliente=${pedido.cliente.nome} itens=${pedido.itens.length}`);

      // Match cliente: CNPJ (do payload) → nome exato → company → auto-cria.
      // Modelo carteira person-based (cliente derivado do pedido). Ver Camada 2.
      const clientName = pedido.cliente.nome.trim();
      const cnpj = normalizeDoc(pedido.cliente.cpf_cnpj);
      const nameNorm = clientName.toLowerCase().replace(/\s+/g, " ");
      let clientId: string | null = null;
      let closerId: string | null = null;

      if (cnpj) {
        const { data } = await supabase
          .from("upsell_clients").select("id, closer_id")
          .eq("organization_id", orgId).eq("cnpj", cnpj)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle();
        if (data) { clientId = data.id; closerId = data.closer_id; }
      }
      if (!clientId && nameNorm) {
        const { data } = await supabase
          .from("upsell_clients").select("id, closer_id, name")
          .eq("organization_id", orgId).ilike("name", clientName).limit(3);
        const exact = (data ?? []).filter(
          (r: { name?: string }) => (r.name ?? "").trim().toLowerCase().replace(/\s+/g, " ") === nameNorm,
        );
        if (exact.length === 1) { clientId = exact[0].id; closerId = exact[0].closer_id; }
      }
      if (!clientId) {
        const { data } = await supabase
          .from("upsell_clients").select("id, closer_id")
          .eq("organization_id", orgId).ilike("company", clientName).limit(1);
        if (data && data.length > 0) { clientId = data[0].id; closerId = data[0].closer_id; }
      }
      // Auto-cria se não achou (não perde o pedido).
      if (!clientId) {
        const { data: novo, error: createErr } = await supabase
          .from("upsell_clients").insert({
            organization_id: orgId,
            name: clientName || "Cliente ERP",
            cnpj,
            external_source: "tiny",
            tiny_synced_at: new Date().toISOString(),
            is_active: true,
          }).select("id, closer_id").single();
        if (createErr) {
          console.error(`[erp-order-webhook] Failed to create client:`, createErr);
          return new Response(
            JSON.stringify({ ok: false, error: createErr.message }),
            { status: 200, headers: jsonHeaders },
          );
        }
        clientId = novo.id;
        closerId = novo.closer_id;
      }

      // Dedup por tiny_order_id (idempotente)
      const { data: existingOrder } = await supabase
        .from("upsell_orders")
        .select("id")
        .eq("organization_id", orgId)
        .eq("tiny_order_id", String(pedido.id))
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
          origin: "upsell", // CHECK só aceita new_business|upsell (não 'erp')
          source: "erp",
          approval_status: "approved", // pedido do ERP entra aprovado → conta na métrica
          approved_at: new Date().toISOString(),
          sold_at: pedido.data_pedido ? new Date(pedido.data_pedido).toISOString() : new Date().toISOString(),
          tiny_order_id: String(pedido.id),
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
        module: "carteira",
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
        module: "carteira",
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
