/**
 * Supabase-backed NfeStore — DB adapter behind upsertCanonicalNfe.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { NfeStore } from "./upsert-nfe.ts";

export function supabaseNfeStore(admin: SupabaseClient): NfeStore {
  return {
    async findOrderIdByExternalId(organizationId, source, orderExternalId) {
      const { data } = await admin
        .from("upsell_orders")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", orderExternalId)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },

    async findClientIdForOrder(orderId) {
      const { data } = await admin
        .from("upsell_orders")
        .select("client_id")
        .eq("id", orderId)
        .maybeSingle();
      return (data?.client_id as string | undefined) ?? null;
    },

    async findNfeByExternalId(organizationId, source, externalId) {
      const { data } = await admin
        .from("notas_fiscais")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },

    async updateNfe(id, patch) {
      const { error } = await admin.from("notas_fiscais").update(patch).eq("id", id);
      if (error) throw new Error(`updateNfe: ${error.message}`);
    },

    async createNfe(row) {
      const { data, error } = await admin
        .from("notas_fiscais")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(`createNfe: ${error.message}`);
      return data.id as string;
    },
  };
}
