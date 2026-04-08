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
import { generatePrompt, saveCopilotSystemPrompt, regenerateAndSavePrompt, computePromptHash } from "./useCopilotPromptBuilder";
import { parseCustomInstructions, serializeCustomInstructions } from "@/lib/copilot/custom-instructions-utils";
import type {
  CopilotAgent,
  CopilotAgentInsert,
  CopilotAgentUpdate,
  CopilotAgentWithRelations,
  CreateAgentPayload,
  UpdateAgentPayload,
  MoveRule,
  CopilotWizardData,
} from "@/types/copilot";
import { followupRuleToDB } from "./useAgentFollowupRules";
import type { AgentDocument } from "./useAgentDocuments";
import { useCurrentTeamMember } from "./useTeamMembers";

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

      // 2b. Item #6: Gerar embeddings semânticos das FAQs (fire-and-forget)
      if (payload.faqs.length > 0) {
        supabase.functions
          .invoke("generate-faq-embeddings", { body: { agentId: agent.id } })
          .catch((e: unknown) => console.warn("[FAQ Embeddings] Non-fatal:", e));
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

      // 5. Gerar e salvar o system prompt (com hash)
      const promptResult = generatePrompt(
        agent,
        createdFaqs || [],
        createdRules || []
      );

      const promptHash = computePromptHash(agent, createdFaqs || []);

      await saveCopilotSystemPrompt(
        agent.id,
        promptResult.systemPrompt,
        promptResult.metadata.version,
        promptHash
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
      
      // Erros específicos com mensagens amigáveis
      if (errorMessage.includes("unique_agent_name_per_org")) {
        errorMessage = "Já existe um agente com este nome na sua organização. Escolha um nome diferente.";
      }
      
      toast.error("Erro ao criar Copilot", {
        description: errorMessage,
        duration: 10000,
      });
    },
  });
}

/**
 * Atualiza um agente existente.
 * Após salvar os campos, busca FAQs e regenera o system_prompt automaticamente.
 */
