/**
 * LeadProfileBuilder — enriched lead data for copilot prompt injection.
 *
 * Loads: lead basics + custom fields + upsell + confirmacao + propostas + campaign.
 * Derives: closedDeals, activeProposals, isExistingClient.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPipeEntry } from "../pipeline-adapter.ts";

export class LeadProfileBuilder {
  constructor(private supabase: SupabaseClient) {}

  async build(leadId: string): Promise<Record<string, unknown> | null> {
    try {
      const { data: lead, error: leadError } = await this.supabase
        .from("leads")
        .select(`
          id, name, phone, email, company, origin, rating, segment,
          faturamento, urgency, notes, pipe_whatsapp, organization_id,
          created_at, updated_at
        `)
        .eq("id", leadId)
        .single();

      if (leadError || !lead) {
        if (leadError) console.warn("[LeadProfileBuilder] error:", leadError.message);
        return null;
      }

      const orgId = (lead as Record<string, unknown>).organization_id as string;

      const [customFieldsRes, upsellRes, confirmacaoEntry, propostasEntry, campanhaRes] = await Promise.all([
        this.supabase
          .from("lead_custom_field_values")
          .select(`value, field:lead_custom_fields(id, field_name, field_type)`)
          .eq("lead_id", leadId),
        this.supabase
          .from("upsell_clients")
          .select("tipo_cliente_tempo, gestao_stage, potencial, is_active")
          .eq("lead_id", leadId)
          .maybeSingle(),
        getPipeEntry(this.supabase, leadId, orgId, "confirmacao"),
        getPipeEntry(this.supabase, leadId, orgId, "propostas"),
        this.supabase
          .from("campanha_leads")
          .select("stage_id, campanha_id, campanha_stages(name)")
          .eq("lead_id", leadId)
          .limit(1)
          .maybeSingle(),
      ]);

      const customFields: Record<string, string> = {};
      const cfData = customFieldsRes.data as Array<{ value?: string; field?: { field_name?: string } }> | null;
      if (cfData && cfData.length > 0) {
        for (const cfv of cfData) {
          if (cfv.field?.field_name && cfv.value) {
            customFields[cfv.field.field_name] = cfv.value;
          }
        }
      }

      const upsellData = upsellRes.data as { tipo_cliente_tempo?: string; gestao_stage?: string; potencial?: string; is_active?: boolean } | null;
      const confMeta = (confirmacaoEntry?.metadata ?? {}) as Record<string, unknown>;
      const propMeta = (propostasEntry?.metadata ?? {}) as Record<string, unknown>;
      const campanhaData = campanhaRes.data as { campanha_id?: string; campanha_stages?: { name?: string } } | null;

      const propostasHistory = propostasEntry
        ? [{
            id: propostasEntry.id,
            status: propostasEntry.stage_key,
            sale_value: (propMeta.sale_value as number) ?? null,
            product_type: (propMeta.product_type as string) ?? null,
            closed_at: propostasEntry.closed_at,
            created_at: propostasEntry.created_at,
            product: null as { name: string } | null,
          }]
        : [];
      const closedDeals = propostasHistory.filter((p) => p.status === "vendido");
      const activeProposals = propostasHistory.filter(
        (p) => p.status !== "vendido" && p.status !== "perdido",
      );

      return {
        ...(lead as Record<string, unknown>),
        customFields,
        upsell_base_stage: upsellData?.tipo_cliente_tempo ?? null,
        upsell_gestao_stage: upsellData?.gestao_stage ?? null,
        upsell_potencial: upsellData?.potencial ?? null,
        upsell_is_active: upsellData?.is_active ?? null,
        confirmacao_status: confirmacaoEntry?.stage_key ?? null,
        confirmacao_meeting_date: (confMeta.meeting_date as string) ?? null,
        confirmacao_is_confirmed: (confMeta.is_confirmed as boolean) ?? null,
        propostas_status: propostasEntry?.stage_key ?? null,
        propostas_sale_value: (propMeta.sale_value as number) ?? null,
        propostas_product_type: (propMeta.product_type as string) ?? null,
        campanha_stage: campanhaData?.campanha_stages?.name ?? null,
        campanha_id: campanhaData?.campanha_id ?? null,
        closed_deals: closedDeals,
        active_proposals: activeProposals,
        is_existing_client: closedDeals.length > 0,
      };
    } catch (e) {
      console.error("[LeadProfileBuilder] exception:", e);
      return null;
    }
  }
}
