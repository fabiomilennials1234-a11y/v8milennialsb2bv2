import type { ActionInput, ActionResult } from "./types.ts";
import { getPipeEntry } from "../pipeline-adapter.ts";

/**
 * create_deal — cria um negócio (`deals`) vinculado ao lead da execução.
 *
 * Guardas:
 * - lead obrigatório (o negócio nasce vinculado — `source_lead_id`)
 * - `dealSkipIfOpenExists` (default true): não cria segundo negócio ABERTO para o lead
 * - `metadata.workflow_execution_id` marca a origem → o trigger `deal_created`
 *   propaga como parent execution e o chain_depth (máx. 5) corta o laço
 *   create_deal → deal_created → create_deal.
 */
export async function createDeal(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "create_deal requires a lead in the execution", retryable: false };
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, name, company, responsible_id, sdr_id, closer_id, sale_responsible_id, pre_sale_responsible_id")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (leadError) return { success: false, error: leadError.message };
  if (!lead) return { success: false, error: `Lead ${leadId} not found in org`, retryable: false };

  // ── Dedup: negócio aberto já existente ──
  const skipIfOpen = params.dealSkipIfOpenExists !== false;
  if (skipIfOpen) {
    const { data: existing } = await supabase
      .from("deals")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_lead_id", leadId)
      .is("won", null)
      .is("deleted_at", null)
      .limit(1);

    if (existing?.length) {
      return {
        success: true,
        message: `Skipped: lead already has an open deal (${existing[0].id})`,
        data: { deal_id: existing[0].id, skipped: true },
      };
    }
  }

  // ── Título (já resolvido pelo router; fallback defensivo) ──
  const title =
    (params.dealTitleTemplate as string)?.trim() ||
    `Negócio — ${lead.name ?? lead.company ?? "sem nome"}`;

  // ── Valor: fixo ou o valor da proposta (pipeline_entries propostas → metadata.sale_value) ──
  let value = 0;
  if (params.dealValueMode === "proposal") {
    const propEntry = await getPipeEntry(supabase, leadId, organizationId, "propostas");
    const saleValue = (propEntry?.metadata as Record<string, unknown> | undefined)?.sale_value;
    value = Number(saleValue ?? 0) || 0;
  } else {
    value = Number(params.dealValue ?? 0) || 0;
  }

  // ── Responsável ──
  const ownerId =
    params.dealOwnerMode === "specific"
      ? ((params.dealOwnerId as string) || null)
      : (lead.responsible_id ||
         lead.sale_responsible_id ||
         lead.closer_id ||
         lead.pre_sale_responsible_id ||
         lead.sdr_id ||
         null);

  // ── Previsão de fechamento ──
  const closeDays = Number(params.dealExpectedCloseDays ?? 0) || 0;
  const expectedCloseDate =
    closeDays > 0
      ? new Date(Date.now() + closeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null;

  const probabilityRaw = Number(params.dealProbability ?? 50);
  const probability = Number.isFinite(probabilityRaw)
    ? Math.min(100, Math.max(0, Math.round(probabilityRaw)))
    : 50;

  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      organization_id: organizationId,
      title,
      value,
      probability,
      owner_id: ownerId,
      source_lead_id: leadId,
      expected_close_date: expectedCloseDate,
      notes: (params.dealNotes as string) || null,
      metadata: {
        created_by: "workflow",
        workflow_execution_id: (params._executionId as string) ?? null,
      },
    })
    .select("id, title, value")
    .single();

  if (error) return { success: false, error: error.message };

  return {
    success: true,
    message: `Deal "${deal.title}" created`,
    data: {
      deal_id: deal.id,
      negocio_id: deal.id,
      negocio_titulo: deal.title,
      negocio_valor: deal.value,
    },
  };
}