export function useUpdateCopilotAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateAgentPayload) => {
      // 1. Salvar os campos atualizados
      const { data, error } = await supabase
        .from("copilot_agents")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      const agent = data as CopilotAgent;

      // 2. Buscar FAQs para incluir no prompt regenerado
      const { data: faqs } = await supabase
        .from("copilot_agent_faqs")
        .select("*")
        .eq("agent_id", id);

      // 3. Regenerar e salvar o prompt (com hash — só regenera se algo mudou)
      try {
        await regenerateAndSavePrompt(agent, faqs || []);
      } catch (promptError) {
        console.error("Erro ao regenerar prompt (agente salvo, prompt não atualizado):", promptError);
      }

      return agent;
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

// =====================================================
// EDIT MODE - HOOKS PARA EDIÇÃO VIA WIZARD
// =====================================================

/**
 * Busca todos os dados de um agente no formato CopilotWizardData
 * para preencher o wizard em modo de edição.
 *
 * Carrega: agente + FAQs + kanban rules + followup rules + documentos
 */
export function useCopilotAgentForEdit(agentId?: string) {
  return useQuery({
    queryKey: ["copilot_agent_for_edit", agentId],
    queryFn: async (): Promise<{ wizardData: CopilotWizardData; existingDocuments: AgentDocument[] } | null> => {
      if (!agentId) return null;

      // Buscar tudo em paralelo
      const [agentRes, faqsRes, kanbanRes, followupRes, docsRes] = await Promise.all([
        supabase
          .from("copilot_agents")
          .select("*")
          .eq("id", agentId)
          .single(),
        supabase
          .from("copilot_agent_faqs")
          .select("*")
          .eq("agent_id", agentId)
          .order("position", { ascending: true }),
        supabase
          .from("copilot_agent_kanban_rules")
          .select("*")
          .eq("agent_id", agentId),
        supabase
          .from("copilot_agent_followup_rules")
          .select("*")
          .eq("agent_id", agentId)
          .order("priority", { ascending: true }),
        supabase
          .from("copilot_agent_documents")
          .select("*")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false }),
      ]);

      if (agentRes.error) throw agentRes.error;
      if (!agentRes.data) return null;

      const agent = agentRes.data;
      const faqs = faqsRes.data || [];
      const kanbanRules = kanbanRes.data || [];
      const followupRules = followupRes.data || [];
      const documents = (docsRes.data || []) as AgentDocument[];

      // Transformar DB → CopilotWizardData
      const objectiveComposite = (agent.objective_composite as any) || {
        mission: agent.main_objective || "",
        success_criteria: "",
        limits: "",
      };
      const businessContext = (agent.business_context as any) || {};
      const conversationStyle = (agent.conversation_style as any) || {};
      const qualificationRules = (agent.qualification_rules as any) || {};
      const availability = (agent.availability as any) || {};
      const activationTriggers = (agent.activation_triggers as any) || {
        required: { tags: [], origins: [], hasPhone: true, hasEmail: false },
        optional: [],
      };
      const rawOutboundConfig = (agent.outbound_config as any) || {};
      const outboundConfig = {
        delayMinutes: rawOutboundConfig.delayMinutes ?? 5,
        firstMessageTemplate: rawOutboundConfig.firstMessageTemplate ?? "",
        availableVariables: rawOutboundConfig.availableVariables ?? ["nome", "empresa", "email", "telefone", "origem", "interesse", "segmento", "campanha"],
        maxRetries: rawOutboundConfig.maxRetries ?? 3,
        retryIntervalMinutes: rawOutboundConfig.retryIntervalMinutes ?? 30,
        audioEnabled: rawOutboundConfig.audioEnabled ?? false,
        audioSendOrder: rawOutboundConfig.audioSendOrder ?? "text_first",
      };
      const automationActions = (agent.automation_actions as any) || {
        onQualify: { moveToStage: "", moveToPipe: null, addTags: [], notifyUserId: null, sendMessage: false, messageTemplate: "" },
        onDisqualify: { moveToStage: "", moveToPipe: null, addTags: [], notifyUserId: null, sendMessage: false, messageTemplate: "" },
        onNeedHuman: { moveToStage: "", moveToPipe: null, addTags: [], notifyUserId: null, sendMessage: false, messageTemplate: "" },
      };

      const wizardData: CopilotWizardData = {
        templateType: agent.template_type as any,
        name: agent.name,
        personality: {
          tone: (agent.personality_tone as any) || "profissional",
          style: (agent.personality_style as any) || "consultivo",
          energy: (agent.personality_energy as any) || "moderada",
        },
        skills: (agent.skills as string[]) || [],
        allowedTopics: (agent.allowed_topics as string[]) || [],
        forbiddenTopics: (agent.forbidden_topics as string[]) || [],
        faqs: faqs.map((f) => ({ question: f.question, answer: f.answer })),
        businessContext: {
          companyName: businessContext.companyName || "",
          productSummary: businessContext.productSummary || "",
          idealCustomerProfile: businessContext.idealCustomerProfile || "",
          serviceRegion: businessContext.serviceRegion || "",
          valueProps: businessContext.valueProps || "",
          customerPains: businessContext.customerPains || "",
          socialProof: businessContext.socialProof || "",
          pricingPolicy: businessContext.pricingPolicy || "",
          commercialTerms: businessContext.commercialTerms || "",
          businessHoursSla: businessContext.businessHoursSla || "",
          primaryCta: businessContext.primaryCta || "",
          compliancePolicy: businessContext.compliancePolicy || "",
        },
        conversationStyle: {
          responseLength: conversationStyle.responseLength || "curto",
          maxQuestions: conversationStyle.maxQuestions || "1",
          emojiPolicy: conversationStyle.emojiPolicy || "raro",
          openingStyle: conversationStyle.openingStyle || "",
          closingStyle: conversationStyle.closingStyle || "",
          whatsappGuidelines: conversationStyle.whatsappGuidelines || "",
          humanizationTips: conversationStyle.humanizationTips || "",
        },
        qualification: {
          requiredFields: qualificationRules.requiredFields || [],
          optionalFields: qualificationRules.optionalFields || [],
          notes: qualificationRules.notes || "",
        },
        examples: (agent.few_shot_examples as any[]) || [{ lead: "", agent: "" }],
        availability: {
          mode: availability.mode || "always",
          timezone: availability.timezone || "America/Sao_Paulo",
          days: availability.days || ["mon", "tue", "wed", "thu", "fri"],
          start: availability.start || "09:00",
          end: availability.end || "18:00",
        },
        responseDelaySeconds: (agent as any).response_delay_seconds ?? 0,
        mainObjective: agent.main_objective || "",
        objectiveComposite,
        kanbanRules: kanbanRules.map((r) => ({
          pipeType: r.pipe_type,
          stageName: r.stage_name,
          goal: r.goal,
          behavior: r.behavior,
          allowedActions: (r.allowed_actions as string[]) || [],
          forbiddenActions: (r.forbidden_actions as string[]) || [],
        })),
        operationMode: ((agent as any).operation_mode as any) || "inbound",
        activationTriggers,
        outboundConfig,
        automationActions,
        followupRules: followupRules.map((r: any) => ({
          id: r.id,
          name: r.name,
          description: r.description || undefined,
          isActive: r.is_active,
          priority: r.priority,
          triggerType: r.trigger_type,
          triggerDelayHours: r.trigger_delay_hours,
          triggerDelayMinutes: r.trigger_delay_minutes,
          maxFollowups: r.max_followups,
          filterTags: r.filter_tags || [],
          filterTagsExclude: r.filter_tags_exclude || [],
          filterOrigins: r.filter_origins || [],
          filterPipes: r.filter_pipes || [],
          filterStages: r.filter_stages || [],
          filterCustomFields: Object.entries(r.filter_custom_fields || {}).map(([field, config]: [string, any]) => ({
            field,
            operator: config.operator,
            value: config.value,
          })),
          useLastContext: r.use_last_context,
          contextLookbackDays: r.context_lookback_days,
          followupStyle: r.followup_style,
          messageTemplate: r.message_template || undefined,
          sendOnlyBusinessHours: r.send_only_business_hours,
          businessHoursStart: r.business_hours_start,
          businessHoursEnd: r.business_hours_end,
          sendDays: r.send_days || [],
          timezone: r.timezone,
        })),
        customInstructions: parseCustomInstructions(agent.custom_instructions),
        knowledgeBaseFiles: [], // Arquivos novos serão adicionados pelo usuário
        canQualifyLead: (agent as any).can_qualify_lead ?? true,
        canScheduleMeeting: (agent as any).can_schedule_meeting ?? true,
        canSendFollowup: (agent as any).can_send_followup ?? true,
        canUpdateCrm: (agent as any).can_update_crm ?? false,
        canAnswerFaq: (agent as any).can_answer_faq ?? true,
        canCreateLead: (agent as any).can_create_lead ?? true,
        canTransferHuman: (agent as any).can_transfer_human ?? true,
        canMoveCards: agent.can_move_cards ?? false,
        maxConversationTurns: (agent as any).max_conversation_turns ?? 20,
        responseDelayMs: (agent as any).response_delay_ms ?? 1000,
        attendUnknownContacts: (agent as any).attend_unknown_contacts ?? false,
        llmTemperatureMode: ((agent as any).llm_temperature_mode as 'criativo' | 'balanceado' | 'preciso') ?? 'balanceado',
        // Mensagens Naturais
        naturalMessagingEnabled: ((agent as any).natural_messaging_config as any)?.enabled ?? false,
        naturalMessagingIntensity: ((agent as any).natural_messaging_config as any)?.intensity ?? 'natural',
        // Wizard v3 — novos campos livres (armazenados em JSONB)
        personaDescription: conversationStyle.personaDescription || "",
        skillsAndTopics: businessContext.skillsAndTopics || "",
        // Playground structured prompt data (round-trip)
        promptSections: conversationStyle.promptSections || undefined,
        toolInstructions: conversationStyle.toolInstructions || undefined,
      } as any;

      return { wizardData, existingDocuments: documents };
    },
    enabled: !!agentId,
    staleTime: 0, // Sempre buscar dados frescos ao editar
  });
}

