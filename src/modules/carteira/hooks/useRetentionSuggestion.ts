import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface RetentionSuggestion {
  action_type: string;
  message: string;
  reasoning: string;
  generated_at?: string;
}

export function useRetentionSuggestion(clientId: string | undefined) {
  return useQuery({
    queryKey: ["retention-suggestion", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("retention_suggestions")
        .select("action_type, message, reasoning, generated_at, expires_at")
        .eq("client_id", clientId!)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (error) throw error;
      return data as RetentionSuggestion | null;
    },
    enabled: !!clientId,
    staleTime: 60_000,
  });
}

export function useGenerateRetentionSuggestion() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await supabase.functions.invoke("suggest-retention-action", {
        body: { client_id: clientId },
      });
      if (error) throw error;
      return data as { suggestion: RetentionSuggestion; cached: boolean };
    },
    onSuccess: (_data, clientId) => {
      qc.invalidateQueries({ queryKey: ["retention-suggestion", clientId] });
    },
  });
}
