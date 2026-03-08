import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenRouterClient } from "./openrouter-client.ts";
import { sanitizeString } from "../_shared/validation.ts";
import { promoveShadowLead } from "../_shared/lead-service.ts";
import { getValidAccessToken, logCalendarOp } from "../_shared/google-calendar-utils.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";

/** Parse custom_instructions (JSON ou string legada) para { dos, donts } */
function parseCustomInstructions(raw: string): { dos: string; donts: string } {
  if (!raw || raw.trim() === "") return { dos: "", donts: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && ("dos" in parsed || "donts" in parsed)) {
      return { dos: parsed.dos || "", donts: parsed.donts || "" };
    }
  } catch { /* backward compat */ }
  return { dos: raw, donts: "" };
}

// Interface para contexto resumido da conversa
interface ConversationContextSummary {
  lastTopic?: string;
  lastIntent?: string;
  keyPoints: string[];
  objectionsRaised: string[];
  questionsAsked: string[];
  nextAction?: string;
  qualificationData: Record<string, any>;
  leadTemperature: 'cold' | 'warm' | 'hot';
  engagementScore: number;
  lastMessageAt?: string;
  messageCount: number;
  followupCount: number;
}

export class AgentEngine {
  private supabase: SupabaseClient;
  private openRouter: OpenRouterClient;
  private organizationId: string;
  private currentLeadId: string | null = null;
  private conversationContext: ConversationContextSummary | null = null;

  // ── Compressão de histórico ───────────────────────────────────────────
  private readonly HISTORY_COMPRESS_THRESHOLD = 25;
  private readonly HISTORY_KEEP_RECENT = 15;

  // ── Opt-out / STOP keywords ───────────────────────────────────────────
  private readonly OPT_OUT_KEYWORDS = new Set([
    'para', 'parar', 'pare', 'stop', 'sair', 'cancelar',
    'nao quero', 'não quero', 'descadastrar', 'remover', 'remove',
    'unsubscribe', 'chega', 'encerrar', 'nao me mande mais',
    'não me mande mais', 'sai', 'fora', 'bloqueie', 'me remova',
    'saida', 'saída', 'nao quero mais', 'não quero mais',
  ]);

  constructor(supabase: SupabaseClient, openRouter: OpenRouterClient, organizationId: string) {
    this.supabase = supabase;
    this.openRouter = openRouter;
    this.organizationId = organizationId;
  }

  /**
   * Processa mensagem do lead e retorna resposta
   */
  async processMessage(leadId: string, userMessage: string) {
    console.log('[AgentEngine] Processing message:', { leadId, messagePreview: userMessage.substring(0, 50) });
    this.currentLeadId = leadId;

    // 0. OPT-OUT CHECK — antes de qualquer chamada LLM (item #9)
    const optOutReply = this.detectOptOut(userMessage);
    if (optOutReply) {
      console.log('[AgentEngine] Opt-out detectado para lead:', leadId);
      await this.supabase
        .from('leads')
        .update({ ai_disabled: true, ai_disabled_at: new Date().toISOString() })
        .eq('id', leadId);
      return {
        message: optOutReply,
        messages: [optOutReply],
        state: 'OPT_OUT',
        action_executed: 'OPT_OUT',
      };
    }

    // 1. Load Capabilities (item #4: roteamento por etapa do lead)
    console.log('[AgentEngine] Step 1: Loading capabilities...');
    const capabilities = await this.loadCapabilities(leadId);

    if (!capabilities) {
      console.error('[AgentEngine] No active agent found for organization:', this.organizationId);
      throw new Error('No active agent found for organization');
    }
    console.log('[AgentEngine] Capabilities loaded:', { agentId: capabilities.id, agentName: capabilities.name });

    // 1.5. OUT-OF-HOURS CHECK — item #15 (síncrono, instant)
    const outOfHoursReply = this.checkOutOfHours(capabilities);
    if (outOfHoursReply) {
      console.log('[AgentEngine] Fora do horário de atendimento para lead:', leadId);
      return {
        message: outOfHoursReply,
        messages: [outOfHoursReply],
        state: 'OUT_OF_HOURS',
        action_executed: 'OUT_OF_HOURS',
      };
    }

    // 2. Parallel data loading — todas as queries independentes de uma vez
    console.log('[AgentEngine] Step 2: Parallel data loading...');
    const [
      abVariant,
      conversationResult,
      leadData,
      contextResult,
      documentSummaries,
      semanticContext,
      longTermMemories,
      orgCustomFields,
      pipelineStages,
    ] = await Promise.all([
      this.resolveABVariant(leadId, capabilities.id),
      this.loadConversation(leadId, capabilities.id).then(c => c || this.createConversation(leadId, capabilities.id)),
      this.loadLeadData(leadId),
      this.loadConversationContext(leadId),
      this.loadDocumentSummaries(capabilities.id),
      this.retrieveSemanticContext(userMessage, capabilities.id),
      this.retrieveLongTermMemories(userMessage, leadId),
      this.loadOrgCustomFields(),
      capabilities.can_qualify_lead ? this.loadPipelineStages() : Promise.resolve([]),
    ]);

    // Apply A/B variant overrides (item #18)
    if (abVariant) {
      if (abVariant.system_prompt_override) {
        capabilities.system_prompt = abVariant.system_prompt_override;
      }
      if (abVariant.temperature_override) {
        capabilities.llm_temperature_mode = abVariant.temperature_override;
      }
      console.log(`[AgentEngine] A/B variant active: ${abVariant.name}`);
    }

    const conversation = conversationResult;
    if (!conversation) {
      console.error('[AgentEngine] Failed to load or create conversation');
      throw new Error('Failed to create conversation');
    }
    console.log('[AgentEngine] Capabilities loaded:', { agentId: capabilities.id, agentName: capabilities.name });

    this.conversationContext = contextResult;

    // 3. Update Short-Term Memory
    console.log('[AgentEngine] Step 3: Adding message to memory...');
    await this.addMessageToMemory(conversation.id, 'user', userMessage);

    // 4. Build Dynamic Prompt
    console.log('[AgentEngine] Step 4: Building prompt...');
    const systemPrompt = this.buildDynamicPrompt(capabilities, conversation, leadData, documentSummaries, semanticContext, longTermMemories);

    // 5. Build Tools (based on capabilities)
    console.log('[AgentEngine] Step 5: Building tools...');
    const tools = this.buildDynamicTools(capabilities, orgCustomFields, pipelineStages);

    // 6. Call LLM via OpenRouter
    console.log('[AgentEngine] Step 6: Getting conversation history...');
    const historyMessages = await this.getConversationHistory(conversation.id);
    console.log('[AgentEngine] History messages count:', historyMessages.length);
    
    // Garantir que a mensagem atual do usuário está incluída
    // (pode não estar no histórico se foi criada agora)
    const allMessages = [...historyMessages];
    const lastMessage = allMessages[allMessages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userMessage) {
      allMessages.push({ role: 'user', content: userMessage });
    }
    console.log('[AgentEngine] Total messages to send:', allMessages.length);
    
    // Obter modelo e temperatura do banco ou usar padrões
    const model = capabilities.llm_model || Deno.env.get('OPENROUTER_DEFAULT_MODEL') || 'google/gemini-3-flash-preview';
    const temperatureModeMap: Record<string, number> = { criativo: 0.9, balanceado: 0.7, preciso: 0.2 };
    const temperature = temperatureModeMap[capabilities.llm_temperature_mode ?? 'balanceado'] ?? 0.7;
    console.log('[AgentEngine] Using model:', model, '| temperature:', temperature, `(${capabilities.llm_temperature_mode ?? 'balanceado'})`);
    
    // Converter mensagens e tools para formato OpenRouter
    const openRouterMessages = this.openRouter.convertMessages(allMessages, systemPrompt);
    const openRouterTools = tools.length > 0 ? this.openRouter.convertTools(tools) : undefined;

    console.log('[AgentEngine] Step 7: Calling LLM...');
    const response = await this.openRouter.chat({
      model,
      messages: openRouterMessages,
      tools: openRouterTools,
      tool_choice: openRouterTools ? 'auto' : undefined,
      max_tokens: 1024,
      temperature,
    });
    console.log('[AgentEngine] LLM response received');

    // 7. Process Response
    console.log('[AgentEngine] Step 8: Processing LLM response...');
    const { nextState, actionToExecute, assistantMessage } = await this.processLLMResponse(
      response,
      conversation,
      capabilities
    );
    console.log('[AgentEngine] Response processed:', { nextState, hasAction: !!actionToExecute, messageLength: assistantMessage?.length });

    // 8a. Split message on ||SPLIT|| delimiter (WhatsApp natural messaging)
    const messageParts = assistantMessage
      .split('||SPLIT||')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    // Versão limpa sem delimitadores (usada para memória e logs)
    const cleanMessage = messageParts.join(' ');

    // 8. Execute Action (via n8n se necessário)
    let executionResult = null;
    if (actionToExecute) {
      // Injetar lead_id para ações que precisam
      const needsLeadId = ['SCHEDULE_MEETING', 'TRANSFER_HUMAN', 'UPDATE_LEAD', 'QUALIFY_LEAD', 'DISQUALIFY_LEAD', 'ADVANCE_STAGE', 'UPDATE_QUALIFICATION_SCORE'];
      if (this.currentLeadId && needsLeadId.includes(actionToExecute.action)) {
        actionToExecute = {
          ...actionToExecute,
          params: { ...actionToExecute.params, lead_id: this.currentLeadId },
        };
      }
      console.log('[AgentEngine] Step 9: Executing action:', actionToExecute.action);
      try {
        executionResult = await this.executeAction(actionToExecute);
      } catch (actionError) {
        // Não quebrar o fluxo se a action falhar - a resposta deve ser enviada de qualquer forma
        console.warn('[AgentEngine] Action execution failed (non-fatal):', actionError);
        executionResult = { error: String(actionError), status: 'failed' };
      }
    }

    // 9. Update Conversation State (salva mensagem limpa, sem delimitadores)
    console.log('[AgentEngine] Step 10: Updating conversation state...');
    await this.updateConversationState(conversation.id, nextState, cleanMessage);

    // 10. Log Decision
    console.log('[AgentEngine] Step 11: Logging decision...');
    await this.logDecision(conversation.id, conversation.state, nextState, actionToExecute, capabilities);

    // 11. Update Lead Pipeline Stage (Funil WhatsApp)
    console.log('[AgentEngine] Step 12: Updating lead pipeline stage...');
    await this.updateLeadPipelineStage(leadId, conversation.turn_count, actionToExecute);

    // 12. Execute Automation Actions (if configured)
    console.log('[AgentEngine] Step 13: Checking automation actions...');
    await this.executeAutomationActions(leadId, nextState, capabilities, cleanMessage);

    console.log('[AgentEngine] Message processing complete', { parts: messageParts.length });

    // 13. Auto-update conversation_context_summary (item #2) — assíncrono, não bloqueia resposta
    this.updateContextSummaryAfterTurn(leadId, nextState, userMessage, cleanMessage, conversation.turn_count + 1)
      .catch(e => console.warn('[AgentEngine] Context summary update failed (non-fatal):', e));

    // 13.5. Item #19: Extrair e salvar memórias de longo prazo (fire-and-forget)
    this.extractAndSaveMemories(leadId, capabilities.id, conversation.id, conversation.turn_count + 1, userMessage, cleanMessage)
      .catch(e => console.warn('[AgentEngine] Long-term memory extraction failed (non-fatal):', e));

    // 14. Return Response
    return {
      message: cleanMessage,
      messages: messageParts.length > 1 ? messageParts : undefined,
      state: nextState,
      action_executed: actionToExecute?.action,
      execution_result: executionResult,
      // Metadados para LLM-as-a-judge (#8) — usados em fire-and-forget pelo caller
      _eval_meta: {
        conversationId: conversation.id,
        agentId: capabilities.id,
        turnCount: conversation.turn_count + 1,
        systemPromptExcerpt: (capabilities.system_prompt || '').substring(0, 500),
      },
    };
  }

