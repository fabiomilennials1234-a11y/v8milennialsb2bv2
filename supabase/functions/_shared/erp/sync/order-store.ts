/**
 * Supabase-backed OrderStore — DB adapter behind upsertCanonicalOrder.
 * Logic lives in upsert-order.ts; this only speaks to Postgres.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OrderStore } from "./upsert-order.ts";

export function supabaseOrderStore(admin: SupabaseClient): OrderStore {
  return {
    async findClientIdByExternalId(organizationId, source, clientExternalId) {
      const { data } = await admin
        .from("upsell_clients")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", clientExternalId)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },

    async findClientIdByCnpj(organizationId, cnpj) {
      const digits = cnpj.replace(/\D/g, "");
      if (!digits) return null;
      const { data } = await admin
        .from("upsell_clients")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("cnpj", digits)
        // Mesmo documento em duas linhas acontece (filial cadastrada duas vezes
        // no ERP, cliente criado à mão antes da integração). A mais recente é a
        // que a sincronização vem mantendo — é nela que o pedido deve entrar.
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },

    async findOrderByExternalId(organizationId, source, externalId) {
      const { data } = await admin
        .from("upsell_orders")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },

    async updateOrder(id, patch) {
      const { error } = await admin.from("upsell_orders").update(patch).eq("id", id);
      if (error) throw new Error(`updateOrder: ${error.message}`);
    },

    async createOrder(row) {
      const { data, error } = await admin
        .from("upsell_orders")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(`createOrder: ${error.message}`);
      return data.id as string;
    },

    /**
     * Apaga e regrava os itens do pedido.
     *
     * Substituir, e não casar linha a linha: o ERP pode ter removido um item na
     * edição do pedido, e um upsert por chave deixaria o item removido vivo para
     * sempre. Um pedido tem dezenas de linhas, não milhares — o custo de
     * reescrever é irrelevante perto do de manter dado que não existe mais.
     */
    async replaceOrderItems({ organizationId, orderId, source, items }) {
      const { error: delErr } = await admin
        .from("erp_order_items")
        .delete()
        .eq("organization_id", organizationId)
        .eq("order_id", orderId);
      if (delErr) throw new Error(`replaceOrderItems (delete): ${delErr.message}`);

      if (items.length === 0) return;

      const { error } = await admin.from("erp_order_items").insert(
        items.map((item, index) => ({
          organization_id: organizationId,
          order_id: orderId,
          external_source: source,
          // Posição na resposta do ERP. É o que dá identidade a duas linhas do
          // mesmo produto no mesmo pedido — que acontece quando o preço difere.
          line_no: index + 1,
          product_external_id: item.productExternalId,
          description: item.description,
          quantity: item.quantity,
          unit_value: item.unitValue,
          total_value: item.totalValue,
        })),
      );
      if (error) throw new Error(`replaceOrderItems (insert): ${error.message}`);
    },
  };
}
