/**
 * Hook para "O que fazer hoje" — prioridades diárias do vendedor
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────

export interface PriorityLead {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  qualification_score: number;
  updated_at: string;
  pipe_type: string | null;
  pipe_status: string | null;
  last_action_at: string | null;
}

export interface PriorityFollowUp {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  priority: string;
  source_pipe: string | null;
  days_overdue: number;
  lead: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
  } | null;
}

export interface DailyPrioritiesData {
  leads_sem_acao: PriorityLead[];
  followups_vencidos: PriorityFollowUp[];
  leads_quentes: PriorityLead[];
  generated_at: string;
}

// ─── Main Hook ───────────────────────────────────────────

const FIVE_MINUTES = 5 * 60 * 1000;

export function useDailyPriorities() {
  const query = useQuery({
    queryKey: ["daily-priorities"],
    queryFn: async (): Promise<DailyPrioritiesData> => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-daily-priorities`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });

  const totalPending =
    (query.data?.leads_sem_acao?.length ?? 0) +
    (query.data?.followups_vencidos?.length ?? 0) +
    (query.data?.leads_quentes?.length ?? 0);

  return {
    ...query,
    totalPending,
    lastUpdatedAt: query.data?.generated_at ?? null,
  };
}

// ─── Complete Follow-up Mutation ─────────────────────────

export function useCompleteFollowUpFromPriorities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (followUpId: string) => {
      const { error } = await supabase
        .from("follow_ups")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", followUpId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-priorities"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}
