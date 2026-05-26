import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription, type RealtimeHandlers } from "./useRealtimeSubscription";
import { useOrganization } from "@/modules/identity";
export type PipelineType = "whatsapp" | "confirmacao" | "propostas";

const LEAD_SELECT = `
  id, name, company, email, phone, rating, origin, segment, faturamento, urgency, notes, compromisso_date, ai_disabled,
  avatar_url, pre_qualification_tier, qualification_tier,
  sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
  responsible:team_members!leads_responsible_id_fkey(id, name, avatar_url),
  sdr:team_members!leads_sdr_id_fkey(id, name, avatar_url),
  closer:team_members!leads_closer_id_fkey(id, name, avatar_url),
  pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name, avatar_url),
  sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name, avatar_url),
  lead_tags(tag:tags(id, name, color))
`;

const realtimeHandlers: RealtimeHandlers = {
  onUpdate: (updated, oldData) =>
    oldData.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item
    ),
  onDelete: (deleted, oldData) =>
    oldData.filter((item) => item.id !== deleted.id),
};

/**
 * Idempotent create for `pipeline_entries`.
 *
 * `pipeline_entries` has `UNIQUE (pipeline_id, lead_id) WHERE lead_id IS NOT NULL`.
 * Multiple call sites (Kanban move, modals, auto-create on `compareceu`) can race
 * or repeat the create. To keep "Criar Proposta" idempotent we pre-check, then
 * fall back to fetching the existing row on a 23505 race.
 *
 * Returns `{ entry, created }` so the caller can decide whether to fire
 * follow-up automations (only on `created`).
 */
export async function findOrCreatePipelineEntry(params: {
  pipelineId: string;
  leadId: string;
  organizationId: string;
  stageKey: string;
  assignedTo: string | null;
  metadata: Record<string, unknown>;
  notes?: string | null;
}): Promise<{ entry: any; created: boolean }> {
  const { pipelineId, leadId, organizationId, stageKey, assignedTo, metadata, notes } = params;

  const { data: existing } = await supabase
    .from("pipeline_entries")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (existing) return { entry: existing, created: false };

  const insertPayload: Record<string, unknown> = {
    pipeline_id: pipelineId,
    lead_id: leadId,
    stage_key: stageKey,
    assigned_to: assignedTo,
    organization_id: organizationId,
    metadata,
  };
  if (notes !== undefined) insertPayload.notes = notes;

  const { data, error } = await supabase
    .from("pipeline_entries")
    .insert(insertPayload)
    .select()
    .single();

  if (!error) return { entry: data, created: true };

  if ((error as { code?: string }).code === "23505") {
    const { data: raced } = await supabase
      .from("pipeline_entries")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .eq("lead_id", leadId)
      .maybeSingle();
    if (raced) return { entry: raced, created: false };
  }

  throw error;
}

export function usePipelineId(slug: PipelineType) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipeline_id", slug, organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data } = await supabase
        .from("pipelines")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("slug", slug)
        .eq("type", "system")
        .maybeSingle();

      if (data?.id) return data.id;

      await supabase.rpc("create_default_pipelines", { p_org_id: organizationId });

      const { data: created } = await supabase
        .from("pipelines")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("slug", slug)
        .eq("type", "system")
        .maybeSingle();

      return created?.id ?? null;
    },
    enabled: isReady && !!organizationId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function flattenMetadata(entry: any) {
  const meta = (entry.metadata as Record<string, any>) ?? {};
  return {
    ...entry,
    status: entry.stage_key,
    sdr_id: meta.sdr_id ?? entry.lead?.sdr_id ?? null,
    responsible_id: meta.responsible_id ?? entry.lead?.responsible_id ?? null,
    closer_id: meta.closer_id ?? entry.lead?.closer_id ?? null,
    pre_sale_responsible_id: meta.pre_sale_responsible_id ?? null,
    sale_responsible_id: meta.sale_responsible_id ?? null,
    scheduled_date: meta.scheduled_date ?? null,
    meeting_date: meta.meeting_date ?? null,
    meet_link: meta.meet_link ?? null,
    is_confirmed: meta.is_confirmed ?? false,
    sale_value: meta.sale_value ?? null,
    product_id: meta.product_id ?? null,
    product_type: meta.product_type ?? null,
    calor: meta.calor ?? null,
    loss_reason_id: meta.loss_reason_id ?? null,
    commitment_date: meta.commitment_date ?? null,
    contract_duration: meta.contract_duration ?? null,
    metrics_period_at: meta.metrics_period_at ?? null,
    responsible: entry.lead?.responsible ?? null,
    sdr: entry.lead?.sdr ?? null,
    closer: entry.lead?.closer ?? null,
    pre_sale_responsible: entry.lead?.pre_sale_responsible ?? null,
    sale_responsible: entry.lead?.sale_responsible ?? null,
    stage_entered_at: entry.stage_changed_at,
  };
}

export function usePipelineEntries(slug: PipelineType) {
  const { organizationId, isReady } = useOrganization();
  const { data: pipelineId } = usePipelineId(slug);

  useRealtimeSubscription("pipeline_entries", ["pipeline_entries", slug, organizationId], realtimeHandlers);

  return useQuery({
    queryKey: ["pipeline_entries", slug, organizationId, pipelineId],
    queryFn: async ({ signal }) => {
      if (!organizationId || !pipelineId) return [];

      const { data, error } = await supabase
        .from("pipeline_entries")
        .select(`*, lead:leads!pipeline_entries_lead_id_fkey(${LEAD_SELECT})`)
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false })
        .limit(500)
        .abortSignal(signal);

      if (error) throw error;

      const entries = (data ?? [])
        .filter((e: any) => e.lead != null)
        .map(flattenMetadata);

      if (slug === "propostas" && entries.length > 0) {
        const entryIds = entries.map((e: any) => e.id);

        const [productsRes, itemsRes] = await Promise.all([
          supabase
            .from("products")
            .select("id, name, type, ticket, ticket_minimo")
            .in("id", entries.map((e: any) => e.product_id).filter(Boolean)),
          supabase
            .from("pipe_proposta_items")
            .select("*, product:products(id, name, type, ticket, ticket_minimo)")
            .in("pipe_proposta_id", entryIds),
        ]);

        const productsMap = new Map((productsRes.data ?? []).map((p: any) => [p.id, p]));
        const itemsByProposta = new Map<string, any[]>();
        for (const item of (itemsRes.data ?? [])) {
          const arr = itemsByProposta.get(item.pipe_proposta_id) ?? [];
          arr.push(item);
          itemsByProposta.set(item.pipe_proposta_id, arr);
        }

        return entries.map((entry: any) => ({
          ...entry,
          product: entry.product_id ? productsMap.get(entry.product_id) ?? null : null,
          items: itemsByProposta.get(entry.id) ?? [],
        }));
      }

      return entries;
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 10 * 60 * 1000,
  });
}
