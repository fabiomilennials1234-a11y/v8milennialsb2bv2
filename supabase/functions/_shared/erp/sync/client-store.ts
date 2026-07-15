/**
 * Supabase-backed ClientStore — the thin DB adapter behind upsertCanonicalClient.
 * All logic lives in upsert-client.ts; this file only speaks to Postgres.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ClientStore, ExistingClient } from "./upsert-client.ts";

const SELECT = "id, cnpj, phone, email, company, name";

export function supabaseClientStore(admin: SupabaseClient, source: string): ClientStore {
  return {
    async findByExternalId(organizationId, externalId) {
      const { data } = await admin
        .from("upsell_clients")
        .select(SELECT)
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      return (data as ExistingClient | null) ?? null;
    },

    async findByCnpj(organizationId, cnpj) {
      const { data } = await admin
        .from("upsell_clients")
        .select(SELECT)
        .eq("organization_id", organizationId)
        .eq("cnpj", cnpj)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as ExistingClient | null) ?? null;
    },

    async enrich(id, patch) {
      const { error } = await admin.from("upsell_clients").update(patch).eq("id", id);
      if (error) throw new Error(`enrich upsell_clients: ${error.message}`);
    },

    async createLead(organizationId, lead) {
      const { data, error } = await admin
        .from("leads")
        .insert({
          organization_id: organizationId,
          name: lead.name,
          company: lead.company,
          phone: lead.phone,
          email: lead.email,
          origin: "erp_omie",
        })
        .select("id")
        .single();
      if (error) throw new Error(`createLead: ${error.message}`);
      return data.id as string;
    },

    async createClient(row) {
      const { data, error } = await admin
        .from("upsell_clients")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(`createClient: ${error.message}`);
      return data.id as string;
    },
  };
}
