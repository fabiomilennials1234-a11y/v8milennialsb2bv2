/**
 * Supabase-backed TituloStore — DB adapter behind upsertCanonicalTitulo.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TituloStore } from "./upsert-titulo.ts";

export function supabaseTituloStore(admin: SupabaseClient): TituloStore {
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

    async findTituloByExternalId(organizationId, source, externalId) {
      const { data } = await admin
        .from("titulos_receber")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },

    async updateTitulo(id, patch) {
      const { error } = await admin.from("titulos_receber").update(patch).eq("id", id);
      if (error) throw new Error(`updateTitulo: ${error.message}`);
    },

    async createTitulo(row) {
      const { data, error } = await admin
        .from("titulos_receber")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(`createTitulo: ${error.message}`);
      return data.id as string;
    },
  };
}
