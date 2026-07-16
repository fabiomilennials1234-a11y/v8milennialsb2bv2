/**
 * Supabase-backed ProductStore — DB adapter behind upsertCanonicalProduct.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ProductStore, ExistingProduct } from "./upsert-product.ts";

const SELECT = "id, name, ticket, sku, base_unit, description";

export function supabaseProductStore(admin: SupabaseClient): ProductStore {
  return {
    async findByExternalId(organizationId, source, externalId) {
      const { data } = await admin
        .from("products")
        .select(SELECT)
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      return (data as ExistingProduct | null) ?? null;
    },

    async findBySku(organizationId, sku) {
      const { data } = await admin
        .from("products")
        .select(SELECT)
        .eq("organization_id", organizationId)
        .eq("sku", sku)
        .limit(1)
        .maybeSingle();
      return (data as ExistingProduct | null) ?? null;
    },

    async update(id, patch) {
      const { error } = await admin.from("products").update(patch).eq("id", id);
      if (error) throw new Error(`update product: ${error.message}`);
    },

    async create(row) {
      const { data, error } = await admin.from("products").insert(row).select("id").single();
      if (error) throw new Error(`create product: ${error.message}`);
      return data.id as string;
    },
  };
}
