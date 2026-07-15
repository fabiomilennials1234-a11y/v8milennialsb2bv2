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
  };
}
