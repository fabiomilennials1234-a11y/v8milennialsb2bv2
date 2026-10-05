/**
 * Testes — a nota do avaliador automático (TE-5), por copilot.
 *
 * Resumo agregado no banco (`master_copilot_eval_summary`, migration
 * 20271105000300); os piores turnos de um copilot vêm direto da tabela,
 * pelo índice de `agent_id`.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAuth } from "./useMasterAuth";

export function useCopilotEvalSummary(days: number) {
  const { isMaster } = useMasterAuth();
  return useQuery({
    queryKey: ["master-copilot-eval-summary", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("master_copilot_eval_summary", { p_days: days });
      if (error) throw error;
      return data ?? [];
    },
    enabled: isMaster,
    staleTime: 5 * 60_000,
  });
}

export function useWorstTurns(agentId: string | null, days: number) {
  const { isMaster } = useMasterAuth();
  return useQuery({
    queryKey: ["master-copilot-worst-turns", agentId, days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("copilot_conversation_evaluations")
        .select("id, conversation_id, user_message, agent_response, score_overall, weaknesses, suggestion, evaluated_at")
        .eq("agent_id", agentId!)
        .gte("evaluated_at", since)
        .not("score_overall", "is", null)
        .order("score_overall", { ascending: true })
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
    enabled: isMaster && !!agentId,
  });
}
