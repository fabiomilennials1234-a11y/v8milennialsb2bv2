import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

export interface LeadScore {
  id: string;
  lead_id: string;
  score: number;
  factors: Record<string, string>;
  predicted_conversion: number;
  recommended_action: string | null;
  last_calculated: string;
}

export function useLeadScores() {
  useRealtimeSubscription("lead_scores", ["lead_scores"]);

  return useQuery({
    queryKey: ["lead_scores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_scores")
        .select("*")
        .order("score", { ascending: false });

      if (error) throw error;
      return data as LeadScore[];
    },
  });
}

export function useLeadScore(leadId: string | undefined) {
  return useQuery({
    queryKey: ["lead_scores", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      
      const { data, error } = await supabase
        .from("lead_scores")
        .select("*")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (error) throw error;
      return data as LeadScore | null;
    },
    enabled: !!leadId,
  });
}

export function useCalculateLeadScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadId: string) => {
      const { data, error } = await supabase.functions.invoke("calculate-lead-score", {
        body: { lead_id: leadId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_scores"] });
    },
  });
}

export function useCalculateBatchScores() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("calculate-lead-score", {
        body: { batch: true },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_scores"] });
    },
  });
}

// Map scores to lead_ids for easy lookup
export function useLeadScoresMap() {
  const { data: scores } = useLeadScores();
  
  const scoresMap = new Map<string, LeadScore>();
  scores?.forEach(score => {
    scoresMap.set(score.lead_id, score);
  });
  
  return scoresMap;
}