  /**
   * Executa ações automáticas baseadas no estado/resultado da conversa
   */
  private async executeAutomationActions(
    leadId: string,
    currentState: string,
    capabilities: any,
    assistantMessage: string
  ) {
    try {
      const automationActions = capabilities.automation_actions;
      if (!automationActions) {
        console.log('[AgentEngine] No automation actions configured');
        return;
      }

      // Determinar qual ação executar baseado no estado
      let actionConfig = null;
      let actionType = null;

      // Mapear estados para ações
      const qualifiedStates = ['QUALIFIED', 'SCHEDULED', 'MEETING_SCHEDULED', 'CLOSED_WON'];
      const disqualifiedStates = ['DISQUALIFIED', 'NOT_INTERESTED', 'NO_FIT', 'CLOSED_LOST'];
      const needHumanStates = ['NEED_HUMAN', 'ESCALATED', 'COMPLEX_ISSUE', 'WAITING_HUMAN'];

      if (qualifiedStates.includes(currentState)) {
        actionConfig = automationActions.onQualify;
        actionType = 'qualify';
      } else if (disqualifiedStates.includes(currentState)) {
        actionConfig = automationActions.onDisqualify;
        actionType = 'disqualify';
      } else if (needHumanStates.includes(currentState)) {
        actionConfig = automationActions.onNeedHuman;
        actionType = 'need_human';
      }

      // Também verificar se a mensagem indica necessidade de humano
      const needHumanIndicators = [
        'falar com humano',
        'atendente',
        'pessoa real',
        'supervisor',
        'gerente',
        'reclamação',
        'problema grave',
      ];
      
      const messageNeedsHuman = needHumanIndicators.some(indicator => 
        assistantMessage.toLowerCase().includes(indicator)
      );

      if (messageNeedsHuman && !actionConfig) {
        actionConfig = automationActions.onNeedHuman;
        actionType = 'need_human';
      }

      if (!actionConfig) {
        console.log('[AgentEngine] No automation action matches current state:', currentState);
        return;
      }

      console.log('[AgentEngine] Executing automation action:', actionType);

      // Promover shadow lead antes de executar ações de automação
      // Shadow leads precisam ser promovidos para aparecer nos pipes
      if (actionType === 'qualify' || actionType === 'disqualify') {
        const moveToPipe = actionConfig.moveToPipe;
        const destination = moveToPipe && moveToPipe.stage
          ? { pipe: moveToPipe.pipe, stage: moveToPipe.stage }
          : { pipe: 'whatsapp', stage: actionConfig.moveToStage || (actionType === 'qualify' ? 'respondeu' : 'esfriou') };

        const promoted = await promoveShadowLead(
          this.supabase,
          leadId,
          this.organizationId,
          destination
        );

        if (promoted) {
          console.log('[AgentEngine] Shadow lead promoted to real lead:', { leadId, destination });
        }
      }

      // Executar ações configuradas
      const updates: Record<string, any> = {};

      // Desligar IA quando transferir para humano
      if (actionType === 'need_human') {
        updates.ai_disabled = true;
        updates.ai_disabled_at = new Date().toISOString();
      }

      // Mover para etapa
      if (actionConfig.moveToStage) {
        updates.pipe_whatsapp = actionConfig.moveToStage;
      }

      // Atualizar lead
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await this.supabase
          .from('leads')
          .update(updates)
          .eq('id', leadId);

        if (updateError) {
          console.warn('[AgentEngine] Failed to update lead:', updateError);
        } else {
          console.log('[AgentEngine] Lead updated with automation:', updates);
          if (actionConfig.moveToStage) {
            await this.upsertPipeWhatsapp(leadId, this.organizationId, actionConfig.moveToStage);
          }
        }
      }

      // Adicionar tags
      if (actionConfig.addTags && actionConfig.addTags.length > 0) {
        for (const tagName of actionConfig.addTags) {
          // Buscar ou criar tag
          let { data: tag } = await this.supabase
            .from('tags')
            .select('id')
            .eq('name', tagName)
            .maybeSingle();

          if (!tag) {
            const { data: newTag } = await this.supabase
              .from('tags')
              .insert({ name: tagName, color: '#6366f1' })
              .select()
              .single();
            tag = newTag;
          }

          if (tag) {
            await this.supabase
              .from('lead_tags')
              .upsert({
                lead_id: leadId,
                tag_id: tag.id,
              }, {
                onConflict: 'lead_id,tag_id',
                ignoreDuplicates: true,
              });
          }
        }
        console.log('[AgentEngine] Tags added:', actionConfig.addTags);
      }

      // Notificar usuário (se configurado)
      if (actionConfig.notifyUserId && actionType === 'need_human') {
        try {
          const { data: lead } = await this.supabase
            .from('leads')
            .select('name, company')
            .eq('id', leadId)
            .single();

          const leadLabel = lead?.name
            ? (lead.company ? `${lead.name} - ${lead.company}` : lead.name)
            : 'Lead';

          await this.supabase.from('notifications').insert({
            organization_id: this.organizationId,
            user_id: actionConfig.notifyUserId,
            type: 'transfer_to_human',
            title: 'Lead precisa de atendimento humano',
            description: `${leadLabel} solicitou transferência para um especialista.`,
            lead_id: leadId,
            link: '/pipe-whatsapp',
          });
          console.log('[AgentEngine] Notification created for user:', actionConfig.notifyUserId);
        } catch (notifErr) {
          console.warn('[AgentEngine] Failed to create notification:', notifErr);
        }
      }

      // Mover para outro pipe (Confirmação ou Propostas)
      const moveToPipe = actionConfig.moveToPipe;
      if (moveToPipe && (moveToPipe.pipe === 'confirmacao' || moveToPipe.pipe === 'propostas') && moveToPipe.stage) {
        await this.executeMoveToPipe(leadId, moveToPipe.pipe, moveToPipe.stage);
      }

      console.log('[AgentEngine] Automation actions executed for:', actionType);

    } catch (error) {
      console.error('[AgentEngine] Error executing automation actions:', error);
    }
  }

  /**
   * Move lead para pipe Confirmação ou Propostas na etapa indicada
   */
  private async executeMoveToPipe(leadId: string, pipe: 'confirmacao' | 'propostas', stage: string) {
    try {
      if (pipe === 'confirmacao') {
        const { data: existing } = await this.supabase
          .from('pipe_confirmacao')
          .select('id')
          .eq('lead_id', leadId)
          .maybeSingle();
        if (existing) {
          await this.supabase
            .from('pipe_confirmacao')
            .update({ status: stage })
            .eq('id', existing.id);
        } else {
          await this.supabase
            .from('pipe_confirmacao')
            .insert({
              lead_id: leadId,
              organization_id: this.organizationId,
              status: stage,
            });
        }
        console.log('[AgentEngine] Lead moved to pipe_confirmacao:', stage);
      } else {
        const { data: existing } = await this.supabase
          .from('pipe_propostas')
          .select('id')
          .eq('lead_id', leadId)
          .maybeSingle();
        if (existing) {
          await this.supabase
            .from('pipe_propostas')
            .update({ status: stage })
            .eq('id', existing.id);
        } else {
          await this.supabase
            .from('pipe_propostas')
            .insert({
              lead_id: leadId,
              organization_id: this.organizationId,
              status: stage,
            });
        }
        console.log('[AgentEngine] Lead moved to pipe_propostas:', stage);
      }
      // Remover do pipe WhatsApp para não aparecer em dois funis
      await this.supabase
        .from('pipe_whatsapp')
        .delete()
        .eq('lead_id', leadId);
    } catch (e) {
      console.warn('[AgentEngine] Failed to execute moveToPipe:', e);
    }
  }

  /**
   * Atualiza o estágio do lead no funil WhatsApp
   * novo → abordado (agente respondeu) → respondeu (lead respondeu de volta) → agendado
   */
  private async updateLeadPipelineStage(
    leadId: string,
    turnCount: number,
    actionToExecute: any
  ) {
    try {
      // Buscar estado atual do lead
      const { data: lead, error: fetchError } = await this.supabase
        .from('leads')
        .select('pipe_whatsapp')
        .eq('id', leadId)
        .single();

      if (fetchError) {
        console.warn('[AgentEngine] Could not fetch lead for pipeline update:', fetchError.message);
        return;
      }

      const currentStage = lead?.pipe_whatsapp;
      let newStage: string | null = null;

      // advance_stage já atualizou o pipeline em executeAction - não aplicar regras fixas
      if (actionToExecute?.action === 'ADVANCE_STAGE') {
        return;
      }

      // Regras implícitas só se aplicam a etapas padrão do whatsapp
      // Etapas customizadas não são movidas automaticamente
      const standardWhatsappStages = ['novo', 'abordado', 'respondeu', 'esfriou', 'agendado'];
      const isStandardStage = standardWhatsappStages.includes(currentStage || '');

      // Se agendou reunião, vai direto para 'agendado'
      if (actionToExecute?.action === 'SCHEDULE_MEETING') {
        newStage = 'agendado';
      }
      // Regras implícitas apenas para etapas padrão
      else if (isStandardStage) {
        // Se é o primeiro turno (agente respondendo pela primeira vez)
        if (turnCount <= 1 && currentStage === 'novo') {
          newStage = 'abordado';
        }
        // Se já foi abordado e lead respondeu novamente
        else if (currentStage === 'abordado') {
          newStage = 'respondeu';
        }
      }

      // Atualizar se houver mudança de estágio
      if (newStage && newStage !== currentStage) {
        const { error: updateError } = await this.supabase
          .from('leads')
          .update({ pipe_whatsapp: newStage })
          .eq('id', leadId);

        if (updateError) {
          console.warn('[AgentEngine] Error updating lead pipeline stage:', updateError.message);
        } else {
          console.log('[AgentEngine] Lead pipeline stage updated:', {
            leadId,
            from: currentStage,
            to: newStage,
          });
          await this.upsertPipeWhatsapp(leadId, this.organizationId, newStage);
        }
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to update lead pipeline stage:', e);
    }
  }

  /**
   * Sincroniza o estágio do lead na tabela pipe_whatsapp para o Kanban refletir
   */
  private async upsertPipeWhatsapp(leadId: string, organizationId: string, status: string) {
    try {
      const { data: existing } = await this.supabase
        .from('pipe_whatsapp')
        .select('id')
        .eq('lead_id', leadId)
        .maybeSingle();

      if (existing) {
        await this.supabase
          .from('pipe_whatsapp')
          .update({ status })
          .eq('id', existing.id);
      } else {
        await this.supabase
          .from('pipe_whatsapp')
          .insert({
            lead_id: leadId,
            organization_id: organizationId,
            status,
          });
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to upsert pipe_whatsapp:', e);
    }
  }

  /**
   * Load Capabilities do banco
   */
  /**
   * Carrega capabilities do agente para esta organização.
   * Item #4: Se leadId for fornecido, tenta rotear para o agente configurado
   * para a etapa atual do lead (routing_stages). Caso não encontre, usa is_default.
   */
  private async loadCapabilities(leadId?: string) {
    const SELECT = '*, copilot_agent_faqs(*), copilot_agent_kanban_rules(*)';

    // Item #4 + #12: Roteamento por etapa, origem e segmento do lead (paralelo)
    if (leadId) {
      try {
        const { data: leadRow } = await this.supabase
          .from('leads')
          .select('pipe_whatsapp, origin, segment')
          .eq('id', leadId)
          .maybeSingle();

        if (leadRow) {
          // Executar as 3 tentativas de routing em paralelo (prioridade: stage > origin > segment)
          const [stageResult, originResult, segmentResult] = await Promise.all([
            leadRow.pipe_whatsapp
              ? this.supabase
                  .from('copilot_agents')
                  .select(SELECT)
                  .eq('organization_id', this.organizationId)
                  .eq('is_active', true)
                  .contains('routing_stages', [leadRow.pipe_whatsapp])
                  .maybeSingle()
              : Promise.resolve({ data: null }),
            leadRow.origin
              ? this.supabase
                  .from('copilot_agents')
                  .select(SELECT)
                  .eq('organization_id', this.organizationId)
                  .eq('is_active', true)
                  .contains('routing_origins', [leadRow.origin])
                  .maybeSingle()
              : Promise.resolve({ data: null }),
            leadRow.segment
              ? this.supabase
                  .from('copilot_agents')
                  .select(SELECT)
                  .eq('organization_id', this.organizationId)
                  .eq('is_active', true)
                  .contains('routing_segments', [leadRow.segment])
                  .maybeSingle()
              : Promise.resolve({ data: null }),
          ]);

          // Respeitar prioridade: stage > origin > segment
          const routedAgent = stageResult.data || originResult.data || segmentResult.data;
          if (routedAgent) {
            const routeType = stageResult.data ? 'etapa' : originResult.data ? 'origem' : 'segmento';
            console.log(`[AgentEngine] Roteado por ${routeType}:`, { agentId: routedAgent.id });
            return routedAgent;
          }
        }
      } catch (e) {
        console.warn('[AgentEngine] Routing lookup failed (non-fatal):', e);
      }
    }

    // Fallback: agente padrão da organização
    const { data } = await this.supabase
      .from('copilot_agents')
      .select(SELECT)
      .eq('organization_id', this.organizationId)
      .eq('is_active', true)
      .eq('is_default', true)
      .maybeSingle();

    return data;
  }

  /**
   * Load Knowledge Base Document Summaries
   * Busca resumos prontos dos documentos do agente para injetar no prompt
   */
  private async loadDocumentSummaries(agentId: string): Promise<Array<{file_name: string; summary: string}>> {
    try {
      const { data, error } = await this.supabase
        .from('copilot_agent_documents')
        .select('file_name, summary')
        .eq('agent_id', agentId)
        .eq('status', 'ready')
        .not('summary', 'is', null);

      if (error) {
        console.warn('[AgentEngine] Error loading document summaries:', error.message);
        return [];
      }

      console.log('[AgentEngine] Document summaries loaded:', data?.length || 0);
      return data || [];
    } catch (e) {
      console.warn('[AgentEngine] Failed to load document summaries:', e);
      return [];
    }
  }

  /**
   * Item #5 + #6: Recupera contexto semântico relevante para a mensagem do usuário
   * via pgvector — busca chunks de documentos E FAQs semanticamente próximos.
   * Retorna string formatada para injeção no prompt, ou "" se não houver resultados.
   */
  private async retrieveSemanticContext(userMessage: string, agentId: string): Promise<string> {
    try {
      const apiKey = Deno.env.get('OPENROUTER_API_KEY');
      if (!apiKey) return '';

      // Gerar embedding da mensagem do usuário
      const queryEmbedding = await generateEmbedding(userMessage, apiKey);
      if (!queryEmbedding || queryEmbedding.length === 0) return '';

      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      const parts: string[] = [];

      // Buscar chunks de documentos relevantes
      const { data: chunks, error: chunksErr } = await (this.supabase as any)
        .rpc('match_document_chunks', {
          query_embedding: embeddingStr,
          agent_id_filter: agentId,
          match_count: 4,
          similarity_threshold: 0.72,
        });

      if (!chunksErr && chunks && chunks.length > 0) {
        const chunkTexts = (chunks as Array<{content: string; similarity: number}>)
          .map(c => c.content)
          .join('\n\n');
        parts.push(`## Contexto da Base de Conhecimento (RAG)\n${chunkTexts}`);
      }

      // Buscar FAQs semanticamente relevantes
      const { data: faqs, error: faqsErr } = await (this.supabase as any)
        .rpc('match_faqs', {
          query_embedding: embeddingStr,
          agent_id_filter: agentId,
          match_count: 3,
          similarity_threshold: 0.75,
        });

      if (!faqsErr && faqs && faqs.length > 0) {
        const faqTexts = (faqs as Array<{question: string; answer: string; similarity: number}>)
          .map(f => `P: ${f.question}\nR: ${f.answer}`)
          .join('\n\n');
        parts.push(`## FAQs Relevantes (busca semântica)\n${faqTexts}`);
      }

      if (parts.length === 0) return '';

      return '\n\n---\n' + parts.join('\n\n') + '\n---\n';
    } catch (e) {
      console.warn('[AgentEngine] Semantic context retrieval failed (non-fatal):', e);
      return '';
    }
  }

  /**
   * Item #19: Recupera memórias de longo prazo relevantes para a mensagem atual
   * via pgvector. Retorna string formatada ou "" se não houver memórias.
   */
  private async retrieveLongTermMemories(userMessage: string, leadId: string): Promise<string> {
    try {
      const apiKey = Deno.env.get('OPENROUTER_API_KEY');
      if (!apiKey) return '';

      const queryEmbedding = await generateEmbedding(userMessage, apiKey);
      if (!queryEmbedding || queryEmbedding.length === 0) return '';

      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      const { data: memories, error } = await (this.supabase as any)
        .rpc('match_lead_memories', {
          query_embedding: embeddingStr,
          lead_id_filter: leadId,
          match_count: 5,
          similarity_threshold: 0.70,
        });

      if (error || !memories || memories.length === 0) return '';

      const lines = (memories as Array<{memory_type: string; content: string; importance: number}>)
        .sort((a, b) => b.importance - a.importance)
        .map(m => `[${m.memory_type.toUpperCase()}] ${m.content}`);

      return lines.join('\n');
    } catch (e) {
      console.warn('[AgentEngine] Long-term memory retrieval failed (non-fatal):', e);
      return '';
    }
  }

  /**
   * Item #19: Extrai fatos relevantes da conversa atual e salva como memórias do lead.
   * Usa LLM para identificar informações importantes.
   * Chamada em fire-and-forget após cada turno.
   */
  private async extractAndSaveMemories(
    leadId: string,
    agentId: string,
    conversationId: string,
    turnCount: number,
    userMessage: string,
    assistantMessage: string
  ): Promise<void> {
    // Extrair memórias apenas a cada 5 turnos para reduzir custo
    if (turnCount % 5 !== 0) return;

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) return;

    const extractionPrompt = `Analise este trecho de conversa de vendas B2B e extraia APENAS fatos novos e relevantes sobre o lead.

Lead disse: "${userMessage}"
Agente respondeu: "${assistantMessage}"

Retorne um JSON array com até 3 memórias no formato:
[
  { "memory_type": "fact|preference|pain_point|objection|context", "content": "descrição concisa do fato", "importance": 1-10 }
]

Regras:
- Apenas fatos NOVOS que um agente de vendas precisa saber para conversas futuras
- memory_type: fact=dado objetivo, preference=preferência/gosto, pain_point=dor/problema, objection=objeção levantada, context=contexto geral
- importance: 1-10 (10=crítico para a venda, 1=pouco relevante)
- content: máximo 200 chars, direto ao ponto
- Se não há fatos novos relevantes, retorne []
- Retorne APENAS o JSON array, sem explicações`;

    try {
      const response = await this.openRouter.chat({
        model: 'google/gemini-3-flash-preview',
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.1,
        max_tokens: 400,
      });

      const raw = response.choices[0]?.message?.content || '[]';
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const extracted = JSON.parse(jsonMatch[0]) as Array<{
        memory_type: string;
        content: string;
        importance: number;
      }>;

      if (!Array.isArray(extracted) || extracted.length === 0) return;

      // Gerar embeddings para as memórias
      const contents = extracted.map(m => m.content);
      const { generateEmbeddingsBatch } = await import('../_shared/embeddings.ts');
      const embeddings = await generateEmbeddingsBatch(contents, apiKey);

      for (let i = 0; i < extracted.length; i++) {
        const mem = extracted[i];
        if (!mem.content || mem.content.trim().length < 5) continue;

        await (this.supabase as any)
          .from('lead_memories')
          .insert({
            lead_id: leadId,
            organization_id: this.organizationId,
            agent_id: agentId,
            conversation_id: conversationId,
            turn_count: turnCount,
            memory_type: mem.memory_type || 'fact',
            content: mem.content.substring(0, 500),
            importance: Math.min(10, Math.max(1, Number(mem.importance) || 5)),
            embedding: `[${embeddings[i].join(',')}]`,
          });
      }

      console.log(`[AgentEngine] ${extracted.length} memórias salvas para lead ${leadId}`);
    } catch (e) {
      console.warn('[AgentEngine] Memory extraction/save failed:', e);
    }
  }

  /**
   * Item #18: A/B Testing — resolve qual variante de prompt usar para este lead.
   * Atribuição determinística: se já atribuído, reutiliza; caso contrário, sorteia.
   * Retorna a variante ou null se não há experimento ativo.
   */
  private async resolveABVariant(leadId: string, agentId: string): Promise<any | null> {
    try {
      // Verificar se há variantes ativas para este agente
      const { data: variants, error: varErr } = await this.supabase
        .from('copilot_agent_variants')
        .select('id, name, system_prompt_override, temperature_override, traffic_pct, is_control')
        .eq('agent_id', agentId)
        .eq('is_active', true);

      if (varErr || !variants || variants.length < 2) return null; // precisa de ao menos 2 variantes para A/B

      // Verificar se lead já tem atribuição
      const { data: existing } = await this.supabase
        .from('copilot_ab_assignments')
        .select('variant_id')
        .eq('agent_id', agentId)
        .eq('lead_id', leadId)
        .maybeSingle();

      if (existing?.variant_id) {
        // Já atribuído — retornar a variante correspondente
        return variants.find(v => v.id === existing.variant_id) || null;
      }

      // Sortear variante baseado no traffic_pct
      const rand = Math.floor(Math.abs(parseInt(leadId.replace(/-/g, '').substring(0, 8), 16)) % 100);
      let cumulative = 0;
      let chosen = variants[0];
      for (const v of variants) {
        cumulative += v.traffic_pct;
        if (rand < cumulative) { chosen = v; break; }
      }

      // Salvar atribuição
      await this.supabase
        .from('copilot_ab_assignments')
        .upsert({ variant_id: chosen.id, agent_id: agentId, lead_id: leadId }, { onConflict: 'agent_id,lead_id' });

      return chosen.is_control ? null : chosen; // controle = sem override
    } catch (e) {
      console.warn('[AgentEngine] A/B variant resolution failed (non-fatal):', e);
      return null;
    }
  }

  /**
   * Load Conversation
   */
  private async loadConversation(leadId: string, agentId: string) {
    console.log('[AgentEngine] Loading conversation for lead:', leadId);
    
    const { data, error } = await this.supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle();

    if (error) {
      console.error('[AgentEngine] Error loading conversation:', error);
      // Se a tabela não existir, retornar null para criar uma nova
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.warn('[AgentEngine] Conversations table may not exist, will create in-memory conversation');
        return null;
      }
    }

    console.log('[AgentEngine] Conversation loaded:', data ? { id: data.id, state: data.state, turnCount: data.turn_count } : 'null');
    return data;
  }

  /**
   * Load Lead Data including custom fields
   */
  private async loadLeadData(leadId: string) {
    console.log('[AgentEngine] Loading lead data for:', leadId);
    
    try {
      // 1. Carregar dados básicos do lead
      const { data: lead, error: leadError } = await this.supabase
        .from('leads')
        .select(`
          id,
          name,
          phone,
          email,
          company,
          origin,
          rating,
          segment,
          faturamento,
          urgency,
          notes,
          pipe_whatsapp,
          created_at,
          updated_at
        `)
        .eq('id', leadId)
        .single();

      if (leadError) {
        console.warn('[AgentEngine] Error loading lead data:', leadError.message);
        return null;
      }

      // 2. Carregar campos personalizados do lead
      const { data: customFieldValues, error: customError } = await this.supabase
        .from('lead_custom_field_values')
        .select(`
          value,
          field:lead_custom_fields(
            id,
            field_name,
            field_type
          )
        `)
        .eq('lead_id', leadId);

      if (customError) {
        console.warn('[AgentEngine] Error loading custom fields:', customError.message);
        // Continuar mesmo sem campos personalizados
      }

      // 3. Formatar campos personalizados
      const customFields: Record<string, string> = {};
      if (customFieldValues && customFieldValues.length > 0) {
        customFieldValues.forEach((cfv: any) => {
          if (cfv.field && cfv.value) {
            customFields[cfv.field.field_name] = cfv.value;
          }
        });
      }

      console.log('[AgentEngine] Lead data loaded:', {
        leadId,
        hasBasicData: !!lead,
        customFieldsCount: Object.keys(customFields).length,
      });

      return {
        ...lead,
        customFields,
      };
    } catch (e) {
      console.error('[AgentEngine] Failed to load lead data:', e);
      return null;
    }
  }

  /**
   * Load custom fields da organização (para descrição da tool update_lead)
   */
  private async loadOrgCustomFields(): Promise<{ field_name: string }[]> {
    try {
      const { data, error } = await this.supabase
        .from('lead_custom_fields')
        .select('field_name')
        .eq('organization_id', this.organizationId)
        .order('display_order', { ascending: true });

      if (error) {
        console.warn('[AgentEngine] Error loading org custom fields:', error.message);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('[AgentEngine] Failed to load org custom fields:', e);
      return [];
    }
  }

  /**
   * Carrega etapas do pipeline WhatsApp para a organização (pipeline_stages)
   */
  private async loadPipelineStages(): Promise<{ stage_key: string; name: string }[]> {
    try {
      const { data, error } = await this.supabase
        .from('pipeline_stages')
        .select('stage_key, name')
        .eq('organization_id', this.organizationId)
        .eq('pipeline_type', 'whatsapp')
        .eq('is_active', true)
        .order('position', { ascending: true });

      if (error) {
        console.warn('[AgentEngine] Error loading pipeline stages:', error.message);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('[AgentEngine] Failed to load pipeline stages:', e);
      return [];
    }
  }

  /**
   * Load Conversation Context Summary
   * Busca o contexto resumido da última conversa para personalizar follow-ups
   */
  private async loadConversationContext(leadId: string): Promise<ConversationContextSummary | null> {
    console.log('[AgentEngine] Loading conversation context for lead:', leadId);
    
    try {
      // 1. Tentar buscar contexto já resumido do banco
      const { data: existingContext, error: contextError } = await this.supabase
        .from('conversation_context_summary')
        .select('*')
        .eq('lead_id', leadId)
        .maybeSingle();

      if (existingContext && !contextError) {
        console.log('[AgentEngine] Found existing context summary');
        return {
          lastTopic: existingContext.last_topic,
          lastIntent: existingContext.last_intent,
          keyPoints: existingContext.key_points || [],
          objectionsRaised: existingContext.objections_raised || [],
          questionsAsked: existingContext.questions_asked || [],
          nextAction: existingContext.next_action,
          qualificationData: existingContext.qualification_data || {},
          leadTemperature: existingContext.lead_temperature || 'cold',
          engagementScore: existingContext.engagement_score || 0,
          lastMessageAt: existingContext.last_message_at,
          messageCount: existingContext.message_count || 0,
          followupCount: existingContext.followup_count || 0,
        };
      }

      // 2. Se não existir contexto resumido, extrair das últimas mensagens
      console.log('[AgentEngine] No existing context, extracting from messages...');

      // Buscar últimas mensagens usando lead_id diretamente (evita ILIKE lento em phone_number)
      const { data: messages, error: msgError } = await this.supabase
        .from('whatsapp_messages')
        .select('direction, content, created_at')
        .eq('organization_id', this.organizationId)
        .eq('lead_id', leadId)
        .eq('message_type', 'text')
        .not('content', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (msgError || !messages || messages.length === 0) {
        return this.getDefaultContext();
      }

      // 3. Extrair contexto das mensagens
      const context = await this.extractContextFromMessages(messages);
      
      // 4. Salvar contexto para uso futuro
      await this.saveConversationContext(leadId, context);
      
      return context;
    } catch (e) {
      console.warn('[AgentEngine] Failed to load conversation context:', e);
      return this.getDefaultContext();
    }
  }

  /**
   * Retorna contexto padrão quando não há histórico
   */
  private getDefaultContext(): ConversationContextSummary {
    return {
      keyPoints: [],
      objectionsRaised: [],
      questionsAsked: [],
      qualificationData: {},
      leadTemperature: 'cold',
      engagementScore: 0,
      messageCount: 0,
      followupCount: 0,
    };
  }

  /**
   * Extrai contexto das últimas mensagens
   * Analisa as mensagens para identificar tópicos, intenções e pontos-chave
   */
  private async extractContextFromMessages(messages: any[]): Promise<ConversationContextSummary> {
    const context = this.getDefaultContext();
    
    if (!messages || messages.length === 0) return context;

    // Ordenar por data (mais antigas primeiro para análise)
    const sortedMessages = [...messages].reverse();
    
    context.messageCount = sortedMessages.length;
    
    // Última mensagem do lead (incoming)
    const lastLeadMessage = sortedMessages
      .filter(m => m.direction === 'incoming')
      .pop();
    
    if (lastLeadMessage) {
      context.lastMessageAt = lastLeadMessage.created_at;
      
      // Extrair tópico da última mensagem (simplificado)
      context.lastTopic = this.extractTopicFromMessage(lastLeadMessage.content);
      context.lastIntent = this.detectIntentFromMessage(lastLeadMessage.content);
    }

    // Analisar todas as mensagens do lead
    const leadMessages = sortedMessages.filter(m => m.direction === 'incoming');
    
    // Extrair perguntas feitas pelo lead
    context.questionsAsked = leadMessages
      .filter(m => m.content && m.content.includes('?'))
      .map(m => m.content.trim())
      .slice(-5);

    // Detectar objeções comuns
    const objectionKeywords = [
      'caro', 'preço', 'não tenho', 'sem verba', 'orçamento',
      'não preciso', 'já tenho', 'não é o momento', 'depois',
      'sem tempo', 'muito ocupado', 'não sei'
    ];
    
    leadMessages.forEach(m => {
      if (m.content) {
        const lowerContent = m.content.toLowerCase();
        objectionKeywords.forEach(kw => {
          if (lowerContent.includes(kw)) {
            context.objectionsRaised.push(m.content.substring(0, 100));
          }
        });
      }
    });
    context.objectionsRaised = [...new Set(context.objectionsRaised)].slice(-5);

    // Calcular temperatura e engajamento
    context.leadTemperature = this.calculateLeadTemperature(leadMessages);
    context.engagementScore = this.calculateEngagementScore(sortedMessages);

    // Extrair pontos-chave (mensagens mais longas do lead)
    context.keyPoints = leadMessages
      .filter(m => m.content && m.content.length > 50)
      .map(m => m.content.substring(0, 150))
      .slice(-3);

    return context;
  }

  /**
   * Extrai o tópico principal de uma mensagem
   */
  private extractTopicFromMessage(content: string): string {
    if (!content) return '';
    
    // Simplificado: pegar as primeiras palavras-chave
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5);
    
    return words.join(' ') || content.substring(0, 50);
  }

  /**
   * Detecta intenção da mensagem
   */
  private detectIntentFromMessage(content: string): string {
    if (!content) return 'unknown';
    
    const lowerContent = content.toLowerCase();
    
    // Mapa de intenções
    const intents: Record<string, string[]> = {
      'interesse': ['interessante', 'quero saber', 'me conta', 'como funciona'],
      'objecao_preco': ['caro', 'preço', 'quanto custa', 'valor'],
      'objecao_tempo': ['não tenho tempo', 'ocupado', 'depois', 'agora não'],
      'positivo': ['sim', 'ok', 'vamos', 'pode ser', 'combinado'],
      'negativo': ['não', 'não quero', 'não preciso', 'não tenho interesse'],
      'pergunta': ['?', 'como', 'quando', 'onde', 'qual', 'quem'],
      'agendamento': ['marcar', 'agendar', 'reunião', 'call', 'horário'],
    };

    for (const [intent, keywords] of Object.entries(intents)) {
      if (keywords.some(kw => lowerContent.includes(kw))) {
        return intent;
      }
    }

    return 'neutro';
  }

  /**
   * Calcula temperatura do lead baseado nas interações
   */
  private calculateLeadTemperature(leadMessages: any[]): 'cold' | 'warm' | 'hot' {
    if (leadMessages.length === 0) return 'cold';
    
    let score = 0;
    
    // Quantidade de mensagens
    if (leadMessages.length > 10) score += 3;
    else if (leadMessages.length > 5) score += 2;
    else if (leadMessages.length > 2) score += 1;
    
    // Mensagens positivas
    const positiveKeywords = ['sim', 'interessante', 'quero', 'vamos', 'pode'];
    leadMessages.forEach(m => {
      if (m.content) {
        const lower = m.content.toLowerCase();
        if (positiveKeywords.some(kw => lower.includes(kw))) score += 1;
      }
    });
    
    // Perguntas indicam interesse
    const questionCount = leadMessages.filter(m => m.content?.includes('?')).length;
    score += Math.min(questionCount, 3);
    
    if (score >= 7) return 'hot';
    if (score >= 3) return 'warm';
    return 'cold';
  }

  /**
   * Calcula score de engajamento (0-100)
   */
  private calculateEngagementScore(allMessages: any[]): number {
    if (allMessages.length === 0) return 0;
    
    let score = 0;
    
    // Proporção de mensagens do lead vs total
    const leadMessages = allMessages.filter(m => m.direction === 'incoming');
    const ratio = leadMessages.length / allMessages.length;
    score += Math.round(ratio * 40);
    
    // Mensagens mais longas = mais engajado
    const avgLength = leadMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / (leadMessages.length || 1);
    if (avgLength > 100) score += 30;
    else if (avgLength > 50) score += 20;
    else if (avgLength > 20) score += 10;
    
    // Quantidade total de interações
    if (allMessages.length > 20) score += 30;
    else if (allMessages.length > 10) score += 20;
    else if (allMessages.length > 5) score += 10;
    
    return Math.min(score, 100);
  }

  /**
   * Salva contexto da conversa no banco para uso futuro
   */
  private async saveConversationContext(leadId: string, context: ConversationContextSummary) {
    try {
      await this.supabase
        .from('conversation_context_summary')
        .upsert({
          lead_id: leadId,
          organization_id: this.organizationId,
          last_topic: context.lastTopic,
          last_intent: context.lastIntent,
          key_points: context.keyPoints,
          objections_raised: context.objectionsRaised,
          questions_asked: context.questionsAsked,
          next_action: context.nextAction,
          qualification_data: context.qualificationData,
          lead_temperature: context.leadTemperature,
          engagement_score: context.engagementScore,
          last_message_at: context.lastMessageAt,
          message_count: context.messageCount,
          followup_count: context.followupCount,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'lead_id',
        });
      console.log('[AgentEngine] Conversation context saved');
    } catch (e) {
      console.warn('[AgentEngine] Failed to save conversation context:', e);
    }
  }

  /**
   * Create Conversation
   */
  private async createConversation(leadId: string, agentId: string) {
    console.log('[AgentEngine] Creating conversation for lead:', leadId, 'agent:', agentId);
    
    const { data, error } = await this.supabase
      .from('conversations')
      .insert({
        lead_id: leadId,
        organization_id: this.organizationId,
        agent_id: agentId,
        state: 'NEW_LEAD',
        turn_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('[AgentEngine] Error creating conversation:', error);
      // Se a tabela não existir, criar conversa em memória
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.warn('[AgentEngine] Creating in-memory conversation');
        return {
          id: `temp_${leadId}`,
          lead_id: leadId,
          organization_id: this.organizationId,
          agent_id: agentId,
          state: 'NEW_LEAD',
          turn_count: 0,
          context: {},
          short_term_memory: [],
          long_term_memory: {},
        };
      }
      throw error;
    }

    console.log('[AgentEngine] Conversation created:', data?.id);
    return data;
  }

  /**
   * Build Dynamic Prompt (integra com prompt do quiz + capabilities dinâmicas)
   * 
   * Prioridade:
   * 1. Usa system_prompt do banco (gerado pelo quiz) se existir
   * 2. Se não, gera prompt completo baseado nas configurações do agente
   * 3. Adiciona capabilities dinâmicas (feature flags) ao final
   * 4. Adiciona dados do lead para contexto personalizado
   */
  private buildDynamicPrompt(capabilities: any, conversation: any, leadData?: any, documentSummaries?: Array<{file_name: string; summary: string}>, semanticContext?: string, longTermMemories?: string): string {
    const sections: string[] = [];

    // =====================================================
    // 1. USAR PROMPT DO QUIZ (se existir) OU GERAR COMPLETO
    // =====================================================
    if (capabilities.system_prompt) {
      // Usar prompt gerado pelo quiz (mais completo e personalizado)
      sections.push(capabilities.system_prompt);
    } else {
      // Gerar prompt completo baseado nas configurações do agente (mesma lógica do quiz)
      const businessContext = (capabilities.business_context || {}) as Record<string, any>;
      const conversationStyle = (capabilities.conversation_style || {}) as Record<string, any>;
      const qualificationRules = (capabilities.qualification_rules || {}) as Record<string, any>;
      const fewShotExamples = (capabilities.few_shot_examples || []) as Array<{
        lead: string;
        agent: string;
      }>;
      const availability = (capabilities.availability || {}) as Record<string, any>;
      const responseDelaySeconds = capabilities.response_delay_seconds ?? 0;

      const appendIf = (label: string, value?: string) => {
        if (value && value.trim()) {
          sections.push(`- ${label}: ${value}`);
        }
      };

      sections.push("# IDENTIDADE DO AGENTE");
      sections.push("");
      const companyName = businessContext.companyName?.trim();
      sections.push(
        `Você é ${capabilities.name || 'Assistente de Vendas'}, assistente virtual${companyName ? ` da ${companyName}` : ""} especializado em vendas B2B.`
      );
      sections.push(`Template: ${capabilities.template_type || 'custom'}`);
      sections.push("");

      sections.push("# PERSONALIDADE");
      sections.push("");
      sections.push(`Tom de voz: ${capabilities.personality_tone || 'profissional'}`);
      sections.push(`Estilo de comunicação: ${capabilities.personality_style || 'consultivo'}`);
      sections.push(`Nível de energia: ${capabilities.personality_energy || 'moderada'}`);
      sections.push("");

      // Objetivo: usa objective_composite se disponível, senão fallback para main_objective
      sections.push("# OBJETIVO PRINCIPAL");
      sections.push("");
      const objectiveComposite = capabilities.objective_composite as { mission?: string; success_criteria?: string; limits?: string } | null;
      if (objectiveComposite && objectiveComposite.mission) {
        sections.push("## Missão");
        sections.push(objectiveComposite.mission);
        sections.push("");
        if (objectiveComposite.success_criteria) {
          sections.push("## Critério de Sucesso");
          sections.push(objectiveComposite.success_criteria);
          sections.push("");
        }
        if (objectiveComposite.limits) {
          sections.push("## Limites");
          sections.push(objectiveComposite.limits);
          sections.push("");
        }
      } else {
        sections.push(capabilities.main_objective || 'Qualificar leads e agendar reuniões');
        sections.push("");
      }

      if (Object.keys(businessContext).length > 0) {
        sections.push("# CONTEXTO DO NEGÓCIO");
        sections.push("");
        appendIf("Empresa/Marca", businessContext.companyName);
        appendIf("Produto/Serviço", businessContext.productSummary);
        appendIf("Perfil de cliente ideal", businessContext.idealCustomerProfile);
        appendIf("Região/Atendimento", businessContext.serviceRegion);
        appendIf("Proposta de valor", businessContext.valueProps);
        appendIf("Dores que resolve", businessContext.customerPains);
        appendIf("Prova social", businessContext.socialProof);
        appendIf("Política de preço", businessContext.pricingPolicy);
        appendIf("Condições comerciais", businessContext.commercialTerms);
        appendIf("Horários/SLA", businessContext.businessHoursSla);
        appendIf("Próximo passo padrão", businessContext.primaryCta);
        appendIf("Compliance/Políticas", businessContext.compliancePolicy);
        sections.push("");
      }

      if (Object.keys(conversationStyle).length > 0) {
        sections.push("# ESTILO DE CONVERSA (WHATSAPP)");
        sections.push("");
        if (conversationStyle.responseLength === "curto") {
          sections.push("- Responda em 1–3 frases curtas por padrão");
        } else if (conversationStyle.responseLength === "medio") {
          sections.push("- Responda em 3–6 frases quando necessário");
        } else if (conversationStyle.responseLength === "detalhado") {
          sections.push("- Só responda detalhado quando o lead pedir");
        }
        if (conversationStyle.maxQuestions === "1") {
          sections.push("- Faça no máximo 1 pergunta por mensagem");
        } else if (conversationStyle.maxQuestions === "2") {
          sections.push("- Faça no máximo 2 perguntas por mensagem");
        }
        if (conversationStyle.emojiPolicy === "nunca") {
          sections.push("- Não use emojis");
        } else if (conversationStyle.emojiPolicy === "raro") {
          sections.push("- Use emojis raramente (no máximo 1)");
        } else if (conversationStyle.emojiPolicy === "moderado") {
          sections.push("- Use emojis apenas se o lead usar primeiro");
        }
        appendIf("Abertura preferida", conversationStyle.openingStyle);
        appendIf("Fechamento preferido", conversationStyle.closingStyle);
        if (conversationStyle.whatsappGuidelines) {
          sections.push("");
          sections.push("Diretrizes adicionais:");
          sections.push(conversationStyle.whatsappGuidelines);
        }
        if (conversationStyle.humanizationTips) {
          sections.push("");
          sections.push("Dicas de humanização:");
          sections.push(conversationStyle.humanizationTips);
        }
        sections.push("");
      }

      if (qualificationRules) {
        const requiredFields = (qualificationRules.requiredFields || []) as string[];
        const optionalFields = (qualificationRules.optionalFields || []) as string[];
        if (requiredFields.length > 0 || optionalFields.length > 0 || qualificationRules.notes) {
          sections.push("# QUALIFICAÇÃO MÍNIMA");
          sections.push("");
          if (requiredFields.length > 0) {
            sections.push("Campos obrigatórios (prioridade):");
            requiredFields.forEach((field) => sections.push(`- ${field}`));
            sections.push("");
          }
          if (optionalFields.length > 0) {
            sections.push("Campos opcionais:");
            optionalFields.forEach((field) => sections.push(`- ${field}`));
            sections.push("");
          }
          if (qualificationRules.notes) {
            sections.push("Observações:");
            sections.push(String(qualificationRules.notes));
            sections.push("");
          }
        }
      }

      if (capabilities.can_qualify_lead) {
        sections.push("# MOVIMENTAÇÃO DE FUNIL (FERRAMENTAS)");
        sections.push("");
        sections.push("Use as ferramentas qualify_lead, disqualify_lead e advance_stage para mover o lead no funil:");
        sections.push("- qualify_lead: quando o lead reuniu os critérios obrigatórios e está pronto (ex: agendou ou demonstrou fit)");
        sections.push("- disqualify_lead: quando o lead não se encaixa (sem necessidade, fora do perfil, sem orçamento, desistiu)");
        sections.push("- advance_stage: quando o lead progrediu na jornada (ex: respondeu → qualificado, ou qualquer outra transição de etapa)");
        sections.push("Essencial: movimente o lead conforme a conversa evolui. Não deixe leads qualificados ou desqualificados sem usar a ferramenta.");
        sections.push("");
      }

      if (availability.mode) {
        sections.push("# DISPONIBILIDADE");
        sections.push("");
        if (availability.mode === "always") {
          sections.push("- Atendimento: 24 horas");
        } else {
          const days = Array.isArray(availability.days) ? availability.days.join(", ") : "";
          appendIf("Dias", days);
          appendIf("Horário", availability.start && availability.end ? `${availability.start}–${availability.end}` : "");
          appendIf("Fuso", availability.timezone);
        }
        if (responseDelaySeconds && responseDelaySeconds > 0) {
          sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
        }
        sections.push("");
      }

      // Habilidades
      if (capabilities.skills && capabilities.skills.length > 0) {
        sections.push("# HABILIDADES");
        sections.push("");
        sections.push("Você possui as seguintes habilidades:");
        capabilities.skills.forEach((skill: string) => {
          sections.push(`- ${skill}`);
        });
        sections.push("");
      }

      // Tópicos Permitidos
      if (capabilities.allowed_topics && capabilities.allowed_topics.length > 0) {
        sections.push("# O QUE VOCÊ PODE DISCUTIR");
        sections.push("");
        sections.push("Você está autorizado a discutir sobre:");
        capabilities.allowed_topics.forEach((topic: string) => {
          sections.push(`- ${topic}`);
        });
        sections.push("");
      }

      // Tópicos Proibidos
      if (capabilities.forbidden_topics && capabilities.forbidden_topics.length > 0) {
        sections.push("# O QUE VOCÊ NÃO PODE DISCUTIR");
        sections.push("");
        sections.push(
          "⚠️ IMPORTANTE: Você NÃO DEVE, em hipótese alguma, discutir sobre:"
        );
        capabilities.forbidden_topics.forEach((topic: string) => {
          sections.push(`- ${topic}`);
        });
        sections.push("");
        sections.push(
          "Se o cliente perguntar sobre esses tópicos, redirecione educadamente para um humano."
        );
        sections.push("");
      }

      // FAQs
      if (capabilities.copilot_agent_faqs && capabilities.copilot_agent_faqs.length > 0) {
        sections.push("# PERGUNTAS FREQUENTES");
        sections.push("");
        sections.push(
          "Se o cliente fizer perguntas similares a estas, use as respostas abaixo como base:"
        );
        sections.push("");

        capabilities.copilot_agent_faqs
          .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
          .forEach((faq: any, index: number) => {
            sections.push(`## FAQ ${index + 1}`);
            sections.push(`**Pergunta:** ${faq.question}`);
            sections.push(`**Resposta:** ${faq.answer}`);
            sections.push("");
          });
      }

      if (fewShotExamples && fewShotExamples.length > 0) {
        sections.push("# EXEMPLOS DE CONVERSA (IMITE O ESTILO)");
        sections.push("");
        fewShotExamples.slice(0, 5).forEach((example, index) => {
          sections.push(`## Exemplo ${index + 1}`);
          sections.push(`Lead: ${example.lead}`);
          sections.push(`Agente: ${example.agent}`);
          sections.push("");
        });
      }

      // Instruções personalizadas do usuário (Do's & Don'ts)
      const rawCustom = (capabilities.custom_instructions as string) || "";
      if (rawCustom.trim()) {
        const parsed = parseCustomInstructions(rawCustom);
        if (parsed.dos.trim()) {
          sections.push("# O QUE VOCÊ DEVE FAZER");
          sections.push("");
          sections.push(parsed.dos.trim());
          sections.push("");
        }
        if (parsed.donts.trim()) {
          sections.push("# O QUE VOCÊ NUNCA DEVE FAZER (INSTRUÇÕES DO OPERADOR)");
          sections.push("");
          sections.push("⚠️ As regras abaixo têm PRIORIDADE MÁXIMA e sobrepõem qualquer outra instrução:");
          sections.push("");
          sections.push(parsed.donts.trim());
          sections.push("");
        }
      }
    }

    // =====================================================
    // 1.5 KNOWLEDGE BASE (document summaries — runtime injection)
    // =====================================================
    if (documentSummaries && documentSummaries.length > 0) {
      sections.push("");
      sections.push("# BASE DE CONHECIMENTO CORPORATIVO");
      sections.push("");
      sections.push("Use as informações abaixo como fonte de referência para responder perguntas do lead. Estas foram extraídas de documentos oficiais da empresa.");
      sections.push("");
      documentSummaries.forEach((doc, index) => {
        sections.push(`## Documento ${index + 1}: ${doc.file_name}`);
        sections.push(doc.summary);
        sections.push("");
      });
      sections.push("**IMPORTANTE:** Quando usar informações dos documentos, não mencione 'segundo o documento' — fale como se fosse conhecimento natural da empresa.");
      sections.push("");
    }

    // =====================================================
    // 1.55 LONG-TERM MEMORIES (item #19)
    // Fatos e preferências do lead recuperados de conversas anteriores
    // =====================================================
    if (longTermMemories && longTermMemories.trim().length > 0) {
      sections.push("");
      sections.push("# MEMÓRIA DE LONGO PRAZO DO LEAD");
      sections.push("Informações importantes sobre este lead de conversas anteriores:");
      sections.push(longTermMemories);
      sections.push("**Use este contexto para personalizar a conversa. Não mencione que tem memória prévia.**");
      sections.push("");
    }

    // =====================================================
    // 1.6 SEMANTIC CONTEXT (RAG — item #5 + #6)
    // Chunks de documentos e FAQs recuperados por similaridade semântica
    // =====================================================
    if (semanticContext && semanticContext.trim().length > 0) {
      sections.push("");
      sections.push("# CONTEXTO SEMÂNTICO RELEVANTE (recuperado por similaridade)");
      sections.push("As informações abaixo foram selecionadas automaticamente por serem relevantes à pergunta atual do lead.");
      sections.push(semanticContext);
      sections.push("**IMPORTANTE:** Use este contexto como referência, mas responda de forma natural, sem mencionar que recuperou essas informações.");
      sections.push("");
    }

    // =====================================================
    // 2. ADICIONAR CAPABILITIES DINÂMICAS (Feature Flags)
    // =====================================================
    sections.push("# CAPABILITIES DINÂMICAS");
    sections.push("");
    sections.push("Estado atual da conversa: " + conversation.state);
    sections.push("Turno: " + conversation.turn_count);
    sections.push("");

    sections.push("## CAPABILITIES ATIVAS (você PODE fazer):");
    if (capabilities.can_qualify_lead) {
      sections.push("- Qualificar leads fazendo perguntas sobre tamanho da empresa, urgência, orçamento");
    }
    if (capabilities.can_schedule_meeting) {
      sections.push("- Agendar reuniões usando a ferramenta schedule_meeting");
    }
    if (capabilities.can_send_followup) {
      sections.push("- Criar follow-ups automáticos");
    }
    if (capabilities.can_update_crm) {
      sections.push("- Atualizar CRM externo do cliente");
    }
    if (capabilities.can_update_lead) {
      sections.push("- Atualizar informações do lead no CRM (empresa, segmento, campos personalizados, notas) usando update_lead");
    }
    if (capabilities.can_create_lead) {
      sections.push("- Criar novos leads no sistema");
    }
    if (capabilities.can_transfer_human) {
      sections.push("- Transferir para atendimento humano se necessário");
    }
    sections.push("");

    sections.push("## CAPABILITIES DESATIVADAS (você NÃO PODE fazer):");
    if (!capabilities.can_qualify_lead) sections.push("- Qualificar leads");
    if (!capabilities.can_schedule_meeting) sections.push("- Agendar reuniões");
    if (!capabilities.can_update_crm) sections.push("- Atualizar CRM");
    if (!capabilities.can_update_lead) sections.push("- Atualizar lead no CRM");
    if (!capabilities.can_create_lead) sections.push("- Criar novos leads");
    sections.push("");

    // =====================================================
    // 3. CONTEXTO DA ÚLTIMA CONVERSA (para follow-up inteligente)
    // =====================================================
    if (this.conversationContext && this.conversationContext.messageCount > 0) {
      sections.push("# CONTEXTO DA ÚLTIMA CONVERSA");
      sections.push("");
      sections.push("⚠️ IMPORTANTE: Use estas informações para continuar a conversa de forma natural e contextualizada.");
      sections.push("");
      
      if (this.conversationContext.lastTopic) {
        sections.push(`**Último assunto discutido:** ${this.conversationContext.lastTopic}`);
      }
      if (this.conversationContext.lastIntent) {
        sections.push(`**Última intenção detectada:** ${this.conversationContext.lastIntent}`);
      }
      sections.push(`**Temperatura do lead:** ${this.conversationContext.leadTemperature.toUpperCase()}`);
      sections.push(`**Score de engajamento:** ${this.conversationContext.engagementScore}/100`);
      sections.push(`**Total de mensagens trocadas:** ${this.conversationContext.messageCount}`);
      
      if (this.conversationContext.lastMessageAt) {
        const lastDate = new Date(this.conversationContext.lastMessageAt);
        const now = new Date();
        const diffMs = now.getTime() - lastDate.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffDays > 0) {
          sections.push(`**Tempo desde última mensagem:** ${diffDays} dia(s)`);
        } else if (diffHours > 0) {
          sections.push(`**Tempo desde última mensagem:** ${diffHours} hora(s)`);
        }
      }
      
      if (this.conversationContext.keyPoints.length > 0) {
        sections.push("");
        sections.push("**Pontos-chave mencionados pelo lead:**");
        this.conversationContext.keyPoints.forEach((point, i) => {
          sections.push(`${i + 1}. "${point}"`);
        });
      }
      
      if (this.conversationContext.objectionsRaised.length > 0) {
        sections.push("");
        sections.push("**Objeções levantadas anteriormente:**");
        this.conversationContext.objectionsRaised.forEach((obj, i) => {
          sections.push(`${i + 1}. "${obj}"`);
        });
        sections.push("");
        sections.push("→ Se estas objeções surgirem novamente, aborde-as diretamente.");
      }
      
      if (this.conversationContext.questionsAsked.length > 0) {
        sections.push("");
        sections.push("**Perguntas feitas pelo lead:**");
        this.conversationContext.questionsAsked.forEach((q, i) => {
          sections.push(`${i + 1}. "${q}"`);
        });
        sections.push("");
        sections.push("→ Se alguma pergunta não foi respondida, priorize respondê-la.");
      }
      
      sections.push("");
      sections.push("**COMO USAR ESTE CONTEXTO:**");
      sections.push("- Retome o último assunto naturalmente ('Na nossa última conversa você mencionou...')");
      sections.push("- Se lead estava interessado: avance para próximo passo");
      sections.push("- Se lead tinha objeção: endereça antes de avançar");
      sections.push("- Se lead fez pergunta não respondida: responda primeiro");
      sections.push("");
    }

    // =====================================================
    // 4. DADOS DO LEAD (contexto personalizado)
    // =====================================================
    if (leadData) {
      sections.push("# INFORMAÇÕES DO LEAD");
      sections.push("");
      sections.push("IMPORTANTE: Use estas informações para personalizar sua conversa. Chame o lead pelo nome quando apropriado.");
      sections.push("");
      
      // Dados básicos
      if (leadData.name) sections.push(`- Nome: ${leadData.name}`);
      if (leadData.phone) sections.push(`- Telefone: ${leadData.phone}`);
      if (leadData.email) sections.push(`- Email: ${leadData.email}`);
      if (leadData.company) sections.push(`- Empresa: ${leadData.company}`);
      if (leadData.segment) sections.push(`- Segmento: ${leadData.segment}`);
      if (leadData.faturamento) sections.push(`- Faturamento: ${leadData.faturamento}`);
      if (leadData.urgency) sections.push(`- Urgência: ${leadData.urgency}`);
      if (leadData.rating) sections.push(`- Rating/Score: ${leadData.rating}/10`);
      if (leadData.origin) sections.push(`- Origem: ${leadData.origin}`);
      if (leadData.pipe_whatsapp) sections.push(`- Etapa no funil: ${leadData.pipe_whatsapp}`);
      if (leadData.notes) sections.push(`- Observações: ${leadData.notes}`);
      
      // Campos personalizados
      if (leadData.customFields && Object.keys(leadData.customFields).length > 0) {
        sections.push("");
        sections.push("## Campos Personalizados:");
        for (const [fieldName, value] of Object.entries(leadData.customFields)) {
          sections.push(`- ${fieldName}: ${value}`);
        }
      }
      
      sections.push("");
    }

    // =====================================================
    // 4.1 REGRAS DA ETAPA ATUAL (Kanban) - contexto por stage
    // =====================================================
    const kanbanRules = capabilities?.copilot_agent_kanban_rules;
    const currentStage = leadData?.pipe_whatsapp?.trim();
    if (kanbanRules && Array.isArray(kanbanRules) && kanbanRules.length > 0 && currentStage) {
      const rule = kanbanRules.find(
        (r: { pipe_type?: string; stage_name?: string }) =>
          r?.pipe_type === 'whatsapp' && r?.stage_name?.toLowerCase() === currentStage?.toLowerCase()
      );
      if (rule) {
        sections.push("# REGRAS DA ETAPA ATUAL (Kanban)");
        sections.push("");
        sections.push(`Você está conversando com um lead na etapa "${rule.stage_name}" do funil WhatsApp.`);
        sections.push("");
        if (rule.goal) sections.push(`**Objetivo desta etapa:** ${rule.goal}`);
        if (rule.behavior) sections.push(`**Comportamento esperado:** ${rule.behavior}`);
        if (rule.allowed_actions && Array.isArray(rule.allowed_actions) && rule.allowed_actions.length > 0) {
          sections.push(`**Ações permitidas:** ${rule.allowed_actions.join(", ")}`);
        }
        if (rule.forbidden_actions && Array.isArray(rule.forbidden_actions) && rule.forbidden_actions.length > 0) {
          sections.push(`**Ações proibidas:** ${rule.forbidden_actions.join(", ")}`);
        }
        sections.push("");
        sections.push("Siga rigorosamente estas regras ao decidir sua próxima resposta.");
        sections.push("");
      }
    }

    // =====================================================
    // 5. CONTEXTO DA CONVERSA
    // =====================================================
    sections.push("# CONTEXTO DA CONVERSA");
    sections.push("");
    if (conversation.context && Object.keys(conversation.context).length > 0) {
      sections.push("Informações adicionais coletadas durante a conversa:");
      sections.push(JSON.stringify(conversation.context, null, 2));
      sections.push("");
    }
    sections.push("Baseado no estado atual, nas capabilities ativas, nos dados do lead e no contexto coletado, decida a próxima melhor ação.");

    // =====================================================
    // 6. INSTRUÇÕES FINAIS
    // =====================================================
    sections.push("");
    sections.push("# INSTRUÇÕES FINAIS");
    sections.push("");
    sections.push("- Sempre mantenha o tom e estilo definidos na sua personalidade");
    sections.push("- Respeite rigorosamente os tópicos permitidos e proibidos");
    sections.push("- Use as FAQs como base, mas adapte a resposta ao contexto específico");
    sections.push("- Se perguntarem, seja transparente: você é um assistente virtual da empresa");
    sections.push("- Evite linguagem de IA; responda de forma natural");
    sections.push("- Seja sempre ético, transparente e profissional");
    sections.push("- Em caso de dúvida ou situação complexa, transfira para um humano");
    sections.push("- Nunca invente informações - se não souber, admita e ofereça alternativa");
    sections.push("- Mantenha o foco no objetivo principal sem ser insistente ou agressivo");

    return sections.join("\n");
  }

  /**
   * Build Dynamic Tools (baseado em capabilities)
   */
  private buildDynamicTools(
    capabilities: any,
    orgCustomFields: { field_name: string }[] = [],
    pipelineStages: { stage_key: string; name: string }[] = []
  ) {
    const tools: any[] = [];

    if (capabilities.can_schedule_meeting) {
      tools.push({
        name: 'schedule_meeting',
        description: 'Agenda uma reunião para o lead. Se o responsável tiver Google Calendar conectado, cria o evento automaticamente e gera link do Google Meet.',
        input_schema: {
          type: 'object',
          properties: {
            preferred_date: { type: 'string', description: 'Data preferida (YYYY-MM-DD)' },
            preferred_time: { type: 'string', description: 'Horário preferido (HH:MM, padrão 09:00)' },
          },
          required: ['preferred_date'],
        },
      });
    }

    if (capabilities.can_create_lead) {
      tools.push({
        name: 'create_lead',
        description: 'Cria um novo lead no CRM',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            company: { type: 'string' },
          },
          required: ['name'],
        },
      });
    }

    if (capabilities.can_update_crm) {
      tools.push({
        name: 'update_crm',
        description: 'Atualiza informações no CRM externo',
        input_schema: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['field', 'value'],
        },
      });
    }

    if (capabilities.can_update_lead) {
      const customNames = orgCustomFields.length > 0
        ? orgCustomFields.map((f) => f.field_name).join(', ')
        : 'nenhum';
      tools.push({
        name: 'update_lead',
        description: `Atualiza informações do lead no CRM v8. Campos padrão: company, segment, urgency, faturamento, rating. Campos personalizados disponíveis: ${customNames}. Qualquer outra informação (ex: preferência, orçamento) vai para notas/observações do lead.`,
        input_schema: {
          type: 'object',
          properties: {
            updates: {
              type: 'object',
              description: 'Objeto chave-valor. Ex: {"company": "Acme", "segment": "B2B", "Preferência de horário": "manhã"}',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['updates'],
        },
      });
    }

    if (capabilities.can_qualify_lead) {
      // Item #14: Score progressivo de qualificação
      tools.push({
        name: 'update_qualification_score',
        description: 'Atualiza o score de qualificação do lead (0-100) conforme coleta informações. Use após cada resposta relevante do lead. Score sugerido: 20 por critério atendido (necessidade, orçamento, urgência, perfil, timing).',
        input_schema: {
          type: 'object',
          properties: {
            score: { type: 'number', description: 'Novo score de qualificação (0-100)' },
            reason: { type: 'string', description: 'O que o lead revelou que justifica este score' },
          },
          required: ['score'],
        },
      });
      tools.push({
        name: 'qualify_lead',
        description: 'Marca o lead como qualificado quando reuniu os critérios necessários (necessidade, volume, urgência, orçamento etc.)',
        input_schema: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Breve justificativa da qualificação (opcional)' },
          },
          required: [],
        },
      });
      tools.push({
        name: 'disqualify_lead',
        description: 'Marca o lead como desqualificado quando não se encaixa (sem necessidade, fora do perfil, sem orçamento etc.)',
        input_schema: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Motivo da desqualificação (opcional)' },
          },
          required: [],
        },
      });
      const stageKeys = pipelineStages.length > 0
        ? pipelineStages.map((s) => s.stage_key).join(', ')
        : 'novo, abordado, respondeu, esfriou, agendado';
      tools.push({
        name: 'advance_stage',
        description: `Avança o lead para outra etapa do funil. Etapas disponíveis: ${stageKeys}. Use quando o lead progredir na jornada.`,
        input_schema: {
          type: 'object',
          properties: {
            target_stage: { type: 'string', description: `Etapa de destino (um de: ${stageKeys})` },
          },
          required: ['target_stage'],
        },
      });
    }

    // Confirmador de reuniões: confirmar presença e mover entre etapas do pipe confirmação
    if (capabilities.can_schedule_meeting) {
      tools.push({
        name: 'confirm_meeting',
        description: 'Confirma a presença do lead na reunião. Marca como pré-confirmado ou confirmado no pipe de Confirmação. Use quando o lead disser que vai comparecer.',
        input_schema: {
          type: 'object',
          properties: {
            confirmation_type: {
              type: 'string',
              enum: ['pre_confirmed', 'confirmed'],
              description: 'Tipo de confirmação: pre_confirmed (pré-confirmado, antes do dia) ou confirmed (confirmado no dia)',
            },
          },
          required: ['confirmation_type'],
        },
      });
      tools.push({
        name: 'advance_confirmation_stage',
        description: 'Move o lead para outra etapa do funil de confirmação. Etapas: reuniao_marcada, confirmar_d5, confirmar_d3, confirmar_d1, confirmacao_no_dia, remarcar, compareceu, perdido. Use para avançar ou reagendar no pipe de confirmação.',
        input_schema: {
          type: 'object',
          properties: {
            target_stage: {
              type: 'string',
              enum: ['reuniao_marcada', 'confirmar_d5', 'confirmar_d3', 'confirmar_d1', 'confirmacao_no_dia', 'remarcar', 'compareceu', 'perdido'],
              description: 'Etapa de destino no pipe de confirmação',
            },
          },
          required: ['target_stage'],
        },
      });
    }

    if (capabilities.can_transfer_human) {
      tools.push({
        name: 'transfer_to_human',
        description: 'Transfere conversa para atendimento humano',
        input_schema: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
          required: ['reason'],
        },
      });
    }

    // Tool para criar campos personalizados no CRM em runtime
    if (capabilities.can_create_custom_field) {
      tools.push({
        name: 'create_custom_field',
        description: 'Cria um novo campo personalizado no CRM para armazenar informacoes do lead que nao existem nos campos padrao. Use quando precisar registrar uma informacao que nao tem campo dedicado. Tipos: text (texto livre), number (numerico), date (data), select (opcoes), boolean (sim/nao).',
        input_schema: {
          type: 'object',
          properties: {
            field_name: { type: 'string', description: 'Nome do campo (ex: "Orcamento estimado", "Ferramenta atual", "Numero de funcionarios")' },
            field_type: { type: 'string', enum: ['text', 'number', 'date', 'select', 'boolean'], description: 'Tipo do campo' },
            field_options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Opcoes disponiveis (obrigatorio se field_type = select). Ex: ["Pequeno", "Medio", "Grande"]',
            },
            initial_value: { type: 'string', description: 'Valor inicial para preencher no lead atual (opcional)' },
          },
          required: ['field_name', 'field_type'],
        },
      });
    }

    return tools;
  }

  /**
   * Get Conversation History
   * Tenta buscar de conversation_messages, se falhar usa whatsapp_messages como fallback
   */
  private async getConversationHistory(conversationId: string) {
    try {
      // Se for conversa temporária, usar whatsapp_messages como histórico
      if (conversationId.startsWith('temp_')) {
        console.log('[AgentEngine] Temporary conversation, using whatsapp_messages as history');
        return await this.getWhatsAppMessageHistory();
      }

      const { data: messages, error } = await this.supabase
        .from('conversation_messages')
        .select('id, conversation_id, role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100); // busca mais para verificar se precisa comprimir

      if (error) {
        console.warn('[AgentEngine] Error getting conversation history, falling back to whatsapp_messages:', error.message);
        return await this.getWhatsAppMessageHistory();
      }

      if (!messages || messages.length === 0) {
        console.log('[AgentEngine] No conversation_messages found, using whatsapp_messages');
        return await this.getWhatsAppMessageHistory();
      }

      // Compressão automática de histórico quando excede o limite (item #1)
      if (messages.length > this.HISTORY_COMPRESS_THRESHOLD) {
        console.log(`[AgentEngine] History has ${messages.length} messages — scheduling background compression`);

        // Verificar se já existe resumo (compressão anterior)
        const firstMsg = messages[0];
        if (firstMsg?.content?.startsWith('[RESUMO HISTÓRICO]')) {
          // Resumo já existe — retornar resumo + recentes (fast path, sem LLM)
          const recentMessages = messages.slice(-this.HISTORY_KEEP_RECENT);
          return [
            { role: 'user' as const, content: firstMsg.content },
            { role: 'assistant' as const, content: messages[1]?.content || 'Entendido.' },
            ...recentMessages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ];
        }

        // Sem resumo ainda — fire-and-forget compressão em background, retornar recentes imediatamente
        this.compressHistoryIfNeeded(conversationId, messages)
          .catch(e => console.warn('[AgentEngine] Background history compression failed (non-fatal):', e));

        const recentMessages = messages.slice(-this.HISTORY_KEEP_RECENT);
        return recentMessages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      }

      return messages.map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));
    } catch (e) {
      console.warn('[AgentEngine] Failed to get conversation history:', e);
      return await this.getWhatsAppMessageHistory();
    }
  }

  /**
   * Comprime histórico antigo em um resumo para economizar tokens (item #1)
   * Mantém os HISTORY_KEEP_RECENT mais recentes verbatim + resumo das anteriores
   */
  private async compressHistoryIfNeeded(
    conversationId: string,
    messages: any[]
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    // Verificar se já existe mensagem de resumo (compressão anterior)
    const firstMsg = messages[0];
    if (firstMsg?.content?.startsWith('[RESUMO HISTÓRICO]')) {
      // Já existe resumo — apenas retorna resumo + mensagens recentes
      const recentMessages = messages.slice(-this.HISTORY_KEEP_RECENT);
      return [
        { role: 'user' as const, content: firstMsg.content },
        { role: 'assistant' as const, content: messages[1]?.content || 'Entendido.' },
        ...recentMessages.map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];
    }

    // Dividir: mensagens antigas (a comprimir) + recentes (manter verbatim)
    const oldMessages = messages.slice(0, -this.HISTORY_KEEP_RECENT);
    const recentMessages = messages.slice(-this.HISTORY_KEEP_RECENT);

    try {
      const conversationText = oldMessages
        .filter((m: any) => !m.content?.startsWith('[RESUMO HISTÓRICO]'))
        .map((m: any) => `${m.role === 'user' ? 'Lead' : 'Agente'}: ${m.content}`)
        .join('\n');

      const summaryResponse = await this.openRouter.chat({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: 'Você é um assistente de CRM. Resuma a conversa abaixo em 4-6 frases incluindo: tópicos discutidos, nível de interesse, objeções levantadas, informações coletadas do lead, e estado atual. Seja objetivo. Retorne apenas o resumo em português.',
          },
          { role: 'user', content: `Histórico de ${oldMessages.length} mensagens:\n\n${conversationText}` },
        ],
        temperature: 0.2,
        max_tokens: 400,
      });

      const summary = summaryResponse.choices[0]?.message?.content?.trim() || '';

      if (summary) {
        const summaryContent = `[RESUMO HISTÓRICO]\n${summary}`;
        const ackContent = 'Entendido. Continuarei com base no histórico resumido.';

        // Deletar mensagens antigas do banco e inserir par de resumo
        const oldIds = oldMessages.map((m: any) => m.id).filter(Boolean);
        if (oldIds.length > 0) {
          await this.supabase
            .from('conversation_messages')
            .delete()
            .in('id', oldIds);
        }

        const earliestDate = oldMessages[0]?.created_at || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const secondDate = new Date(new Date(earliestDate).getTime() + 1000).toISOString();

        await this.supabase.from('conversation_messages').insert([
          { conversation_id: conversationId, role: 'user', content: summaryContent, created_at: earliestDate },
          { conversation_id: conversationId, role: 'assistant', content: ackContent, created_at: secondDate },
        ]);

        console.log(`[AgentEngine] History compressed: ${oldMessages.length} msgs → 1 summary`);

        return [
          { role: 'user' as const, content: summaryContent },
          { role: 'assistant' as const, content: ackContent },
          ...recentMessages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ];
      }
    } catch (err) {
      console.warn('[AgentEngine] History compression failed (non-fatal):', err);
    }

    // Fallback: retorna apenas as mensagens recentes sem comprimir
    return recentMessages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }

  /**
   * Busca histórico de mensagens do WhatsApp para o lead atual
   * Usado como fallback quando conversations não está disponível
   */
  private async getWhatsAppMessageHistory(): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    if (!this.currentLeadId) {
      console.log('[AgentEngine] No currentLeadId, returning empty history');
      return [];
    }

    try {
      // Buscar telefone do lead
      const { data: lead, error: leadError } = await this.supabase
        .from('leads')
        .select('phone')
        .eq('id', this.currentLeadId)
        .single();

      if (leadError || !lead?.phone) {
        console.warn('[AgentEngine] Could not get lead phone for history');
        return [];
      }

      // Buscar mensagens do WhatsApp para este telefone
      const { data: messages, error: msgError } = await this.supabase
        .from('whatsapp_messages')
        .select('direction, content, created_at')
        .eq('organization_id', this.organizationId)
        .ilike('phone_number', `%${lead.phone.slice(-8)}%`)
        .eq('message_type', 'text')
        .not('content', 'is', null)
        .order('created_at', { ascending: true })
        .limit(50);

      if (msgError) {
        console.warn('[AgentEngine] Error getting whatsapp_messages:', msgError.message);
        return [];
      }

      console.log('[AgentEngine] Found', messages?.length || 0, 'whatsapp messages for history');

      return (messages || [])
        .filter((m: any) => m.content && m.content.trim())
        .map((m: any) => ({
          role: (m.direction === 'incoming' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        }));
    } catch (e) {
      console.warn('[AgentEngine] Failed to get whatsapp message history:', e);
      return [];
    }
  }

  /**
   * Process LLM Response (OpenRouter/OpenAI format)
   */
  private async processLLMResponse(response: any, conversation: any, capabilities: any) {
    let assistantMessage = '';
    let actionToExecute = null;
    let nextState = conversation.state;

    // OpenRouter retorna no formato OpenAI
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No response from LLM');
    }

    const message = choice.message;

    // Extrair resposta de texto
    if (message.content) {
      assistantMessage = message.content;
    }

    // Verificar se LLM usou tool (formato OpenAI)
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      const toolName = toolCall.function.name;
      let toolParams = {};
      
      try {
        toolParams = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error('Error parsing tool arguments:', e);
      }

      actionToExecute = {
        action: this.mapToolToAction(toolName),
        params: toolParams,
        tenant_id: this.organizationId,
      };

      // Atualizar estado baseado na ação
      nextState = this.determineNextState(conversation.state, toolName);
    }

    return { nextState, actionToExecute, assistantMessage };
  }

  /**
   * Map tool name to n8n action
   */
  private mapToolToAction(toolName: string): string {
    const mapping: Record<string, string> = {
      'schedule_meeting': 'SCHEDULE_MEETING',
      'create_lead': 'CREATE_LEAD',
      'update_crm': 'UPDATE_CRM',
      'update_lead': 'UPDATE_LEAD',
      'transfer_to_human': 'TRANSFER_HUMAN',
      'update_qualification_score': 'UPDATE_QUALIFICATION_SCORE',
      'qualify_lead': 'QUALIFY_LEAD',
      'disqualify_lead': 'DISQUALIFY_LEAD',
      'advance_stage': 'ADVANCE_STAGE',
      'confirm_meeting': 'CONFIRM_MEETING',
      'advance_confirmation_stage': 'ADVANCE_CONFIRMATION_STAGE',
      'create_custom_field': 'CREATE_CUSTOM_FIELD',
    };
    return mapping[toolName] || 'UNKNOWN';
  }

  /**
   * Determine next state based on action
   */
  private determineNextState(currentState: string, toolName: string): string {
    if (toolName === 'schedule_meeting') return 'SCHEDULED';
    if (toolName === 'transfer_to_human') return 'WAITING_HUMAN';
    if (toolName === 'qualify_lead') return 'QUALIFIED';
    if (toolName === 'disqualify_lead') return 'DISQUALIFIED';
    if (toolName === 'advance_stage') return currentState;
    if (toolName === 'confirm_meeting') return 'QUALIFIED'; // Confirmação dispara onQualify automation
    if (toolName === 'advance_confirmation_stage') return currentState;
    if (toolName === 'create_custom_field') return currentState;
    if (currentState === 'NEW_LEAD') return 'QUALIFYING';
    return currentState;
  }

  /**
   * Execute Action internamente (sem webhook) - toda lógica roda dentro do sistema
   */
  private async executeAction(action: any) {
    const tenantId = action.tenant_id || this.organizationId;
    const params = action.params || {};

    try {
      switch (action.action) {
        case 'SCHEDULE_MEETING':
          return await this.executeScheduleMeeting(params, tenantId);
        case 'CREATE_LEAD':
          return await this.executeCreateLead(params, tenantId);
        case 'UPDATE_CRM':
          return await this.executeUpdateCrm(params, tenantId);
        case 'UPDATE_LEAD':
          return await this.executeUpdateLead(params, tenantId);
        case 'TRANSFER_HUMAN':
          return await this.executeTransferHuman(params, tenantId);
        case 'UPDATE_QUALIFICATION_SCORE': {
          // Item #14: Score progressivo de qualificação
          const leadId = params.lead_id || this.currentLeadId;
          const score = Math.min(100, Math.max(0, Number(params.score) || 0));
          if (leadId) {
            await this.supabase
              .from('leads')
              .update({ qualification_score: score })
              .eq('id', leadId);
            console.log(`[AgentEngine] Qualification score updated: ${score} for lead ${leadId} | reason: ${params.reason || 'N/A'}`);
          }
          return { success: true, score };
        }
        case 'QUALIFY_LEAD':
        case 'DISQUALIFY_LEAD':
          // A qualificação real acontece via state machine:
          // processLLMResponse seta nextState = 'QUALIFIED'/'DISQUALIFIED'
          // executeAutomationActions dispara onQualify/onDisqualify com base no state
          console.log(`[AgentEngine] ${action.action} - será processada via state machine em executeAutomationActions`);
          return { success: true, message: `Ação ${action.action} registrada - automação será executada via state machine` };
        case 'ADVANCE_STAGE':
          return await this.executeAdvanceStage(params, tenantId);
        case 'CONFIRM_MEETING':
          return await this.executeConfirmMeeting(params, tenantId);
        case 'ADVANCE_CONFIRMATION_STAGE':
          return await this.executeAdvanceConfirmationStage(params, tenantId);
        case 'CREATE_CUSTOM_FIELD':
          return await this.executeCreateCustomField(params, tenantId);
        default:
          console.warn('[AgentEngine] Action não suportada:', action.action);
          return { success: false, error: `Ação não suportada: ${action.action}` };
      }
    } catch (err) {
      console.error('[AgentEngine] executeAction error:', err);
      return { success: false, error: String(err), status: 'error' };
    }
  }

  private async executeScheduleMeeting(params: any, tenantId: string) {
    const { lead_id, preferred_date, preferred_time } = params;
    if (!lead_id || !preferred_date) {
      return { success: false, error: 'lead_id e preferred_date são obrigatórios' };
    }

    // 1. Atualizar lead e pipe_confirmacao no banco (sempre executa)
    await this.supabase.from('leads').update({ compromisso_date: preferred_date }).eq('id', lead_id);

    const { data: existing } = await this.supabase
      .from('pipe_confirmacao')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    let pipeId: string | null = existing?.id ?? null;

    if (existing) {
      await this.supabase.from('pipe_confirmacao').update({
        status: 'reuniao_marcada',
        meeting_date: preferred_date,
      }).eq('id', existing.id);
    } else {
      const { data: inserted } = await this.supabase.from('pipe_confirmacao').insert({
        lead_id,
        organization_id: tenantId,
        status: 'reuniao_marcada',
        meeting_date: preferred_date,
      }).select('id').single();
      pipeId = inserted?.id ?? null;
    }

    // 2. Tentar criar evento no Google Calendar (graceful degradation)
    let meetLink: string | null = null;
    try {
      // Buscar dados do lead (nome, email, sdr_id)
      const { data: lead } = await this.supabase
        .from('leads')
        .select('name, email, sdr_id')
        .eq('id', lead_id)
        .maybeSingle();

      const responsibleUserId = lead?.sdr_id ?? null;

      if (responsibleUserId) {
        const tokenData = await getValidAccessToken(responsibleUserId, this.supabase);

        if (tokenData) {
          // Montar datetime ISO a partir de preferred_date + preferred_time
          const time = preferred_time || '09:00';
          const startIso = `${preferred_date}T${time}:00`;
          // Duração padrão: 1 hora
          const [h, m] = time.split(':').map(Number);
          const endHour = String(h + 1).padStart(2, '0');
          const endIso = `${preferred_date}T${endHour}:${String(m).padStart(2, '0')}:00`;
          const timezone = 'America/Sao_Paulo';

          const googleEvent: Record<string, unknown> = {
            summary: `Reunião com ${lead?.name || 'Lead'}`,
            start: { dateTime: startIso, timeZone: timezone },
            end: { dateTime: endIso, timeZone: timezone },
            attendees: lead?.email ? [{ email: lead.email }] : [],
            conferenceData: {
              createRequest: {
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
            extendedProperties: {
              private: { lead_id, system: 'v8milennialsb2b' },
            },
          };

          const googleRes = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokenData.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(googleEvent),
            }
          );

          if (googleRes.ok) {
            const createdEvent = await googleRes.json();
            meetLink =
              createdEvent.conferenceData?.entryPoints?.find(
                (ep: Record<string, string>) => ep.entryPointType === 'video'
              )?.uri ??
              createdEvent.hangoutLink ??
              null;

            // Salvar meet_link no pipe_confirmacao
            if (pipeId && meetLink) {
              await this.supabase
                .from('pipe_confirmacao')
                .update({ meet_link: meetLink })
                .eq('id', pipeId);
            }

            // Auditoria
            await logCalendarOp(this.supabase, {
              userId: responsibleUserId,
              operation: 'create_event',
              status: 'success',
              googleEventId: createdEvent.id,
              localReferenceId: lead_id,
              localReferenceType: 'lead',
              requestPayload: { preferred_date, preferred_time, lead_id },
              responsePayload: { id: createdEvent.id, meet_link: meetLink },
              initiatedBy: 'ai_agent',
            });

            console.log('[AgentEngine] Google Calendar event created:', createdEvent.id, 'meet_link:', meetLink);
          } else {
            const errText = await googleRes.text();
            console.warn('[AgentEngine] Google Calendar event creation failed:', errText);
            await logCalendarOp(this.supabase, {
              userId: responsibleUserId,
              operation: 'create_event',
              status: 'failed',
              localReferenceId: lead_id,
              localReferenceType: 'lead',
              errorMessage: errText,
              requestPayload: { preferred_date, preferred_time, lead_id },
              initiatedBy: 'ai_agent',
            });
          }
        }
      }
    } catch (calendarErr) {
      // Não bloqueia o agendamento — apenas loga
      console.warn('[AgentEngine] Google Calendar bridge error (non-fatal):', calendarErr);
    }

    const result: Record<string, unknown> = {
      success: true,
      message: meetLink
        ? `Reunião agendada e evento criado no Google Calendar`
        : 'Reunião agendada',
      meeting_date: preferred_date,
    };
    if (meetLink) result.meet_link = meetLink;

    return result;
  }

  private async executeCreateLead(params: any, tenantId: string) {
    const { name, email, phone, company } = params;
    if (!name || !tenantId) {
      return { success: false, error: 'name e tenant_id são obrigatórios' };
    }

    const { data: lead, error } = await this.supabase
      .from('leads')
      .insert({ name, email, phone, company, origin: 'web', organization_id: tenantId })
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, message: 'Lead criado', lead_id: lead.id };
  }

  private async executeUpdateCrm(_params: any, _tenantId: string) {
    return { success: true, message: 'UPDATE_CRM - integração externa (placeholder interno)' };
  }

  private async executeUpdateLead(params: any, tenantId: string) {
    const { lead_id, updates } = params;
    if (!lead_id || !updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return { success: false, error: 'lead_id e updates são obrigatórios' };
    }

    const UPDATE_LEAD_STANDARD_FIELDS = ['company', 'segment', 'urgency', 'faturamento', 'rating'];

    const { data: lead } = await this.supabase.from('leads').select('id, notes').eq('id', lead_id).eq('organization_id', tenantId).maybeSingle();
    if (!lead) return { success: false, error: 'Lead não encontrado' };

    const { data: customFields } = await this.supabase.from('lead_custom_fields').select('id, field_name').eq('organization_id', tenantId);
    const customFieldMap = new Map((customFields || []).map((f: { id: string; field_name: string }) => [f.field_name, f.id]));

    const leadUpdates: Record<string, unknown> = {};
    const customFieldUpdates: { field_id: string; value: string }[] = [];
    const notesToAppend: string[] = [];
    const now = new Date();
    const datePrefix = `[IA - ${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}]`;

    for (const [key, rawValue] of Object.entries(updates)) {
      if (rawValue == null) continue;
      const strVal = String(rawValue).trim();
      if (strVal === '') continue;
      const sanitized = sanitizeString(strVal, 2000) ?? '';

      if (UPDATE_LEAD_STANDARD_FIELDS.includes(key)) {
        if (key === 'rating') {
          const num = parseInt(sanitized, 10);
          if (!isNaN(num) && num >= 0 && num <= 10) leadUpdates[key] = num;
        } else {
          leadUpdates[key] = sanitized;
        }
      } else if (customFieldMap.has(key)) {
        customFieldUpdates.push({ field_id: customFieldMap.get(key)!, value: sanitized });
      } else {
        notesToAppend.push(`${datePrefix} ${key}: ${sanitized}`);
      }
    }

    if (Object.keys(leadUpdates).length > 0) {
      await this.supabase.from('leads').update(leadUpdates).eq('id', lead_id).eq('organization_id', tenantId);
    }
    if (notesToAppend.length > 0) {
      const newNotes = notesToAppend.join('\n');
      const updatedNotes = lead.notes ? `${lead.notes}\n\n${newNotes}` : newNotes;
      await this.supabase.from('leads').update({ notes: sanitizeString(updatedNotes, 5000) ?? updatedNotes }).eq('id', lead_id).eq('organization_id', tenantId);
    }
    for (const cf of customFieldUpdates) {
      await this.supabase.from('lead_custom_field_values').upsert(
        { lead_id, field_id: cf.field_id, value: cf.value, updated_at: new Date().toISOString() },
        { onConflict: 'lead_id,field_id' }
      );
    }

    return { success: true, message: 'Lead atualizado', lead_id };
  }

  private async executeCreateCustomField(params: any, tenantId: string) {
    const { field_name, field_type, field_options, initial_value } = params;

    if (!field_name || !field_type) {
      return { success: false, error: 'field_name e field_type sao obrigatorios' };
    }

    const validTypes = ['text', 'number', 'date', 'select', 'boolean'];
    if (!validTypes.includes(field_type)) {
      return { success: false, error: `field_type invalido. Use: ${validTypes.join(', ')}` };
    }

    if (field_type === 'select' && (!field_options || !Array.isArray(field_options) || field_options.length === 0)) {
      return { success: false, error: 'field_options obrigatorio para tipo select' };
    }

    // Verificar se campo ja existe na org
    const { data: existing } = await this.supabase
      .from('lead_custom_fields')
      .select('id')
      .eq('organization_id', tenantId)
      .eq('field_name', field_name)
      .maybeSingle();

    let fieldId: string;

    if (existing) {
      // Campo ja existe, usar o ID existente
      fieldId = existing.id;
      console.log(`[AgentEngine] Custom field "${field_name}" ja existe (id: ${fieldId}), reutilizando`);
    } else {
      // Criar novo campo
      const { data: maxOrder } = await this.supabase
        .from('lead_custom_fields')
        .select('display_order')
        .eq('organization_id', tenantId)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextOrder = (maxOrder?.display_order ?? 0) + 1;

      const { data: newField, error: createError } = await this.supabase
        .from('lead_custom_fields')
        .insert({
          organization_id: tenantId,
          field_name,
          field_type,
          field_options: field_type === 'select' ? field_options : null,
          is_required: false,
          display_order: nextOrder,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[AgentEngine] Erro ao criar campo personalizado:', createError);
        return { success: false, error: `Erro ao criar campo: ${createError.message}` };
      }

      fieldId = newField.id;
      console.log(`[AgentEngine] Novo campo personalizado criado: "${field_name}" (id: ${fieldId}, type: ${field_type})`);
    }

    // Se tem initial_value e tem lead atual, preencher o valor
    if (initial_value && this.currentLeadId) {
      await this.supabase
        .from('lead_custom_field_values')
        .upsert(
          {
            lead_id: this.currentLeadId,
            field_id: fieldId,
            value: String(initial_value).trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'lead_id,field_id' }
        );
      console.log(`[AgentEngine] Campo "${field_name}" preenchido com "${initial_value}" para lead ${this.currentLeadId}`);
    }

    return {
      success: true,
      message: existing
        ? `Campo "${field_name}" ja existia e foi reutilizado${initial_value ? ` (valor preenchido: ${initial_value})` : ''}`
        : `Campo "${field_name}" criado com sucesso${initial_value ? ` (valor preenchido: ${initial_value})` : ''}`,
      field_id: fieldId,
      field_name,
    };
  }

  private async executeTransferHuman(params: any, _tenantId: string) {
    const { lead_id } = params;
    if (!lead_id) return { success: false, error: 'lead_id é obrigatório' };

    await this.supabase.from('leads').update({
      ai_disabled: true,
      ai_disabled_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const { data: conversation } = await this.supabase.from('conversations').select('id').eq('lead_id', lead_id).maybeSingle();
    if (conversation) {
      await this.supabase.from('conversations').update({ state: 'WAITING_HUMAN' }).eq('id', conversation.id);
    }

    return { success: true, message: 'Conversa transferida para humano' };
  }

  private async executeAdvanceStage(params: any, tenantId: string) {
    const { lead_id, target_stage } = params;
    if (!lead_id || !target_stage) {
      return { success: false, error: 'lead_id e target_stage são obrigatórios' };
    }

    const { data: stages } = await this.supabase
      .from('pipeline_stages')
      .select('stage_key')
      .eq('organization_id', tenantId)
      .eq('pipeline_type', 'whatsapp')
      .eq('is_active', true);

    const validKeys = (stages || []).map((s: { stage_key: string }) => s.stage_key);
    const stageKeys = validKeys.length > 0 ? validKeys : ['novo', 'abordado', 'respondeu', 'esfriou', 'agendado'];

    const normalizedStage = String(target_stage).trim().toLowerCase();
    if (!stageKeys.some((k: string) => k.toLowerCase() === normalizedStage)) {
      return { success: false, error: `Etapa inválida. Use um de: ${stageKeys.join(', ')}` };
    }

    const finalStage = stageKeys.find((k: string) => k.toLowerCase() === normalizedStage) || normalizedStage;

    await this.supabase.from('leads').update({ pipe_whatsapp: finalStage }).eq('id', lead_id);
    await this.upsertPipeWhatsapp(lead_id, tenantId, finalStage);

    return { success: true, message: `Lead movido para ${finalStage}`, target_stage: finalStage };
  }

  /**
   * Confirma presença do lead na reunião
   * Atualiza is_confirmed no pipe_confirmacao e opcionalmente move para próxima etapa
   */
  private async executeConfirmMeeting(params: any, tenantId: string) {
    const lead_id = params.lead_id || this.currentLeadId;
    const confirmationType = params.confirmation_type || 'pre_confirmed';

    if (!lead_id) {
      return { success: false, error: 'lead_id é obrigatório' };
    }

    const { data: existing } = await this.supabase
      .from('pipe_confirmacao')
      .select('id, status')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (!existing) {
      return { success: false, error: 'Lead não encontrado no pipe de confirmação' };
    }

    // Marcar como confirmado
    await this.supabase
      .from('pipe_confirmacao')
      .update({ is_confirmed: true })
      .eq('id', existing.id);

    // Se for confirmação no dia, mover para etapa adequada
    if (confirmationType === 'confirmed') {
      await this.supabase
        .from('pipe_confirmacao')
        .update({ status: 'confirmacao_no_dia' })
        .eq('id', existing.id);

      console.log('[AgentEngine] Reunião confirmada no dia para lead:', lead_id);
      return { success: true, message: 'Reunião confirmada no dia', confirmation_type: 'confirmed' };
    }

    console.log('[AgentEngine] Reunião pré-confirmada para lead:', lead_id);
    return { success: true, message: 'Reunião pré-confirmada', confirmation_type: 'pre_confirmed' };
  }

  /**
   * Move o lead entre etapas do pipe de confirmação
   */
  private async executeAdvanceConfirmationStage(params: any, tenantId: string) {
    const lead_id = params.lead_id || this.currentLeadId;
    const targetStage = params.target_stage;

    if (!lead_id || !targetStage) {
      return { success: false, error: 'lead_id e target_stage são obrigatórios' };
    }

    // Buscar etapas válidas dinamicamente do DB (suporta etapas customizadas)
    const { data: stages } = await this.supabase
      .from('pipeline_stages')
      .select('stage_key')
      .eq('organization_id', tenantId)
      .eq('pipeline_type', 'confirmacao')
      .eq('is_active', true);

    const validKeys = (stages || []).map((s: { stage_key: string }) => s.stage_key);
    const stageKeys = validKeys.length > 0 ? validKeys : [
      'reuniao_marcada', 'confirmar_d5', 'confirmar_d3', 'confirmar_d1',
      'confirmacao_no_dia', 'remarcar', 'compareceu', 'perdido',
    ];

    const normalizedStage = String(targetStage).trim().toLowerCase();
    if (!stageKeys.some((k: string) => k.toLowerCase() === normalizedStage)) {
      return { success: false, error: `Etapa inválida. Use um de: ${stageKeys.join(', ')}` };
    }

    const finalStage = stageKeys.find((k: string) => k.toLowerCase() === normalizedStage) || normalizedStage;

    const { data: existing } = await this.supabase
      .from('pipe_confirmacao')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (!existing) {
      return { success: false, error: 'Lead não encontrado no pipe de confirmação' };
    }

    await this.supabase
      .from('pipe_confirmacao')
      .update({ status: finalStage })
      .eq('id', existing.id);

    console.log('[AgentEngine] Lead movido para', finalStage, 'no pipe confirmação');
    return { success: true, message: `Lead movido para ${finalStage} no pipe de confirmação`, target_stage: finalStage };
  }

  /**
   * Update Conversation State
   */
  private async updateConversationState(conversationId: string, newState: string, message: string) {
    try {
      // Se for conversa temporária, apenas log
      if (conversationId.startsWith('temp_')) {
        console.log('[AgentEngine] Temporary conversation, skipping state update');
        return;
      }

      // Buscar conversation atual para incrementar turn_count
      const { data: currentConv, error: fetchError } = await this.supabase
        .from('conversations')
        .select('turn_count')
        .eq('id', conversationId)
        .single();

      if (fetchError) {
        console.warn('[AgentEngine] Error fetching conversation for update:', fetchError.message);
        return;
      }

      const { error: updateError } = await this.supabase
        .from('conversations')
        .update({
          state: newState,
          turn_count: (currentConv?.turn_count || 0) + 1,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (updateError) {
        console.warn('[AgentEngine] Error updating conversation state:', updateError.message);
      }

      // Salvar mensagem do assistente
      await this.addMessageToMemory(conversationId, 'assistant', message);
    } catch (e) {
      console.warn('[AgentEngine] Failed to update conversation state:', e);
    }
  }

  /**
   * Add message to memory
   */
  private async addMessageToMemory(conversationId: string, role: string, content: string) {
    try {
      // Se for conversa temporária, apenas log
      if (conversationId.startsWith('temp_')) {
        console.log('[AgentEngine] Temporary conversation, skipping memory save');
        return;
      }

      const { error } = await this.supabase
        .from('conversation_messages')
        .insert({
          conversation_id: conversationId,
          role,
          content,
        });

      if (error) {
        console.warn('[AgentEngine] Error adding message to memory:', error.message);
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to add message to memory:', e);
    }
  }

  /**
   * Log Decision
   */
  private async logDecision(conversationId: string, stateBefore: string, stateAfter: string, action: any, capabilities: any) {
    try {
      // Se for conversa temporária, apenas log no console
      if (conversationId.startsWith('temp_')) {
        console.log('[AgentEngine] Decision (temp):', { stateBefore, stateAfter, action: action?.action });
        return;
      }

      const { error } = await this.supabase
        .from('agent_decision_logs')
        .insert({
          conversation_id: conversationId,
          organization_id: this.organizationId,
          state_before: stateBefore,
          state_after: stateAfter,
          action_decided: action?.action || 'RESPOND_ONLY',
          reasoning: `Based on capabilities: ${JSON.stringify(capabilities)}`,
          capabilities_snapshot: capabilities,
        });

      if (error) {
        console.warn('[AgentEngine] Error logging decision:', error.message);
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to log decision:', e);
    }
  }

  // ── Item #3: Geração de follow-up com AgentEngine ────────────────────────

  /**
   * Gera mensagem de follow-up personalizada usando IA + contexto da conversa.
   * Não altera estado da conversa — apenas gera o texto. O caller salva/envia.
   */
  async generateFollowupMessage(
    leadId: string,
    options: {
      followupCount?: number;
      ruleTemplate?: string;
      followupStyle?: string;
    } = {}
  ): Promise<string> {
    this.currentLeadId = leadId;

    const capabilities = await this.loadCapabilities(leadId);
    if (!capabilities) throw new Error('No active agent found for generateFollowupMessage');

    const leadData = await this.loadLeadData(leadId);
    this.conversationContext = await this.loadConversationContext(leadId);
    const documentSummaries = await this.loadDocumentSummaries(capabilities.id);

    // Buscar últimas mensagens da conversa para contexto (máx 8)
    let lastMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const conv = await this.loadConversation(leadId, capabilities.id);
    if (conv && !conv.id.startsWith('temp_')) {
      const { data: msgs } = await this.supabase
        .from('conversation_messages')
        .select('role, content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(8);
      lastMessages = (msgs || []).reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    // Prompt base do agente + instrução específica de follow-up
    const fakeConv = conv || { id: 'temp_followup', state: 'WAITING_FOLLOWUP', turn_count: 0, context: {}, short_term_memory: [], long_term_memory: {} };
    const basePrompt = this.buildDynamicPrompt(capabilities, fakeConv, leadData, documentSummaries);

    const ctx = this.conversationContext;
    const followupInstruction = [
      '',
      '## INSTRUÇÃO ESPECIAL — FOLLOW-UP AUTOMÁTICO',
      '',
      `Esta é a mensagem de follow-up #${(options.followupCount || 0) + 1}.`,
      'O lead não respondeu desde o último contato.',
      ctx?.lastTopic ? `Último assunto abordado: ${ctx.lastTopic}` : '',
      ctx?.leadTemperature ? `Temperatura do lead: ${ctx.leadTemperature}` : '',
      options.followupStyle ? `Estilo solicitado: ${options.followupStyle}` : '',
      '',
      'GERE APENAS a mensagem de follow-up: natural, breve (2-3 frases), personalizada.',
      'Não repita textualmente mensagens anteriores. Não inclua explicações, apenas a mensagem.',
    ].filter(Boolean).join('\n');

    const systemPrompt = basePrompt + '\n' + followupInstruction;
    const model = capabilities.llm_model || Deno.env.get('OPENROUTER_DEFAULT_MODEL') || 'google/gemini-3-flash-preview';

    const messages = [
      ...lastMessages,
      { role: 'user' as const, content: '[SISTEMA] Gere a mensagem de follow-up agora.' },
    ];

    const openRouterMessages = this.openRouter.convertMessages(messages, systemPrompt);

    const response = await this.openRouter.chat({
      model,
      messages: openRouterMessages,
      max_tokens: 300,
      temperature: 0.85,
    });

    const content = response?.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      return options.ruleTemplate || 'Oi! Ficamos sem conversar. Posso te ajudar com algo?';
    }

    return content.trim();
  }

  // ── Item #9: Detecção de opt-out pré-LLM ─────────────────────────────────

  /**
   * Verifica se a mensagem é um pedido de opt-out (STOP / PARA / etc.)
   * Retorna mensagem de confirmação em PT-BR ou null se não for opt-out.
   */
  private detectOptOut(message: string): string | null {
    const normalized = message.toLowerCase().trim();

    // Verificar frases compostas primeiro (ex: "não quero mais", "me remova")
    for (const keyword of this.OPT_OUT_KEYWORDS) {
      if (!keyword.includes(' ')) continue;
      if (normalized.includes(keyword)) {
        return 'Entendido! Você foi removido da nossa lista de contatos e não receberá mais mensagens nossas. Caso mude de ideia, é só nos chamar novamente. Obrigado!';
      }
    }

    // Verificar palavras únicas (correspondência exata ou início/fim da frase)
    for (const keyword of this.OPT_OUT_KEYWORDS) {
      if (keyword.includes(' ')) continue;
      if (
        normalized === keyword ||
        normalized.startsWith(keyword + ' ') ||
        normalized.endsWith(' ' + keyword) ||
        normalized.includes(' ' + keyword + ' ')
      ) {
        return 'Entendido! Você foi removido da nossa lista de contatos e não receberá mais mensagens nossas. Caso mude de ideia, é só nos chamar novamente. Obrigado!';
      }
    }

    return null;
  }

  // ── Item #17: Análise de sentimento heurística ────────────────────────────

  /**
   * Detecta sentimento heurístico da mensagem do lead.
   * Retorna: 'positive' | 'neutral' | 'negative'
   */
  private detectSentiment(message: string): 'positive' | 'neutral' | 'negative' {
    const t = message.toLowerCase();

    const positiveHints = [
      'ótimo', 'excelente', 'perfeito', 'adorei', 'gostei', 'incrível', 'top', 'show',
      'interessante', 'maravilhoso', 'fantástico', 'amei', 'quero saber mais', 'sim',
      'com certeza', 'claro', 'bora', 'vamos', 'quero', 'preciso', 'urgente', 'faz sentido',
      'legal', 'bacana', 'ajuda muito', 'muito bom', 'isso mesmo', 'faz sentido', 'ótima ideia',
    ];

    const negativeHints = [
      'não', 'nunca', 'caro', 'impossível', 'problema', 'ruim', 'péssimo', 'chateado',
      'frustrado', 'errado', 'falha', 'bug', 'quebrado', 'não funciona', 'ridículo',
      'absurdo', 'decepcionado', 'não vejo valor', 'sem interesse', 'deixa pra lá',
      'não quero', 'não preciso', 'sem necessidade', 'não faz sentido', 'perd', 'não gostei',
    ];

    const posScore = positiveHints.filter(h => t.includes(h)).length;
    const negScore = negativeHints.filter(h => t.includes(h)).length;

    if (posScore > negScore && posScore > 0) return 'positive';
    if (negScore > posScore && negScore > 0) return 'negative';
    return 'neutral';
  }

  // ── Item #13: Classificação de intenção pré-LLM ───────────────────────────

  /**
   * Classificador heurístico de intenção do lead (não requer chamada LLM).
   * Categorias: faq | objection | scheduling | qualification | chitchat
   */
  private classifyIntent(message: string): string {
    const t = message.toLowerCase();

    const schedulingHints = ['agendar', 'reunião', 'chamada', 'videochamada', 'conversar', 'horário', 'disponível', 'quando posso', 'marcar', 'call', 'demo', 'demonstração', 'apresentação'];
    const objectionHints  = ['caro', 'caro demais', 'sem dinheiro', 'sem verba', 'pensar', 'semana que vem', 'não preciso', 'não vejo', 'concorrente', 'já tenho', 'não é prioridade', 'budget', 'orçamento limitado'];
    const faqHints        = ['como', 'o que é', 'oque é', 'quanto custa', 'qual é', 'quais são', 'explica', 'me conta', 'funciona', 'diferença', 'vantagem', 'benefício', 'como funciona'];
    const qualHints       = ['sou', 'somos', 'nossa empresa', 'trabalho', 'funcionários', 'faturamento', 'segmento', 'área', 'responsável', 'meu negócio', 'tenho uma empresa'];

    if (schedulingHints.some(k => t.includes(k))) return 'scheduling';
    if (objectionHints.some(k => t.includes(k)))  return 'objection';
    if (faqHints.some(k => t.includes(k)))         return 'faq';
    if (qualHints.some(k => t.includes(k)))        return 'qualification';

    return 'chitchat';
  }

  // ── Item #2: Auto-update do context summary após cada turno ──────────────

  /**
   * Atualiza conversation_context_summary de forma incremental após cada turno.
   * Chamado de forma assíncrona (fire-and-forget) para não bloquear a resposta.
   */
  private async updateContextSummaryAfterTurn(
    leadId: string,
    state: string,
    userMessage: string,
    assistantMessage: string,
    turnCount: number
  ): Promise<void> {
    const intent    = this.classifyIntent(userMessage);
    const sentiment = this.detectSentiment(userMessage);  // item #17

    // Temperatura baseada no estado da conversa
    let leadTemperature: 'cold' | 'warm' | 'hot' = 'cold';
    const hotStates  = ['QUALIFIED', 'SCHEDULED', 'MEETING_SCHEDULED', 'CLOSED_WON'];
    const warmStates = ['QUALIFYING', 'INTERESTED', 'NEGOTIATING', 'WAITING_FOLLOWUP'];
    if (hotStates.includes(state))  leadTemperature = 'hot';
    else if (warmStates.includes(state)) leadTemperature = 'warm';

    // Engagement score: cresce com o número de turnos (cap em 100)
    const engagementScore = Math.min(100, turnCount * 5);

    // Próxima ação sugerida com base no estado
    const nextActionMap: Record<string, string> = {
      NEW_LEAD:       'Iniciar qualificação',
      QUALIFYING:     'Continuar qualificação',
      QUALIFIED:      'Agendar reunião',
      SCHEDULED:      'Confirmar reunião',
      WAITING_HUMAN:  'Transferir para atendente',
      DISQUALIFIED:   'Arquivar lead',
      OPT_OUT:        'Sem ação (opt-out)',
    };
    const nextAction = nextActionMap[state] || 'Aguardar resposta do lead';

    try {
      await this.supabase
        .from('conversation_context_summary')
        .upsert({
          lead_id:          leadId,
          organization_id:  this.organizationId,
          last_intent:      intent,
          sentiment:        sentiment,   // item #17
          lead_temperature: leadTemperature,
          engagement_score: engagementScore,
          message_count:    turnCount,
          last_message_at:  new Date().toISOString(),
          next_action:      nextAction,
          updated_at:       new Date().toISOString(),
        }, {
          onConflict: 'lead_id',
        });

      console.log('[AgentEngine] Context summary updated:', { leadId, intent, sentiment, leadTemperature, turnCount });
    } catch (e) {
      console.warn('[AgentEngine] updateContextSummaryAfterTurn failed:', e);
    }
  }

  // ── Item #15: Verificação de horário de atendimento ──────────────────────

  /**
   * Verifica se o momento atual está dentro do horário de atendimento configurado.
   * Retorna mensagem de fora de horário (string) ou null (dentro do horário).
   */
  private checkOutOfHours(capabilities: any): string | null {
    try {
      const avail = capabilities.availability as {
        mode?: string;
        timezone?: string;
        days?: string[];
        start?: string;
        end?: string;
        out_of_hours_message?: string;
      } | null;

      // Se modo for "always" ou não configurado, sem restrição de horário
      if (!avail || avail.mode !== 'scheduled') return null;

      const tz = avail.timezone || 'America/Sao_Paulo';
      const now = new Date();

      // Dia da semana em PT-BR (seg, ter, qua, qui, sex, sab, dom)
      const dayKey = new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        weekday: 'short',
      }).format(now).toLowerCase().replace('.', '').substring(0, 3);

      const allowedDays = avail.days || ['seg', 'ter', 'qua', 'qui', 'sex'];
      if (!allowedDays.includes(dayKey)) {
        return avail.out_of_hours_message ||
          'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 😊';
      }

      // Verificar horário (HH:MM)
      const timeStr = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);

      const [nowHour, nowMin] = timeStr.split(':').map(Number);
      const nowMinutes = nowHour * 60 + nowMin;

      const parseTime = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + (m || 0);
      };

      const startMin = parseTime(avail.start || '09:00');
      const endMin   = parseTime(avail.end   || '18:00');

      if (nowMinutes < startMin || nowMinutes >= endMin) {
        return avail.out_of_hours_message ||
          'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 😊';
      }

      return null; // dentro do horário
    } catch (e) {
      console.warn('[AgentEngine] checkOutOfHours error (non-fatal):', e);
      return null; // em caso de erro, não bloquear
    }
  }
}
