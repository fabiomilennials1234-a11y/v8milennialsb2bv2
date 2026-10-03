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
  /**
   * TOLERADO, NÃO USADO. "Lead quente" é `qualification_score >= 70`, e o score
   * do lead saiu do produto (decisão do CTO, 02/10). A edge
   * `get-daily-priorities` ainda calcula e devolve a lista — a limpeza do
   * backend é outra entrega —, então o campo continua no tipo para a resposta
   * não mentir sobre o que chega. A interface não mostra nem conta.
   */
  leads_quentes?: PriorityLead[];
  generated_at: string;
}

/**
 * Quantas sugestões a Revisão anuncia ("Sugestões (N)").
 *
 * Soma só o que a tela mostra: leads sem contato e follow-ups vencidos.
 * `leads_quentes` fica de fora de propósito — ver o campo acima.
 */
export function contarSugestoesDoDia(data: DailyPrioritiesData | undefined): number {
  return (data?.leads_sem_acao?.length ?? 0) + (data?.followups_vencidos?.length ?? 0);
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

  const totalPending = contarSugestoesDoDia(query.data);

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
