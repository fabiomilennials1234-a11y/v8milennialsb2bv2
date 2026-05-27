import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SuggestionType = "response" | "objection_handling" | "tone_alert" | "battle_card" | "upsell_opportunity";

export interface CoachingSuggestion {
  id: string;
  conversation_id: string;
  suggestion_type: SuggestionType;
  content: string;
  context_message_id: string | null;
  was_used: boolean;
  dismissed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function useCoachingSuggestions(conversationId: string | null) {
  return useQuery<CoachingSuggestion[]>({
    queryKey: ["coaching-suggestions", conversationId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("coaching_suggestions")
        .select("*")
        .eq("conversation_id", conversationId!)
        .eq("dismissed", false)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as CoachingSuggestion[];
    },
    enabled: !!conversationId,
    refetchInterval: 30_000,
  });
}

export function useMarkSuggestionUsed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await (supabase.from as any)("coaching_suggestions")
        .update({ was_used: true })
        .eq("id", suggestionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coaching-suggestions"] });
    },
  });
}

export function useDismissSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await (supabase.from as any)("coaching_suggestions")
        .update({ dismissed: true })
        .eq("id", suggestionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coaching-suggestions"] });
    },
  });
}
