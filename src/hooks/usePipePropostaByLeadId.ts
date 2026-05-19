import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PipePropostaRow = Tables<"pipe_propostas">;

/**
 * Fetch the lead's most recent pipe_propostas entry (or null when the lead
 * isn't in the Propostas pipe yet).
 *
 * Reads from the compat view over pipeline_entries (migration 20260983).
 */
export function usePipePropostaByLeadId(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["pipe_propostas_by_lead", leadId],
    enabled: !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<PipePropostaRow | null> => {
      if (!leadId) return null;
      const { data, error } = await supabase
        .from("pipe_propostas")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as PipePropostaRow | null) ?? null;
    },
  });
}
