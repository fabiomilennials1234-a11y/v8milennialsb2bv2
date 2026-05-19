import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PipeConfirmacaoRow = Tables<"pipe_confirmacao">;

/**
 * Fetch the lead's most recent pipe_confirmacao entry (or null when the lead
 * isn't in the Confirmação pipe yet).
 *
 * Reads from the compat view over pipeline_entries (migration 20260983).
 * The view exposes legacy columns including `status` (= stage_key),
 * `meeting_date`, `responsible_id`, etc.
 */
export function usePipeConfirmacaoByLeadId(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["pipe_confirmacao_by_lead", leadId],
    enabled: !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<PipeConfirmacaoRow | null> => {
      if (!leadId) return null;
      const { data, error } = await supabase
        .from("pipe_confirmacao")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as PipeConfirmacaoRow | null) ?? null;
    },
  });
}
