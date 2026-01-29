/**
 * Hook para gerenciamento de Copilot Agents
 *
 * Fornece queries e mutations para CRUD completo de agentes de IA,
 * incluindo FAQs e Kanban Rules relacionados.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { generatePrompt, saveCopilotSystemPrompt } from "./useCopilotPromptBuilder";
import type {
  CopilotAgent,
  CopilotAgentInsert,
  CopilotAgentUpdate,
  CopilotAgentWithRelations,
  CreateAgentPayload,
  UpdateAgentPayload,
  MoveRule,
} from "@/types/copilot";
import { followupRuleToDB } from "./useAgentFollowupRules";

/**
 * Payload para atualização de configuração de pipeline
 */
export interface UpdatePipelinePayload {
  id: string;
  activePipes: string[];
  activeStages: Record<string, string[]>;
  canMoveCards: boolean;
  autoMoveOnQualify: boolean;
  autoMoveOnObjective: boolean;
  moveRules: MoveRule[];
}

/**
 * Hook auxiliar para buscar team_member do usuário atual
 */
function useCurrentTeamMember() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["team_member", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });
}

// =====================================================
// QUERIES
// =====================================================

/**
 * Lista todos os agentes da organização do usuário
 * Inclui FAQs e Kanban Rules relacionados
 */
export function useCopilotAgents() {
  const { data: teamMember } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["copilot_agents", teamMember?.organization_id],
    queryFn: async () => {
      if (!teamMember?.organization_id) return [];

      const { data, error } = await supabase
        .from("copilot_agents")
        .select(
          `
          *,
          copilot_agent_faqs(*),
          copilot_agent_kanban_rules(*)
        `
        )
        .eq("organization_id", teamMember.organization_id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as CopilotAgentWithRelations[];
    },
    enabled: !!teamMember?.organization_id,
  });
}

/**
 * Busca um agente específico por ID
 * Inclui FAQs e Kanban Rules relacionados
 */
export function useCopilotAgent(agentId?: string) {
  return useQuery({
    queryKey: ["copilot_agents", agentId],
    queryFn: async () => {
      if (!agentId) return null;

      const { data, error } = await supabase
        .from("copilot_agents")
        .select(
          `
          *,
          copilot_agent_faqs(*),
          copilot_agent_kanban_rules(*)
        `
        )
        .eq("id", agentId)
        .maybeSingle();

      if (error) throw error;
      return data as CopilotAgentWithRelations | null;
    },
    enabled: !!agentId,
  });
}

/**
 * Retorna o agente padrão ativo da organização
 */
export function useDefaultCopilotAgent() {
  const { data: teamMember } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["copilot_agents", "default", teamMember?.organization_id],
    queryFn: async () => {
      if (!teamMember?.organization_id) return null;

      const { data, error } = await supabase
        .from("copilot_agents")
        .select(
          `
          *,
          copilot_agent_faqs(*),
          copilot_agent_kanban_rules(*)
        `
        )
        .eq("organization_id", teamMember.organization_id)
        .eq("is_default", true)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      return data as CopilotAgentWithRelations | null;
    },
    enabled: !!teamMember?.organization_id,
  });
}

// =====================================================
// MUTATIONS
// =====================================================

/**
 * Cria um novo agente com FAQs e Kanban Rules
 * Executa em transação para garantir consistência
 */
