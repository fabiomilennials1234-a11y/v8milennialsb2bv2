import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PipePropostaRow = Tables<"pipe_propostas">;

/**
 * Fetch the lead's most recent pipe_propostas entry (or null when the lead
 * isn't in the Propostas pipe yet).
 *
 * Lê da projeção canônica `negocio_projetado` (funil_sistema = "propostas"),
 * que substitui o espelho pipe_propostas.
 */
export function usePipePropostaByLeadId(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["pipe_propostas_by_lead", leadId],
    enabled: !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<PipePropostaRow | null> => {
      if (!leadId) return null;
      const { data, error } = await supabase
        .from("negocio_projetado")
        // Alias do PostgREST: o consumidor lê `status`, a projeção chama `stage_key`.
        .select("*, status:stage_key")
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