/**
 * Payload para atualização completa do agente a partir do wizard de edição
 */
export interface UpdateAgentFromWizardPayload {
  agentId: string;
  data: CopilotWizardData;
  /** IDs de documentos existentes que devem ser removidos */
  documentsToRemove: Array<{ documentId: string; filePath: string }>;
}

/**
 * Atualiza um agente existente a partir dos dados do wizard.
 * Sincroniza: campos principais + FAQs + kanban rules + followup rules + documentos
 * Regenera o system prompt automaticamente.
 */
export function useUpdateCopilotAgentFromWizard() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (payload: UpdateAgentFromWizardPayload) => {
      const { agentId, data, documentsToRemove } = payload;

      // 1. Atualizar campos principais do agente
      const agentUpdate: any = {
        name: data.name,
        personality_tone: data.personality.tone,
        personality_style: data.personality.style,
        personality_energy: data.personality.energy,
        skills: data.skills || [],
        allowed_topics: data.allowedTopics || [],
        forbidden_topics: data.forbiddenTopics || [],
        main_objective: data.objectiveComposite?.mission || data.mainObjective,
        objective_composite: data.objectiveComposite?.mission
          ? data.objectiveComposite
          : null,
        custom_instructions: serializeCustomInstructions(
          data.customInstructions?.dos || "",
          data.customInstructions?.donts || ""
        ),
        business_context: { ...(data.businessContext || {}), skillsAndTopics: data.skillsAndTopics || "" },
        conversation_style: {
          ...(data.conversationStyle || {}),
          personaDescription: data.personaDescription || "",
          // Playground structured prompt data (round-trip)
          ...((data as any).promptSections ? { promptSections: (data as any).promptSections } : {}),
          ...((data as any).toolInstructions ? { toolInstructions: (data as any).toolInstructions } : {}),
        },
        qualification_rules: data.qualification || {},
        few_shot_examples: data.examples || [],
        availability: data.availability || {},
        response_delay_seconds: data.responseDelaySeconds ?? 0,
        operation_mode: data.operationMode || "inbound",
        attend_unknown_contacts: data.attendUnknownContacts ?? false,
      };

      if (data.activationTriggers) {
        agentUpdate.activation_triggers = data.activationTriggers;
      }
      if (data.operationMode === "outbound" || data.operationMode === "hybrid") {
        if (data.outboundConfig) {
          agentUpdate.outbound_config = data.outboundConfig;
        }
      } else {
        agentUpdate.outbound_config = null;
      }
      if (data.automationActions) {
        agentUpdate.automation_actions = data.automationActions;
      }

      // Capabilities
      agentUpdate.can_qualify_lead = data.canQualifyLead ?? true;
      agentUpdate.can_schedule_meeting = data.canScheduleMeeting ?? true;
      agentUpdate.can_send_followup = data.canSendFollowup ?? true;
      agentUpdate.can_update_crm = data.canUpdateCrm ?? false;
      agentUpdate.can_answer_faq = data.canAnswerFaq ?? true;
      agentUpdate.can_create_lead = data.canCreateLead ?? true;
      agentUpdate.can_transfer_human = data.canTransferHuman ?? true;
      agentUpdate.can_move_cards = data.canMoveCards ?? false;
      agentUpdate.max_conversation_turns = data.maxConversationTurns ?? 20;
      agentUpdate.response_delay_ms = data.responseDelayMs ?? 1000;
      (agentUpdate as any).llm_temperature_mode = data.llmTemperatureMode ?? 'balanceado';

      // Mensagens Naturais
      (agentUpdate as any).natural_messaging_config = data.naturalMessagingEnabled
        ? { enabled: true, intensity: data.naturalMessagingIntensity ?? 'natural' }
        : null;

      const { data: updatedAgent, error: agentError } = await supabase
        .from("copilot_agents")
        .update(agentUpdate)
        .eq("id", agentId)
        .select()
        .single();

      if (agentError) throw agentError;

      // 2. Sincronizar FAQs (delete all + insert)
      await supabase
        .from("copilot_agent_faqs")
        .delete()
        .eq("agent_id", agentId);

      if (data.faqs && data.faqs.length > 0) {
        const faqsToInsert = data.faqs.map((faq, index) => ({
          agent_id: agentId,
          question: faq.question,
          answer: faq.answer,
          position: index,
        }));

        const { error: faqsError } = await supabase
          .from("copilot_agent_faqs")
          .insert(faqsToInsert);

        if (faqsError) throw faqsError;
      }

      // 2b. Item #6: Gerar embeddings semânticos das FAQs (fire-and-forget)
      if (data.faqs && data.faqs.length > 0) {
        supabase.functions
          .invoke("generate-faq-embeddings", { body: { agentId } })
          .catch((e: unknown) => console.warn("[FAQ Embeddings] Non-fatal:", e));
      }

      // 3. Sincronizar Kanban Rules (delete all + insert)
      await supabase
        .from("copilot_agent_kanban_rules")
        .delete()
        .eq("agent_id", agentId);

      const activeKanbanRules = (data.kanbanRules || [])
        .filter((r: any) => !r._disabled)
        .map(({ _disabled, ...rule }: any) => rule);

      if (activeKanbanRules.length > 0) {
        const rulesToInsert = activeKanbanRules.map((rule: any) => ({
          agent_id: agentId,
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

      // 4. Sincronizar Follow-up Rules (delete all + insert) — se template followup
      if (updatedAgent.template_type === "followup") {
        await supabase
          .from("copilot_agent_followup_rules")
          .delete()
          .eq("agent_id", agentId);

        if (data.followupRules && data.followupRules.length > 0) {
          const followupToInsert = data.followupRules.map((rule, index) =>
            followupRuleToDB(
              { ...rule, priority: rule.priority ?? index, name: rule.name || `Regra ${index + 1}` },
              agentId
            )
          );
          const { error: followupError } = await supabase
            .from("copilot_agent_followup_rules")
            .insert(followupToInsert as any);

          if (followupError) throw followupError;
        }
      }

      // 5. Remover documentos marcados para exclusão
      for (const doc of documentsToRemove) {
        try {
          await supabase.storage
            .from("agent-documents")
            .remove([doc.filePath]);

          await supabase
            .from("copilot_agent_documents")
            .delete()
            .eq("id", doc.documentId);
        } catch (docErr) {
          console.error("Erro ao remover documento:", docErr);
        }
      }

      // 6. Regenerar system prompt
      const { data: createdFaqs } = await supabase
        .from("copilot_agent_faqs")
        .select("*")
        .eq("agent_id", agentId);

      const { data: createdRules } = await supabase
        .from("copilot_agent_kanban_rules")
        .select("*")
        .eq("agent_id", agentId);

      const promptResult = generatePrompt(
        updatedAgent,
        createdFaqs || [],
        createdRules || []
      );

      const promptHash = computePromptHash(updatedAgent, createdFaqs || []);

      await saveCopilotSystemPrompt(
        agentId,
        promptResult.systemPrompt,
        promptResult.metadata.version,
        promptHash
      );

      return updatedAgent as CopilotAgent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot_agents"] });
      queryClient.invalidateQueries({ queryKey: ["copilot_agent_for_edit"] });
      queryClient.invalidateQueries({ queryKey: ["agent_documents"] });
      toast.success("Copilot atualizado com sucesso!", {
        description: "Todas as alterações foram salvas e o prompt foi regenerado.",
      });
    },
    onError: (error: any) => {
      console.error("Erro ao atualizar agente via wizard:", error);

      let errorMessage = error?.message || "Erro desconhecido ao atualizar o agente";

      if (errorMessage.includes("unique_agent_name_per_org")) {
        errorMessage = "Já existe um agente com este nome na sua organização. Escolha um nome diferente.";
      }

      toast.error("Erro ao atualizar Copilot", {
        description: errorMessage,
        duration: 10000,
      });
    },
  });
}
