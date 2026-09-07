import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import type { ProjectedPropostaPipe } from "@/integrations/supabase/projected-pipe-types";

export type PipePropostaRow = ProjectedPropostaPipe;

/**
 * Fetch the lead's most recent pipe_propostas entry (or null when the lead
 * isn't in the Propostas pipe yet).
 *
 * Lê da projeção canônica `negocio_projetado` (funil_sistema = "propostas"),
 * que substitui o espelho pipe_propostas.
 */
export function usePipePropostaByLeadId(leadId: string | null | undefined) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["pipe_propostas_by_lead", leadId, organizationId],
    enabled: !!leadId && !!organizationId,
    staleTime: 30_000,
    queryFn: async (): Promise<PipePropostaRow | null> => {
      if (!leadId || !organizationId) return null;
      const { data, error } = await supabase
        .from("negocio_projetado")
        // Alias do PostgREST: o consumidor lê `status`, a projeção chama `stage_key`.
        .select("*, status:stage_key")
        .eq("organization_id", organizationId)
        .eq("funil_sistema", "propostas")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as PipePropostaRow | null) ?? null;
    },
  });
}