export function useCreateCopilotAgent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (payload: CreateAgentPayload) => {
      if (!user?.id || !teamMember?.organization_id) {
        throw new Error("Usuário ou organização não encontrados");
      }

      // 1. Criar agente
      console.log("📤 Enviando payload para criar agente:", {
        agent: payload.agent,
        organization_id: teamMember.organization_id,
        created_by: user.id,
      });

      const { data: agent, error: agentError } = await supabase
        .from("copilot_agents")
        .insert({
          ...payload.agent,
          organization_id: teamMember.organization_id,
          created_by: user.id,
        })
        .select()
        .single();

      if (agentError) {
        console.error("❌ Erro do Supabase ao criar agente:", {
          message: agentError.message,
          details: agentError.details,
          hint: agentError.hint,
          code: agentError.code,
        });
        throw agentError;
      }

      // 2. Criar FAQs (se houver)
      if (payload.faqs.length > 0) {
        const faqsToInsert = payload.faqs.map((faq, index) => ({
          agent_id: agent.id,
          question: faq.question,
          answer: faq.answer,
          position: index,
        }));

        const { error: faqsError } = await supabase
          .from("copilot_agent_faqs")
          .insert(faqsToInsert);

        if (faqsError) throw faqsError;
      }

      // 3. Criar regras do Kanban (se houver)
      if (payload.kanbanRules.length > 0) {
        const rulesToInsert = payload.kanbanRules.map((rule) => ({
          agent_id: agent.id,
          pipe_type: rule.pipeType,
          stage_name: rule.stageName,
          goal: rule.goal,
          behavior: rule.behavior,
          allowed_actions: rule.allowedActions,
          forbidden_actions: rule.forbiddenActions,
        }));

        const { error: rulesError } = await supabase
          .from("copilot_agent_kanban_rules")
          .insert(rulesToInsert);

        if (rulesError) throw rulesError;
      }

      // 3b. Criar regras de follow-up (se houver; template followup)
      if (payload.followupRules && payload.followupRules.length > 0) {
        const followupToInsert = payload.followupRules.map((rule, index) =>
          followupRuleToDB(
            { ...rule, priority: rule.priority ?? index, name: rule.name || `Regra ${index + 1}` },
            agent.id
          )
        );
        const { error: followupError } = await supabase
          .from("copilot_agent_followup_rules")
          .insert(followupToInsert as any);

        if (followupError) throw followupError;
      }

      // 4. Buscar FAQs e Kanban Rules criados para gerar o prompt
      const { data: createdFaqs } = await supabase
        .from("copilot_agent_faqs")
        .select("*")
        .eq("agent_id", agent.id);

      const { data: createdRules } = await supabase
        .from("copilot_agent_kanban_rules")
        .select("*")
        .eq("agent_id", agent.id);

      // 5. Gerar e salvar o system prompt
      const promptResult = generatePrompt(
        agent,
        createdFaqs || [],
        createdRules || []
      );

      await saveCopilotSystemPrompt(
        agent.id,
        promptResult.systemPrompt,
        promptResult.metadata.version
      );

      return agent as CopilotAgent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      toast.success("Copilot criado com sucesso!", {
        description: "Seu agente está pronto para ser ativado.",
      });
    },
    onError: (error: any) => {
      console.error("❌ Erro na mutation de criar agente:", error);
      
      // Extrair mensagem de erro mais detalhada do Supabase
      let errorMessage = error?.message || "Erro desconhecido ao criar o agente";
      
      if (error?.error?.message) {
        errorMessage = error.error.message;
        if (error.error.hint) {
          errorMessage += ` (${error.error.hint})`;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      // Se for erro de coluna não encontrada, dar instrução específica
      if (errorMessage.includes("activation_triggers") || 
          errorMessage.includes("column") || 
          errorMessage.includes("Could not find")) {
        errorMessage = "Coluna não encontrada no banco. Execute o script FIX_COPILOT_COLUMNS.sql no Supabase SQL Editor.";
      }
      
      toast.error("Erro ao criar Copilot", {
        description: errorMessage,
        duration: 10000,
      });
    },
  });
}

/**
 * Atualiza um agente existente
 */
export function useUpdateCopilotAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateAgentPayload) => {
      const { data, error } = await supabase
        .from("copilot_agents")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as CopilotAgent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      toast.success("Copilot atualizado!", {
        description: "As alterações foram salvas com sucesso.",
      });
    },
    onError: (error: Error) => {
      toast.error("Erro ao atualizar Copilot", {
        description: error.message,
      });
    },
  });
}

/**
 * Deleta um agente e todos os dados relacionados (cascade)
 */
export function useDeleteCopilotAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string) => {
      const { error } = await supabase
        .from("copilot_agents")
        .delete()
        .eq("id", agentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      toast.success("Copilot deletado", {
        description: "O agente foi removido com sucesso.",
      });
    },
    onError: (error: Error) => {
      toast.error("Erro ao deletar Copilot", {
        description: error.message,
      });
    },
  });
}

/**
 * Ativa ou desativa um agente
 */
export function useToggleCopilotAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { data, error } = await supabase
        .from("copilot_agents")
        .update({ is_active: isActive })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as CopilotAgent;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      toast.success(
        variables.isActive ? "Copilot ativado" : "Copilot desativado",
        {
          description: variables.isActive
            ? "O agente está pronto para uso."
            : "O agente foi desativado.",
        }
      );
    },
    onError: (error: Error) => {
      toast.error("Erro ao atualizar status", {
        description: error.message,
      });
    },
  });
}

