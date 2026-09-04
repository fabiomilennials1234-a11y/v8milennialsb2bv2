import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTrackView } from "@/modules/platform/hooks/useTrackView";

/**
 * Visibility outcomes from the `can_view_lead(uuid)` RPC (migration
 * 20261030000002, PRD #284 issue #290) plus a client-only 'loading'
 * state used while the RPC is in flight or before a lead is selected.
 */
export type LeadVisibility =
  | "loading"
  | "exists"
  | "not_found"
  | "deleted"
  | "permission_denied";

export interface LeadVisibilityMetadata {
  organization_id?: string;
  master?: boolean;
  cross_org?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  reason?: string;
}

interface CanViewLeadRow {
  status: Exclude<LeadVisibility, "loading">;
  metadata: LeadVisibilityMetadata;
}

function normalizeRpcResponse(data: unknown): CanViewLeadRow | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as CanViewLeadRow) ?? null;
  return data as CanViewLeadRow;
}

export function useLeadDetail(leadId: string | null, isOpen: boolean) {
  const enabled = !!leadId && isOpen;

  // 1. Gate every downstream fetch on the visibility RPC.
  const visibilityQuery = useQuery({
    queryKey: ["lead-visibility", leadId],
    queryFn: async (): Promise<CanViewLeadRow> => {
      const { data, error } = await supabase.rpc("can_view_lead", {
        p_lead_id: leadId,
      });
      if (error) throw error;
      const row = normalizeRpcResponse(data);
      if (!row) {
        // RPC reachable but empty — treat as not_found to avoid
        // rendering a half-loaded modal.
        return { status: "not_found", metadata: {} };
      }
      return row;
    },
    enabled,
    staleTime: 30_000,
  });

  const visibility: LeadVisibility = !enabled
    ? "loading"
    : visibilityQuery.isLoading
      ? "loading"
      : (visibilityQuery.data?.status ?? "loading");

  const canFetchLead = visibility === "exists";

  // 2. Real lead row — only fetched when allowed.
  const leadQuery = useQuery({
    queryKey: ["lead-detail", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          responsible:team_members!leads_responsible_id_fkey(id, name),
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
          sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
          lead_tags(
            tag:tags(id, name, color)
          )
        `)
        .eq("id", leadId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: enabled && canFetchLead,
  });

  // 3. Pipeline membership — also gated on visibility.
  const pipelineQuery = useQuery({
    queryKey: ["lead-pipes", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      // Leituras na projeção canônica `negocio_projetado`, que substitui os
      // espelhos pipe_whatsapp / pipe_confirmacao / pipe_propostas /
      // custom_pipe_entries. O que o espelho chamava "status" a projeção chama
      // "stage_key"; os demais nomes de coluna são idênticos.
      const [whatsapp, confirmacao, propostas, customEntries, followUps] = await Promise.all([
        supabase.from("negocio_projetado").select("*").eq("funil_sistema", "whatsapp").eq("lead_id", leadId),
        supabase.from("negocio_projetado").select("*").eq("funil_sistema", "confirmacao").eq("lead_id", leadId),
        supabase.from("negocio_projetado").select("*").eq("funil_sistema", "propostas").eq("lead_id", leadId),
        supabase
          .from("negocio_projetado")
          // `is_active` entra no embed só para peneirar abaixo. Filtrar pela
          // coluna embutida (`.eq("pipeline.is_active", true)`) exigiria
          // `!inner`, e embed com filtro é justamente onde o PostgREST devolve
          // PGRST201 quando a relação fica ambígua — não vale o risco por uma
          // peneira de 1 linha.
          .select("*, stage:pipeline_stages(name, color), pipeline:pipelines(name, is_active)")
          // O espelho custom_pipe_entries era `pipeline_entries` juntado com
          // `pipelines` em `type = 'custom'` — na projeção isso é pipeline_type.
          .eq("pipeline_type", "custom")
          .eq("lead_id", leadId),
        supabase.from("follow_ups").select("*").eq("lead_id", leadId),
      ]);
      return {
        whatsapp: whatsapp.data || [],
        confirmacao: confirmacao.data || [],
        propostas: propostas.data || [],
        // Funil excluído não é membership — o painel do Lead listava o funil
        // "excluído" junto com os ativos porque nada aqui filtrava.
        // `!== false` e não `=== true`: a coluna é nullable e NULL significa
        // "nunca foi desativado" (o default é true). Só o `false` explícito
        // esconde o funil.
        customEntries: (customEntries.data || []).filter(
          (e) => e.pipeline?.is_active !== false,
        ),
        followUps: followUps.data || [],
      };
    },
    enabled: enabled && canFetchLead,
  });

  useTrackView(
    isOpen && leadId ? "lead" : undefined,
    isOpen ? (leadId ?? undefined) : undefined,
    leadQuery.data?.name,
  );

  return {
    visibility,
    metadata: visibilityQuery.data?.metadata ?? {},
    lead: canFetchLead ? (leadQuery.data ?? null) : null,
    isLoading: enabled && (visibilityQuery.isLoading || (canFetchLead && leadQuery.isLoading)),
    isFetching: visibilityQuery.isFetching || leadQuery.isFetching,
    failureCount: visibilityQuery.failureCount + leadQuery.failureCount,
    pipelineData: canFetchLead ? (pipelineQuery.data ?? null) : null,
    refetchLead: leadQuery.refetch,
    refetchVisibility: visibilityQuery.refetch,
  };
}
