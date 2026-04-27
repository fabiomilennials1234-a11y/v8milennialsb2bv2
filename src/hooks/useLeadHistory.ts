import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type LeadHistory = Tables<"lead_history">;
export type LeadHistoryInsert = TablesInsert<"lead_history">;

export function useLeadHistory(leadId: string | undefined) {
  return useQuery({
    queryKey: ["lead_history", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      
      const { data, error } = await supabase
        .from("lead_history")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!leadId,
  });
}

export function useCreateLeadHistory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (history: LeadHistoryInsert) => {
      const { data, error } = await supabase
        .from("lead_history")
        .insert(history)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lead_history", data.lead_id] });
    },
  });
}