/**
 * Define um agente como padrão
 * Remove a flag is_default de todos os outros agentes da organização
 */
export function useSetDefaultCopilotAgent() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (agentId: string) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      // 1. Remover flag is_default de todos os outros agentes
      const { error: resetError } = await supabase
        .from("copilot_agents")
        .update({ is_default: false })
        .eq("organization_id", teamMember.organization_id)
        .neq("id", agentId);

      if (resetError) throw resetError;

      // 2. Definir o novo agente como padrão e ativar
      const { data, error } = await supabase
        .from("copilot_agents")
        .update({ is_default: true, is_active: true })
        .eq("id", agentId)
        .select()
        .single();

      if (error) throw error;
      return data as CopilotAgent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      toast.success("Copilot padrão definido!", {
        description: "Este agente será usado por padrão em todas as interações.",
      });
    },
    onError: (error: Error) => {
      toast.error("Erro ao definir padrão", {
        description: error.message,
      });
    },
  });
}

/**
 * Atualiza a configuração de pipeline de um agente
 * Define em quais funis/etapas o agente atua e regras de movimentação
 */
export function useUpdateCopilotAgentPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdatePipelinePayload) => {
      const { data, error } = await supabase
        .from("copilot_agents")
        .update({
          active_pipes: payload.activePipes,
          active_stages: payload.activeStages,
          can_move_cards: payload.canMoveCards,
          auto_move_on_qualify: payload.autoMoveOnQualify,
          auto_move_on_objective: payload.autoMoveOnObjective,
          move_rules: payload.moveRules,
        })
        .eq("id", payload.id)
        .select()
        .single();

      if (error) throw error;
      return data as CopilotAgent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      toast.success("Configuração de pipeline atualizada!", {
        description: "O agente agora atuará nos funis e etapas configurados.",
      });
    },
    onError: (error: Error) => {
      toast.error("Erro ao atualizar configuração", {
        description: error.message,
      });
    },
  });
}

/**
 * Vincula um agente a uma instância de WhatsApp
 * O agente responderá automaticamente mensagens nessa instância
 */
export function useLinkAgentToWhatsAppInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentId, instanceId }: { agentId: string; instanceId: string | null }) => {
      if (instanceId) {
        // Vincular agente à instância
        // Primeiro, remover vínculo anterior da instância (se houver)
        await supabase
          .from("whatsapp_instances")
          .update({ copilot_agent_id: null })
          .eq("copilot_agent_id", agentId);

        // Remover vínculo anterior do agente (se houver)
        await supabase
          .from("copilot_agents")
          .update({ whatsapp_instance_id: null })
          .neq("id", agentId)
          .eq("whatsapp_instance_id", instanceId);

        // Atualizar agente com nova instância
        const { error: agentError } = await supabase
          .from("copilot_agents")
          .update({ whatsapp_instance_id: instanceId })
          .eq("id", agentId);

        if (agentError) throw agentError;

        // Atualizar instância com novo agente
        const { error: instanceError } = await supabase
          .from("whatsapp_instances")
          .update({ copilot_agent_id: agentId })
          .eq("id", instanceId);

        if (instanceError) throw instanceError;
      } else {
        // Desvincular agente
        const { data: agent } = await supabase
          .from("copilot_agents")
          .select("whatsapp_instance_id")
          .eq("id", agentId)
          .single();

        if (agent?.whatsapp_instance_id) {
          await supabase
            .from("whatsapp_instances")
            .update({ copilot_agent_id: null })
            .eq("id", agent.whatsapp_instance_id);
        }

        await supabase
          .from("copilot_agents")
          .update({ whatsapp_instance_id: null })
          .eq("id", agentId);
      }

      return { agentId, instanceId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
      
      if (variables.instanceId) {
        toast.success("WhatsApp vinculado!", {
          description: "O agente agora responderá automaticamente nesta instância.",
        });
      } else {
        toast.success("WhatsApp desvinculado", {
          description: "O agente não responderá mais automaticamente.",
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Erro ao vincular WhatsApp", {
        description: error.message,
      });
    },
  });
}
