import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenRouterClient } from "./openrouter-client.ts";

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

    // 1. Load Capabilities
    console.log('[AgentEngine] Step 1: Loading capabilities...');
    const capabilities = await this.loadCapabilities();

    if (!capabilities) {
      console.error('[AgentEngine] No active agent found for organization:', this.organizationId);
      throw new Error('No active agent found for organization');
    }
    console.log('[AgentEngine] Capabilities loaded:', { agentId: capabilities.id, agentName: capabilities.name });

    // 2. Load or Create Conversation
    console.log('[AgentEngine] Step 2: Loading/creating conversation...');
    let conversation = await this.loadConversation(leadId, capabilities.id);

    if (!conversation) {
      conversation = await this.createConversation(leadId, capabilities.id);
    }

    if (!conversation) {
      console.error('[AgentEngine] Failed to load or create conversation');
      throw new Error('Failed to create conversation');
    }

    // 2.5. Load Lead Data (including custom fields)
    console.log('[AgentEngine] Step 2.5: Loading lead data...');
    const leadData = await this.loadLeadData(leadId);

    // 2.6. Load Conversation Context (último assunto, intenção, etc)
    console.log('[AgentEngine] Step 2.6: Loading conversation context...');
    this.conversationContext = await this.loadConversationContext(leadId);

    // 3. Update Short-Term Memory
    console.log('[AgentEngine] Step 3: Adding message to memory...');
    await this.addMessageToMemory(conversation.id, 'user', userMessage);

    // 4. Build Dynamic Prompt
    console.log('[AgentEngine] Step 4: Building prompt...');
    const systemPrompt = this.buildDynamicPrompt(capabilities, conversation, leadData);

    // 5. Build Tools (based on capabilities)
    console.log('[AgentEngine] Step 5: Building tools...');
    const tools = this.buildDynamicTools(capabilities);

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
    
    // Obter modelo do banco ou usar padrão
    const model = capabilities.llm_model || Deno.env.get('OPENROUTER_DEFAULT_MODEL') || 'openai/gpt-4o-mini';
    console.log('[AgentEngine] Using model:', model);
    
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
      temperature: 0.7,
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

    // 8. Execute Action (via n8n se necessário)
    let executionResult = null;
    if (actionToExecute) {
      console.log('[AgentEngine] Step 9: Executing action:', actionToExecute.action);
      try {
        executionResult = await this.executeAction(actionToExecute);
      } catch (actionError) {
        // Não quebrar o fluxo se a action falhar - a resposta deve ser enviada de qualquer forma
        console.warn('[AgentEngine] Action execution failed (non-fatal):', actionError);
        executionResult = { error: String(actionError), status: 'failed' };
      }
    }

    // 9. Update Conversation State
    console.log('[AgentEngine] Step 10: Updating conversation state...');
    await this.updateConversationState(conversation.id, nextState, assistantMessage);

    // 10. Log Decision
    console.log('[AgentEngine] Step 11: Logging decision...');
    await this.logDecision(conversation.id, conversation.state, nextState, actionToExecute, capabilities);

    // 11. Update Lead Pipeline Stage (Funil WhatsApp)
    console.log('[AgentEngine] Step 12: Updating lead pipeline stage...');
    await this.updateLeadPipelineStage(leadId, conversation.turn_count, actionToExecute);

    // 12. Execute Automation Actions (if configured)
    console.log('[AgentEngine] Step 13: Checking automation actions...');
    await this.executeAutomationActions(leadId, nextState, capabilities, assistantMessage);

    console.log('[AgentEngine] Message processing complete');
    
    // 13. Return Response
    return {
      message: assistantMessage,
      state: nextState,
      action_executed: actionToExecute?.action,
      execution_result: executionResult,
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
      const qualifiedStates = ['QUALIFIED', 'MEETING_SCHEDULED', 'CLOSED_WON'];
      const disqualifiedStates = ['DISQUALIFIED', 'NOT_INTERESTED', 'NO_FIT', 'CLOSED_LOST'];
      const needHumanStates = ['NEED_HUMAN', 'ESCALATED', 'COMPLEX_ISSUE'];

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

      // Executar ações configuradas
      const updates: Record<string, any> = {};

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
      if (actionConfig.notifyUserId) {
        // TODO: Implementar sistema de notificações
        console.log('[AgentEngine] Should notify user:', actionConfig.notifyUserId);
      }

      console.log('[AgentEngine] Automation actions executed for:', actionType);

    } catch (error) {
      console.error('[AgentEngine] Error executing automation actions:', error);
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

      // Se agendou reunião, vai direto para 'agendado'
      if (actionToExecute?.action === 'SCHEDULE_MEETING') {
        newStage = 'agendado';
      }
      // Se é o primeiro turno (agente respondendo pela primeira vez)
      else if (turnCount <= 1 && currentStage === 'novo') {
        newStage = 'abordado';
      }
      // Se já foi abordado e lead respondeu novamente
      else if (currentStage === 'abordado') {
        newStage = 'respondeu';
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
        }
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to update lead pipeline stage:', e);
    }
  }

  /**
   * Load Capabilities do banco
   */
  private async loadCapabilities() {
    const { data } = await this.supabase
      .from('copilot_agents')
      .select('*, copilot_agent_faqs(*), copilot_agent_kanban_rules(*)')
      .eq('organization_id', this.organizationId)
      .eq('is_active', true)
      .eq('is_default', true)
      .maybeSingle();

    return data;
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
      
      // Buscar telefone do lead
      const { data: lead } = await this.supabase
        .from('leads')
        .select('phone')
        .eq('id', leadId)
        .single();

      if (!lead?.phone) {
        return this.getDefaultContext();
      }

      // Buscar últimas mensagens
      const { data: messages, error: msgError } = await this.supabase
        .from('whatsapp_messages')
        .select('direction, content, created_at')
        .eq('organization_id', this.organizationId)
        .ilike('phone_number', `%${lead.phone.slice(-8)}%`)
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
  private buildDynamicPrompt(capabilities: any, conversation: any, leadData?: any): string {
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

      sections.push("# OBJETIVO PRINCIPAL");
      sections.push("");
      sections.push(capabilities.main_objective || 'Qualificar leads e agendar reuniões');
      sections.push("");

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
    // 4. CONTEXTO DA CONVERSA
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
    // 5. INSTRUÇÕES FINAIS
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
  private buildDynamicTools(capabilities: any) {
    const tools: any[] = [];

    if (capabilities.can_schedule_meeting) {
      tools.push({
        name: 'schedule_meeting',
        description: 'Agenda uma reunião para o lead',
        input_schema: {
          type: 'object',
          properties: {
            preferred_date: { type: 'string', description: 'Data preferida (YYYY-MM-DD)' },
            preferred_time: { type: 'string', description: 'Horário preferido (HH:MM)' },
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
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      .limit(50); // Últimas 50 mensagens

      if (error) {
        console.warn('[AgentEngine] Error getting conversation history, falling back to whatsapp_messages:', error.message);
        return await this.getWhatsAppMessageHistory();
      }

      if (!messages || messages.length === 0) {
        console.log('[AgentEngine] No conversation_messages found, using whatsapp_messages');
        return await this.getWhatsAppMessageHistory();
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
      'transfer_to_human': 'TRANSFER_HUMAN',
    };
    return mapping[toolName] || 'UNKNOWN';
  }

  /**
   * Determine next state based on action
   */
  private determineNextState(currentState: string, toolName: string): string {
    if (toolName === 'schedule_meeting') return 'SCHEDULED';
    if (toolName === 'transfer_to_human') return 'WAITING_HUMAN';
    if (currentState === 'NEW_LEAD') return 'QUALIFYING';
    return currentState;
  }

  /**
   * Execute Action via n8n (ou webhook-orchestrator)
   * Se não tiver webhook configurado, apenas loga a ação e retorna
   */
  private async executeAction(action: any) {
    const n8nWebhookUrl = Deno.env.get("N8N_INTERNAL_EXECUTOR_WEBHOOK");
    
    // Se não tiver n8n configurado, apenas logar a ação (não quebrar)
    if (!n8nWebhookUrl) {
      console.log('[AgentEngine] No N8N_INTERNAL_EXECUTOR_WEBHOOK configured, skipping action execution');
      console.log('[AgentEngine] Action would be:', action);
      return { 
        status: 'skipped', 
        reason: 'No webhook configured',
        action: action.action,
        params: action.params 
      };
    }

    try {
      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': Deno.env.get("WEBHOOK_API_KEY") || '',
        },
        body: JSON.stringify({
          action: action.action,
          data: action.params,
          tenant_id: action.tenant_id,
          api_key: Deno.env.get("WEBHOOK_API_KEY"),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AgentEngine] Action execution failed:', response.status, errorText);
        return { status: 'failed', error: errorText, statusCode: response.status };
      }

      return await response.json();
    } catch (fetchError) {
      console.error('[AgentEngine] Action fetch error:', fetchError);
      return { status: 'error', error: String(fetchError) };
    }
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
}
