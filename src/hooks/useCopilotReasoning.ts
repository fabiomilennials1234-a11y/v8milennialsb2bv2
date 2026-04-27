/**
 * RC.6: Hook que lê chains-of-thought capturadas em runtime_logs
 * (action='reasoning', module='copilot').
 *
 * Filtros: organização, agente (triggered_by), entidade (conversation_id),
 * janela de datas. Ordenado desc por created_at.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CopilotReasoningRow {
  id: string;
  organization_id: string | null;
  module: string;
  action: string;
  status: string;
  entity_type: string | null;
  entity_id: string | null;
  triggered_by: string | null;
  reasoning: string | null;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  llm_model: string | null;
  payload_snapshot: Record<string, unknown> | null;
  created_at: string;
}

export interface CopilotReasoningFilters {
  organizationId?: string;
  agentId?: string;
  conversationId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export function useCopilotReasoning(filters: CopilotReasoningFilters = {}) {
  return useQuery({
    queryKey: ["copilot-reasoning", filters],
    queryFn: async (): Promise<CopilotReasoningRow[]> => {
      let query = supabase
        .from("runtime_logs")
        .select(
          "id, organization_id, module, action, status, entity_type, entity_id, triggered_by, reasoning, duration_ms, prompt_tokens, completion_tokens, llm_model, payload_snapshot, created_at",
        )
        .eq("module", "copilot")
        .eq("action", "reasoning")
        .not("reasoning", "is", null)
        .order("created_at", { ascending: false });

      if (filters.organizationId) {
        query = query.eq("organization_id", filters.organizationId);
      }
      if (filters.agentId) {
        query = query.eq("triggered_by", filters.agentId);
      }
      if (filters.conversationId) {
        query = query.eq("entity_id", filters.conversationId);
      }
      if (filters.startDate) {
        query = query.gte("created_at", filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte("created_at", filters.endDate);
      }

      query = query.limit(filters.limit ?? 100);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as CopilotReasoningRow[];
    },
    staleTime: 60 * 1000,
  });
}
