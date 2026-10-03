import { supabase } from "@/integrations/supabase/client";
import { applyLeadListFilters } from "./lead-list-filters";
import { isStageUuid } from "./export-columns";
import type { ExportLeadsOptions } from "./export-types";
import { VENTIMAIS_ORGANIZATION_ID, VENTIMAIS_EXPORT_FLAG, isVentimaisExportEnabled, type VentimaisExportData, type ExportLead, type ExportEntry } from "./ventimais-export";

const PAGE_SIZE = 500;
const ID_BATCH_SIZE = 200;
const LEAD_COLUMNS = "id, name, company, email, phone, faturamento, segment, urgency, notes, origin, responsible_id, compromisso_date, utm_campaign, utm_source, utm_medium, utm_content, utm_term, created_at, updated_at, metrics_period_at";

/** Pagina até o fim, com ordenação estável aplicada pelo chamador. */
export async function readExportPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
    // Continua mesmo se o servidor limitar a página a menos de PAGE_SIZE.
    from += data.length;
  }
}

/** null significa caminho antigo. Só consulta detalhes após validar org + flag + funil. */
export async function loadVentimaisExport(organizationId: string, options: ExportLeadsOptions): Promise<VentimaisExportData | null> {
  const pipelineId = options.stageFilter?.pipelineId ?? options.pipelineId;
  if (organizationId !== VENTIMAIS_ORGANIZATION_ID || options.format !== "xlsx" || !pipelineId) return null;
  const { data: org, error: orgError } = await supabase.from("organizations").select("feature_flags").eq("id", organizationId).single();
  if (orgError) throw new Error("Não foi possível verificar a configuração da exportação. Tente novamente.");
  const flags = org?.feature_flags;
  const flag = flags && typeof flags === "object" && !Array.isArray(flags) ? flags[VENTIMAIS_EXPORT_FLAG] : undefined;
  if (!isVentimaisExportEnabled(organizationId, flag)) return null;

  const { data: pipeline, error: pipelineError } = await supabase.from("pipelines")
    .select("id, name").eq("organization_id", organizationId).eq("id", pipelineId).eq("is_active", true).single();
  if (pipelineError || !pipeline) throw new Error("Kanban não encontrado nesta organização.");
  const limit = Math.max(0, Math.min(options.limit ?? 10_000, 50_000));
  if (!Number.isFinite(limit)) throw new Error("Quantidade inválida para exportação.");
  const entries: ExportEntry[] = [];
  const leads = new Map<string, ExportLead>();
  const selected = options.leadIds ? new Set(options.leadIds) : null;
  // A unidade aqui é o CARD, não o lead. Aplica recorte antes do limite.
  for (let from = 0; entries.length < limit;) {
    let query = supabase.from("pipeline_entries").select("*")
      .eq("organization_id", organizationId).eq("pipeline_id", pipelineId);
    if (options.stageFilter) query = isStageUuid(options.stageFilter.stageId)
      ? query.eq("stage_id", options.stageFilter.stageId)
      : query.eq("stage_key", options.stageFilter.stageId);
    const { data: page, error } = await query.order("created_at", { ascending: false }).order("id").range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!page?.length) break;
    from += page.length;
    const ids = [...new Set(page.flatMap(e => e.lead_id && (!selected || selected.has(e.lead_id)) ? [e.lead_id] : []))];
    for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
      const batch = ids.slice(i, i + ID_BATCH_SIZE);
      const leadRows = await readExportPages((start, end) => {
        let leadQuery = supabase.from("leads").select(LEAD_COLUMNS).eq("organization_id", organizationId).is("deleted_at", null).in("id", batch);
        if (options.listFilters) leadQuery = applyLeadListFilters(leadQuery, options.listFilters);
        return leadQuery.order("id").range(start, end);
      });
      for (const lead of leadRows) leads.set(lead.id, lead);
    }
    for (const entry of page) {
      if (entry.lead_id && leads.has(entry.lead_id) && (!selected || selected.has(entry.lead_id))) entries.push(entry);
      if (entries.length >= limit) break;
    }
  }
  const result: VentimaisExportData = { pipeline, entries, leads: [...leads.values()], deals: [], stages: [], members: [], comments: [], fields: [], fieldValues: [] };
  if (!entries.length) return result;
  result.stages = await readExportPages((from, to) => supabase.from("pipeline_stages")
    .select("id, pipeline_id, stage_key, name, stage_role").eq("organization_id", organizationId).eq("pipeline_id", pipelineId).order("id").range(from, to));
  result.members = await readExportPages((from, to) => supabase.from("team_members")
    .select("id, name").eq("organization_id", organizationId).order("id").range(from, to));
  result.fields = await readExportPages((from, to) => supabase.from("lead_custom_fields")
    .select("id, field_name").eq("organization_id", organizationId).order("display_order").order("id").range(from, to));

  const dealIds = [...new Set(entries.flatMap(e => e.deal_id ? [e.deal_id] : []))];
  for (let i = 0; i < dealIds.length; i += ID_BATCH_SIZE) {
    const batch = dealIds.slice(i, i + ID_BATCH_SIZE);
    result.deals.push(...await readExportPages((from, to) => supabase.from("deals")
      .select("id, title, value, currency, probability, expected_close_date, outcome, loss_reason, notes")
      .eq("organization_id", organizationId).is("deleted_at", null).in("id", batch).order("id").range(from, to)));
  }
  const entryIds = entries.map(e => e.id);
  for (let i = 0; i < entryIds.length; i += ID_BATCH_SIZE) {
    const batch = entryIds.slice(i, i + ID_BATCH_SIZE);
    result.comments.push(...await readExportPages((from, to) => supabase.from("lead_comments")
      .select("id, organization_id, lead_id, pipeline_entry_id, body, created_at, updated_at, deleted_at, author_team_member_id")
      .eq("organization_id", organizationId).is("deleted_at", null).in("pipeline_entry_id", batch).order("id").range(from, to)));
  }
  const leadIds = [...new Set(entries.flatMap(e => e.lead_id ? [e.lead_id] : []))];
  for (let i = 0; i < leadIds.length; i += ID_BATCH_SIZE) {
    const batch = leadIds.slice(i, i + ID_BATCH_SIZE);
    result.comments.push(...await readExportPages((from, to) => supabase.from("lead_comments")
      .select("id, organization_id, lead_id, pipeline_entry_id, body, created_at, updated_at, deleted_at, author_team_member_id")
      .eq("organization_id", organizationId).is("deleted_at", null).is("pipeline_entry_id", null).in("lead_id", batch).order("id").range(from, to)));
    if (result.fields.length) {
      // A tabela de valores não tem organization_id: ambos os pais são da org.
      result.fieldValues.push(...await readExportPages((from, to) => supabase.from("lead_custom_field_values")
        .select("lead_id, field_id, value, leads!inner(organization_id), lead_custom_fields!inner(organization_id)")
        .eq("leads.organization_id", organizationId).eq("lead_custom_fields.organization_id", organizationId)
        .in("lead_id", batch).order("id").range(from, to)));
    }
  }
  return result;
}
