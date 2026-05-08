import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ActionType = "call" | "email" | "meeting" | "follow_up" | "send_proposal" | "escalate" | "other";

export interface NextBestAction {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  deal_id: string | null;
  action_type: ActionType;
  title: string;
  reason: string;
  priority: number;
  due_by: string | null;
  metadata: Record<string, unknown>;
}

export function useNextBestActions(limit = 10) {
  return useQuery<NextBestAction[]>({
    queryKey: ["next-best-actions", limit],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_next_best_actions", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as NextBestAction[];
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCompleteAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (actionId: string) => {
      const { error } = await (supabase.from as any)("next_best_actions")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", actionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ação concluída");
      queryClient.invalidateQueries({ queryKey: ["next-best-actions"] });
    },
  });
}

export function useDismissAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (actionId: string) => {
      const { error } = await (supabase.from as any)("next_best_actions")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", actionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["next-best-actions"] });
    },
  });
}
