/**
 * Hook para gerenciar regras de Kanban (goal, behavior, allowed/forbidden actions por etapa)
 *
 * CRUD de regras por etapa do funil WhatsApp.
 * Usado na aba "Regras" do AgentConfigModal.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { CopilotAgentKanbanRule } from "@/types/copilot";

export interface KanbanRuleForm {
  pipe_type: string;
  stage_name: string;
  goal: string;
  behavior: string;
  allowed_actions: string[];
  forbidden_actions: string[];
}

/**
 * Hook para buscar regras de Kanban do agente
 */
export function useAgentKanbanRules(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agent-kanban-rules", agentId],
    queryFn: async (): Promise<CopilotAgentKanbanRule[]> => {
      if (!agentId) throw new Error("Agent ID is required");

      const { data, error } = await supabase
        .from("copilot_agent_kanban_rules")
        .select("*")
        .eq("agent_id", agentId)
        .order("stage_name", { ascending: true });

      if (error) {
        console.error("Error fetching kanban rules:", error);
        throw error;
      }

      return (data || []) as CopilotAgentKanbanRule[];
    },
    enabled: !!agentId,
  });
}

/**
 * Hook para upsert em lote (DELETE all + INSERT das regras com goal ou behavior preenchido)
 */
export function useUpsertKanbanRules(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rules: KanbanRuleForm[]) => {
      const toInsert = rules.filter(
        (r) =>
          (r.goal && r.goal.trim()) ||
          (r.behavior && r.behavior.trim()) ||
          (r.allowed_actions && r.allowed_actions.length > 0) ||
          (r.forbidden_actions && r.forbidden_actions.length > 0)
      );

      const { error: deleteError } = await supabase
        .from("copilot_agent_kanban_rules")
        .delete()
        .eq("agent_id", agentId);

      if (deleteError) {
        console.error("Error deleting kanban rules:", deleteError);
        throw deleteError;
      }

      if (toInsert.length === 0) {
        return [];
      }

      const insertPayload = toInsert.map((r) => ({
        agent_id: agentId,
        pipe_type: r.pipe_type,
        stage_name: r.stage_name,
        goal: (r.goal || "").trim() || null,
        behavior: (r.behavior || "").trim() || null,
        allowed_actions: r.allowed_actions || [],
        forbidden_actions: r.forbidden_actions || [],
      }));

      const { data, error } = await supabase
        .from("copilot_agent_kanban_rules")
        .insert(insertPayload)
        .select();

      if (error) {
        console.error("Error inserting kanban rules:", error);
        throw error;
      }

      return (data || []) as CopilotAgentKanbanRule[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["agent-kanban-rules", agentId],
      });
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      toast.success("Regras por etapa salvas com sucesso!");
    },
    onError: (error: unknown) => {
      console.error("Error upserting kanban rules:", error);
      const msg =
        error instanceof Error ? error.message : "Erro ao salvar regras";
      toast.error("Erro ao salvar regras", { description: msg });
    },
  });
}
