import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenRouterClient } from "./openrouter-client.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";
import { enqueueAiAction } from "../_shared/ai-queue.ts";
import { immediateTransferHuman } from "../_shared/ai-action-executor.ts";
import { sanitizeAssistantMessage, splitByDelimiter } from "../_shared/message-sanitizer.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  loadCapabilities as loadCapabilitiesExternal,
  loadOrgCustomFields as loadOrgCustomFieldsExternal,
  loadPipelineStages as loadPipelineStagesExternal,
  loadDocumentSummaries as loadDocumentSummariesExternal,
  loadConversation as loadConversationExternal,
  loadLeadData as loadLeadDataExternal,
  loadProductCatalog as loadProductCatalogExternal,
  loadConversationContextSummary as loadConversationContextSummaryExternal,
  getDefaultContext as getDefaultContextExternal,
  type ConversationContextSummary as ConversationContextSummaryExternal,
} from "../_shared/copilot/context-loader.ts";
import {
  retrieveSemanticContext as retrieveSemanticContextExternal,
  retrieveLongTermMemories as retrieveLongTermMemoriesExternal,
} from "../_shared/copilot/rag.ts";
import {
  determineNextState as determineNextStateExternal,
  updateConversationState as updateConversationStateExternal,
} from "../_shared/copilot/state-machine.ts";
import {
  buildIdempotencyKey as buildIdempotencyKeyExternal,
  mapToolToAction as mapToolToActionExternal,
  logDecision as logDecisionExternal,
  addMessageToMemory as addMessageToMemoryExternal,
} from "../_shared/copilot/dispatcher.ts";
import { executeSearchKnowledge as executeSearchKnowledgeExternal } from "../_shared/copilot/search-knowledge.ts";
import { resolveActiveWindow } from "../_shared/copilot/time-context.ts";
import {
  parseCustomInstructions,
  extractTopicFromMessage,
  detectIntentFromMessage,
  calculateLeadTemperature,
  calculateEngagementScore,
  detectSentiment,
  classifyIntent,
  checkOutOfHours,
} from "./engine/utils.ts";

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
  private incomingMessageType: string = "text";

  // ── Compressão de histórico ───────────────────────────────────────────
  private readonly HISTORY_COMPRESS_THRESHOLD = 25;
  private readonly HISTORY_KEEP_RECENT = 15;

  // Opt-out detection removed — the LLM decides via prompt when a lead
  // explicitly wants to unsubscribe. Hard-coded keyword matching caused
  // false positives (e.g., "para" preposition matched as opt-out).

  constructor(supabase: SupabaseClient, openRouter: OpenRouterClient, organizationId: string) {
    this.supabase = supabase;
    this.openRouter = openRouter;
    this.organizationId = organizationId;
  }

  /**
   * Processa mensagem do lead e retorna resposta
   */
  async processMessage(leadId: string, userMessage: string, incomingMessageType?: string) {
    console.log('[AgentEngine] Processing message:', { leadId, messagePreview: userMessage.substring(0, 50) });
    this.currentLeadId = leadId;
    this.incomingMessageType = incomingMessageType || "text";

    // 1. Load Capabilities (item #4: roteamento por etapa do lead)
    console.log('[AgentEngine] Step 1: Loading capabilities...');
    const capabilities = await this.loadCapabilities(leadId);

    if (!capabilities) {
      console.error('[AgentEngine] No active agent found for organization:', this.organizationId);
      throw new Error('No active agent found for organization');
    }
    console.log('[AgentEngine] Capabilities loaded:', { agentId: capabilities.id, agentName: capabilities.name });

    // 1.5. OUT-OF-HOURS CHECK — item #15 (síncrono, instant)
    const outOfHoursReply = checkOutOfHours(capabilities);
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
      productCatalog,
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
      this.loadProductCatalog(),
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
    const systemPrompt = await this.buildDynamicPrompt(capabilities, conversation, leadData, documentSummaries, semanticContext, longTermMemories, productCatalog);

    // Onda 1 / T1.3.3: log tamanho do prompt para detectar truncagem silenciosa
    // (LLM pode receber prompt cortado se exceder context window — sem alarme).
    const promptChars = systemPrompt.length;
    const estimatedTokens = Math.ceil(promptChars / 4);
    const timeCtxAudit = resolveActiveWindow({
      behavior_windows: capabilities.behavior_windows,
      availability: capabilities.availability as { timezone?: string } | null,
    });
    logRuntime({
      organizationId: this.organizationId,
      module: 'copilot',
      action: 'prompt_built',
      status: 'success',
      entityType: 'lead',
      entityId: leadId,
      payloadSnapshot: {
        agent_id: capabilities.id,
        prompt_chars: promptChars,
        estimated_tokens: estimatedTokens,
        turn_count: conversation.turn_count,
        time_context: timeCtxAudit
          ? {
              window_id: timeCtxAudit.window.id,
              window_name: timeCtxAudit.window.name,
              has_behavior: timeCtxAudit.hasBehavior,
              enforcement: (capabilities.behavior_enforcement as string) || 'hard',
            }
          : { fallback: 'legacy_availability', enforcement: (capabilities.behavior_enforcement as string) || 'hard' },
      },
    }).catch(() => {/* non-fatal */});

    // 5. Build Tools (based on capabilities)
    console.log('[AgentEngine] Step 5: Building tools...');
    const tools = await this.buildDynamicTools(capabilities, orgCustomFields, pipelineStages);

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
    
    // 7. Call LLM com suporte a multi-turn para tools inline (search_knowledge)
    const openRouterTools = tools.length > 0 ? this.openRouter.convertTools(tools) : undefined;
    const multiTurnMessages: Array<{ role: string; content: string | null; tool_calls?: any; tool_call_id?: string }> = [...allMessages];
    let finalNextState = conversation.state;
    let finalAction: { action: string; params: Record<string, unknown>; tenant_id: string } | null = null;
    let finalAssistantMessage = '';
    const MAX_TOOL_TURNS = 3;

    // Telemetria por invocação — salva em runtime_logs
    const telemetry = {
      turns_used: 0,
      tools_called: [] as string[],
      finish_reasons: [] as string[],
      content_null_turns: 0,
      forced_text_turn_used: false,
      forced_text_succeeded: false,
      fallback_used: false,
      truncated: false,
    };

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      console.log(`[AgentEngine] LLM call #${turn + 1}...`);
      telemetry.turns_used = turn + 1;
      const orMessages = this.openRouter.convertMessages(multiTurnMessages, systemPrompt);

      // Onda 2 / T2.C.1: timing + tokens
      const llmStart = Date.now();
      const response = await this.openRouter.chat({
        model,
        messages: orMessages,
        tools: openRouterTools,
        tool_choice: openRouterTools ? 'auto' : undefined,
        max_tokens: 1024,
        temperature,
      });
      const llmDurationMs = Date.now() - llmStart;
      const usage = (response as any)?.usage;
      logRuntime({
        organizationId: this.organizationId,
        module: 'copilot',
        action: 'llm_call',
        status: 'success',
        entityType: 'lead',
        entityId: leadId,
        durationMs: llmDurationMs,
        tokens: {
          prompt: usage?.prompt_tokens,
          completion: usage?.completion_tokens,
          model,
        },
        payloadSnapshot: { agent_id: capabilities.id, turn: turn + 1 },
      }).catch(() => {/* non-fatal */});

      const choice = response.choices?.[0];
      const finishReason = choice?.finish_reason ?? 'unknown';
      telemetry.finish_reasons.push(finishReason);
      if (!choice?.message?.content) telemetry.content_null_turns += 1;
      if (finishReason === 'length') telemetry.truncated = true;

      const { nextState: ns, actionToExecute: action, assistantMessage: msg, extraToolCalls } = await this.processLLMResponse(
        response, conversation, capabilities
      );
      if (action?.action) telemetry.tools_called.push(action.action);
      // Multi-tool responses: log + metric. Today only the first is executed;
      // the others are dropped. This warn surfaces the case in runtime_logs.
      // Escalar para enqueue paralelo é follow-up documentado no design.md.
      if (extraToolCalls && extraToolCalls.length > 0) {
        console.warn(
          '[AgentEngine] LLM returned',
          extraToolCalls.length + 1,
          'tool_calls; executing only first. Extras:',
          extraToolCalls.map((c) => c.action).join(','),
        );
        for (const extra of extraToolCalls) {
          telemetry.tools_called.push(`DROPPED:${extra.action}`);
        }
      }

      // Se o LLM chamou search_knowledge: executar INLINE e fazer outra chamada
      if (action?.action === 'SEARCH_KNOWLEDGE' && action.params?.query) {
        const query = action.params.query as string;
        console.log(`[AgentEngine] search_knowledge("${query}") — executing inline...`);

        const searchResult = await this.executeSearchKnowledge(query, capabilities.id);
        console.log(`[AgentEngine] search_knowledge returned ${searchResult.length} chars`);

        // Adicionar tool call + resultado ao historico para proxima chamada
        // Contrato OpenAI: assistant com tool_calls deve ter content: null, NÃO "".
        const toolCallId = response.choices?.[0]?.message?.tool_calls?.[0]?.id || `kb_${Date.now()}`;
        multiTurnMessages.push({
          role: 'assistant',
          content: msg && msg.length > 0 ? msg : null,
          tool_calls: response.choices?.[0]?.message?.tool_calls,
        });
        multiTurnMessages.push({
          role: 'tool',
          content: searchResult,
          tool_call_id: toolCallId,
        });
        continue; // Proxima iteracao do loop — chama o LLM de novo com os resultados
      }

      // Nao e tool inline — esta e a resposta final
      finalNextState = ns;
      finalAction = action;
      finalAssistantMessage = msg;
      break;
    }

    // FORCED-TEXT TURN — Se o loop terminou sem texto (LLM chamou tool não-inline
    // com content:null, ou sair do loop no último turn via continue), fazer uma
    // chamada final SEM tools forçando resposta textual. Elimina o fallback
    // silencioso "Desculpe, houve um problema ao processar sua mensagem." que
    // era enviado a clientes quando o modelo retornava apenas tool_calls sem texto.
    if (!finalAssistantMessage || finalAssistantMessage.trim().length === 0) {
      console.log('[AgentEngine] Empty final message — running forced-text turn');
      telemetry.forced_text_turn_used = true;
      try {
        const forcedMessages = this.openRouter.convertMessages(multiTurnMessages, systemPrompt);
        const forcedResp = await this.openRouter.chat({
          model,
          messages: forcedMessages,
          tool_choice: 'none',
          max_tokens: 1024,
          temperature,
        });
        const forcedChoice = forcedResp.choices?.[0];
        telemetry.finish_reasons.push(forcedChoice?.finish_reason ?? 'unknown_forced');
        const forcedText = forcedChoice?.message?.content?.trim() ?? '';
        if (forcedText.length > 0) {
          finalAssistantMessage = forcedText;
          telemetry.forced_text_succeeded = true;
          console.log('[AgentEngine] Forced-text turn produced', forcedText.length, 'chars');
        } else {
          console.warn('[AgentEngine] Forced-text turn also empty — will fallback');
        }
      } catch (forceErr) {
        console.error('[AgentEngine] Forced-text turn failed:', forceErr);
      }
    }

    const nextState = finalNextState;
    let actionToExecute = finalAction;

    // Último recurso: fallback genérico — sinalizado via telemetry.fallback_used
    // e logado com severity=error. Callers podem suprimir envio observando fallback_used.
    let rawAssistantMessage: string;
    if (finalAssistantMessage && finalAssistantMessage.trim().length > 0) {
      rawAssistantMessage = finalAssistantMessage;
    } else {
      rawAssistantMessage = 'Desculpe, houve um problema ao processar sua mensagem.';
      telemetry.fallback_used = true;
      console.error('[AgentEngine] FALLBACK USED — no text after forced-text turn', telemetry);
    }

    // 8a.0 Sanitizar JSON de ReAct leak + recuperar ação textual se tool nativo não foi usado.
    // Evita vazamento de blocos {"action":"...","action_input":"..."} para o lead (incidente 2026-04-24).
    const sanitized = sanitizeAssistantMessage(rawAssistantMessage, !!actionToExecute);
    if (sanitized.recoveredAction && !actionToExecute) {
      console.warn('[AgentEngine] Recovered inline action from LLM text (tool_call missed):', sanitized.recoveredAction.action);
      actionToExecute = {
        action: sanitized.recoveredAction.action,
        params: sanitized.recoveredAction.params,
        tenant_id: this.organizationId,
      };
    }
    if (sanitized.droppedBlocks > 0) {
      console.warn('[AgentEngine] Stripped', sanitized.droppedBlocks, 'JSON action block(s) from LLM output');
    }
    const assistantMessage = sanitized.text;
    // RC.4: chain-of-thought capturado de <thinking>...</thinking> (se reasoning_mode != 'off')
    const capturedReasoning = sanitized.reasoning ?? null;
    if (capturedReasoning && !conversation.id.startsWith('temp_')) {
      logRuntime({
        organizationId: this.organizationId,
        module: 'copilot',
        action: 'reasoning',
        status: 'success',
        entityType: 'conversation',
        entityId: conversation.id,
        triggeredBy: capabilities.id,
        reasoning: capturedReasoning,
      }).catch((e) => console.warn('[AgentEngine] reasoning log failed (non-fatal):', e));
    }
    console.log('[AgentEngine] Response processed:', {
      nextState,
      hasAction: !!actionToExecute,
      messageLength: assistantMessage?.length,
      telemetry,
    });

    // 8a. Split message on ||SPLIT|| delimiter (WhatsApp natural messaging)
    // Case-insensitive + tolera variações (||split||, || SPLIT ||, etc)
    const messageParts = splitByDelimiter(assistantMessage);
    // Versão limpa sem delimitadores (usada para memória e logs)
    const cleanMessage = messageParts.join(' ');

    // 8. Enqueue Action (via pending_ai_actions → worker assíncrono)
    let executionResult: Record<string, unknown> | null = null;
    if (actionToExecute) {
      // Injetar lead_id para ações que precisam
      const needsLeadId = ['SCHEDULE_MEETING', 'TRANSFER_HUMAN', 'UPDATE_LEAD', 'QUALIFY_LEAD', 'DISQUALIFY_LEAD', 'ADVANCE_STAGE', 'UPDATE_QUALIFICATION_SCORE', 'CONFIRM_MEETING', 'ADVANCE_CONFIRMATION_STAGE', 'CREATE_CUSTOM_FIELD', 'TRANSFER_SZ_CHAT', 'SEND_DOCUMENT'];
      let currentAction = actionToExecute;
      if (this.currentLeadId && needsLeadId.includes(currentAction.action)) {
        currentAction = {
          ...currentAction,
          params: { ...currentAction.params, lead_id: this.currentLeadId },
        };
      }
      console.log('[AgentEngine] Step 9: Enqueuing action:', currentAction.action);
      try {
        // TRANSFER_HUMAN: execute immediately, enqueue only side-effects
        if (currentAction.action === 'TRANSFER_HUMAN') {
          const transferResult = await immediateTransferHuman(this.supabase, this.currentLeadId!);
          if (!transferResult.success) {
            console.warn('[AgentEngine] Immediate transfer failed, will rely on queue:', transferResult.error);
          }
          // Enqueue notification + lead_history only (no db state change)
          const minuteTs = Math.floor(Date.now() / 60_000);
          await enqueueAiAction(this.supabase, {
            organizationId: this.organizationId,
            leadId: this.currentLeadId || undefined,
            conversationId: conversation.id.startsWith('temp_') ? undefined : conversation.id,
            actionType: 'transfer_to_human_notify',
            payload: { ...currentAction.params, lead_id: this.currentLeadId },
            idempotencyKey: `transfer_human_notify_${this.currentLeadId}_${minuteTs}`,
          });
          executionResult = { success: true, queued: true, immediate: true };
        } else if (currentAction.action === 'TRANSFER_SZ_CHAT') {
          // TRANSFER_SZ_CHAT: disable AI immediately, enqueue SZ.chat transfer
          const transferResult = await immediateTransferHuman(this.supabase, this.currentLeadId!);
          if (!transferResult.success) {
            console.warn('[AgentEngine] Immediate SZ.chat transfer (ai_disabled) failed:', transferResult.error);
          }
          // Enqueue the actual SZ.chat transfer (calls sz-chat-send edge function)
          const minuteTs = Math.floor(Date.now() / 60_000);
          await enqueueAiAction(this.supabase, {
            organizationId: this.organizationId,
            leadId: this.currentLeadId || undefined,
            conversationId: conversation.id.startsWith('temp_') ? undefined : conversation.id,
            actionType: 'transfer_sz_chat',
            payload: { ...currentAction.params, lead_id: this.currentLeadId },
            idempotencyKey: `transfer_sz_chat_${this.currentLeadId}_${minuteTs}`,
          });
          executionResult = { success: true, queued: true, immediate: true };
        } else {
          executionResult = await this.enqueueToolAction(currentAction, conversation.id, conversation.turn_count);
        }
      } catch (enqueueError) {
        console.warn('[AgentEngine] Action enqueue failed (non-fatal):', enqueueError);
        executionResult = { error: String(enqueueError), status: 'failed' };
      }
    }

    // 9. Update Conversation State (salva mensagem limpa, sem delimitadores)
    console.log('[AgentEngine] Step 10: Updating conversation state...');
    await this.updateConversationState(conversation.id, nextState, cleanMessage);

    // 10. Log Decision
    console.log('[AgentEngine] Step 11: Logging decision...');
    await this.logDecision(conversation.id, conversation.state, nextState, actionToExecute, capabilities, {
      reasoningChain: capturedReasoning ?? undefined,
    });

    // 11. Enqueue Pipeline Stage Update (Funil WhatsApp)
    console.log('[AgentEngine] Step 12: Enqueuing pipeline stage update...');
    await this.enqueuePipelineStageUpdate(leadId, conversation.turn_count, actionToExecute);

    // 12. Enqueue Automation Actions (if configured)
    console.log('[AgentEngine] Step 13: Enqueuing automation actions...');
    await this.enqueueAutomationActions(leadId, nextState, capabilities);

    console.log('[AgentEngine] Message processing complete', { parts: messageParts.length });

    // 13. Auto-update conversation_context_summary (item #2) — assíncrono, não bloqueia resposta
    this.updateContextSummaryAfterTurn(leadId, nextState, userMessage, cleanMessage, conversation.turn_count + 1)
      .catch(e => console.warn('[AgentEngine] Context summary update failed (non-fatal):', e));

    // 13.5. Item #19: Extrair e salvar memórias de longo prazo (fire-and-forget)
    this.extractAndSaveMemories(leadId, capabilities.id, conversation.id, conversation.turn_count + 1, userMessage, cleanMessage)
      .catch(e => console.warn('[AgentEngine] Long-term memory extraction failed (non-fatal):', e));

    // 14. Return Response
    // Se a acao foi SEND_DOCUMENT, incluir media_attachments na resposta
    let mediaAttachments: Array<{ type: string; document_id?: string; material_id?: string; caption?: string }> | undefined;
    if (actionToExecute?.action === 'SEND_DOCUMENT' && actionToExecute.params) {
      mediaAttachments = [{
        type: 'document',
        document_id: actionToExecute.params.document_id as string,
        caption: (actionToExecute.params.caption as string) || undefined,
      }];
    } else if (actionToExecute?.action === 'SEND_PRODUCT_MATERIAL' && actionToExecute.params) {
      const materialId = actionToExecute.params.material_id as string;
      // Validate material exists and belongs to org before sending
      const { data: validMaterial } = await this.supabase
        .from('product_materials')
        .select('id')
        .eq('id', materialId)
        .eq('organization_id', this.organizationId)
        .eq('is_active', true)
        .maybeSingle();

      if (validMaterial) {
        mediaAttachments = [{
          type: 'product_material',
          material_id: materialId,
          caption: (actionToExecute.params.caption as string) || undefined,
        }];
      } else {
        console.warn('[AgentEngine] Invalid material_id from LLM:', materialId);
      }
    }

    return {
      message: cleanMessage,
      messages: messageParts.length > 1 ? messageParts : undefined,
      media_attachments: mediaAttachments,
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
   * Enfileira ações automáticas baseadas no estado da conversa.
   * A execução real acontece no worker process-ai-actions.
   */
  private async enqueueAutomationActions(
    leadId: string,
    currentState: string,
    capabilities: any,
  ) {
    try {
      const automationActions = capabilities.automation_actions;
      if (!automationActions) {
        console.log('[AgentEngine] No automation actions configured');
        return;
      }

      let actionConfig = null;
      let actionType: string | null = null;

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

      if (!actionConfig || !actionType) {
        console.log('[AgentEngine] No automation action matches current state:', currentState);
        return;
      }

      const automationActionType = `automation_${actionType}` as string;
      const idempotencyKey = `auto_${actionType}_${leadId}_${currentState}`;

      console.log('[AgentEngine] Enqueuing automation action:', automationActionType);
      await enqueueAiAction(this.supabase, {
        organizationId: this.organizationId,
        leadId,
        actionType: automationActionType,
        payload: {
          action_type: actionType,
          action_config: actionConfig,
          current_state: currentState,
        },
        idempotencyKey,
      });

    } catch (error) {
      console.error('[AgentEngine] Error enqueuing automation actions:', error);
    }
  }

  /**
   * Enfileira atualização de estágio do pipeline WhatsApp.
   * Calcula a transição (novo→abordado, abordado→respondeu, etc.)
   * e enfileira para o worker executar.
   */
  private async enqueuePipelineStageUpdate(
    leadId: string,
    turnCount: number,
    actionToExecute: any
  ) {
    try {
      // advance_stage será enfileirado como tool call — não duplicar
      if (actionToExecute?.action === 'ADVANCE_STAGE') {
        return;
      }

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

      const standardWhatsappStages = ['novo', 'abordado', 'respondeu', 'esfriou', 'agendado'];
      const isStandardStage = standardWhatsappStages.includes(currentStage || '');

      if (actionToExecute?.action === 'SCHEDULE_MEETING') {
        newStage = 'agendado';
      } else if (isStandardStage) {
        if (turnCount <= 1 && currentStage === 'novo') {
          newStage = 'abordado';
        } else if (currentStage === 'abordado') {
          newStage = 'respondeu';
        }
      }

      if (newStage && newStage !== currentStage) {
        console.log('[AgentEngine] Enqueuing pipeline stage update:', { leadId, from: currentStage, to: newStage });
        await enqueueAiAction(this.supabase, {
          organizationId: this.organizationId,
          leadId,
          actionType: 'update_pipeline_stage',
          payload: { lead_id: leadId, new_stage: newStage, previous_stage: currentStage },
          idempotencyKey: `pipeline_${leadId}_${newStage}`,
        });
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to enqueue pipeline stage update:', e);
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
  /**
   * Trilha 3.B T3B.2: delegado pra _shared/copilot/context-loader.ts
   * com cache LRU integrado (TTL 5min, MAX 200 entries por org+lead).
   */
  private async loadCapabilities(leadId?: string) {
    return loadCapabilitiesExternal(this.supabase, this.organizationId, leadId);
  }

  /**
   * Load Knowledge Base — carrega conteudo COMPLETO dos documentos
   * Prioriza content (texto integral), fallback para summary se content nao disponivel.
   */
  /** T3B.8: delegado pra context-loader.ts */
  private async loadDocumentSummaries(agentId: string): Promise<Array<{file_name: string; summary: string}>> {
    return loadDocumentSummariesExternal(this.supabase, agentId);
  }

  /**
   * Load product catalog for the org (all active products + materials).
   * Injected into prompt so the agent knows what products exist.
   */
  /** T3B.8c: delegado pra context-loader.ts */
  private async loadProductCatalog(): Promise<string> {
    return loadProductCatalogExternal(this.supabase, this.organizationId);
  }

  /**
   * Executa busca na base de conhecimento inline (search_knowledge tool).
   * Retorna trechos relevantes + lista de arquivos disponiveis para envio.
   */
  /** T3B.7: delegado pra _shared/copilot/search-knowledge.ts */
  private async executeSearchKnowledge(query: string, agentId: string): Promise<string> {
    return executeSearchKnowledgeExternal(this.supabase, query, agentId);
  }

  /**
   * Item #5 + #6: Recupera contexto semântico relevante para a mensagem do usuário
   * via pgvector — busca chunks de documentos E FAQs semanticamente próximos.
   * Retorna string formatada para injeção no prompt, ou "" se não houver resultados.
   */
  /** T3B.8d: delegado pra rag.ts */
  private async retrieveSemanticContext(userMessage: string, agentId: string): Promise<string> {
    return retrieveSemanticContextExternal(this.supabase, userMessage, agentId);
  }

  /**
   * Item #19: Recupera memórias de longo prazo relevantes para a mensagem atual
   * via pgvector. Retorna string formatada ou "" se não houver memórias.
   */
  /** T3B.8d: delegado pra rag.ts */
  private async retrieveLongTermMemories(userMessage: string, leadId: string): Promise<string> {
    return retrieveLongTermMemoriesExternal(this.supabase, userMessage, leadId);
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

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) return;

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
      const embeddings = await generateEmbeddingsBatch(contents, geminiKey);

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
  /** T3B.8: delegado pra context-loader.ts */
  private async loadConversation(leadId: string, agentId: string) {
    return loadConversationExternal(this.supabase, leadId, agentId, this.organizationId);
  }

  /**
   * Load Lead Data including custom fields
   */
  /** T3B.8a: delegado pra context-loader.ts */
  private async loadLeadData(leadId: string) {
    return loadLeadDataExternal(this.supabase, leadId);
  }

  /**
   * Load custom fields da organização (para descrição da tool update_lead)
   */
  /** T3B.8: delegado pra context-loader.ts */
  private async loadOrgCustomFields(): Promise<{ field_name: string }[]> {
    return loadOrgCustomFieldsExternal(this.supabase, this.organizationId);
  }

  /** T3B.8: delegado pra context-loader.ts */
  private async loadPipelineStages(): Promise<{ stage_key: string; name: string; pipeline_type: string }[]> {
    return loadPipelineStagesExternal(this.supabase, this.organizationId);
  }

  /**
   * Load Conversation Context Summary
   * Busca o contexto resumido da última conversa para personalizar follow-ups
   */
  /** T3B.8b: delegado pra context-loader.ts. Cache primeiro; fallback extrai mensagens (interno). */
  private async loadConversationContext(leadId: string): Promise<ConversationContextSummary | null> {
    const cached = await loadConversationContextSummaryExternal(this.supabase, leadId);
    if (cached) return cached;

    // Fallback: extrai contexto das últimas 20 mensagens
    try {
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
        return getDefaultContextExternal();
      }

      const context = await this.extractContextFromMessages(messages);
      await this.saveConversationContext(leadId, context);
      return context;
    } catch (e) {
      console.warn('[AgentEngine] loadConversationContext fallback failed:', e);
      return getDefaultContextExternal();
    }
  }

  /** T3B.8b: delegado pra context-loader.ts */
  private getDefaultContext(): ConversationContextSummary {
    return getDefaultContextExternal();
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
      context.lastTopic = extractTopicFromMessage(lastLeadMessage.content);
      context.lastIntent = detectIntentFromMessage(lastLeadMessage.content);
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
    context.leadTemperature = calculateLeadTemperature(leadMessages);
    context.engagementScore = calculateEngagementScore(sortedMessages);

    // Extrair pontos-chave (mensagens mais longas do lead)
    context.keyPoints = leadMessages
      .filter(m => m.content && m.content.length > 50)
      .map(m => m.content.substring(0, 150))
      .slice(-3);

    return context;
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
  private async buildDynamicPrompt(capabilities: any, conversation: any, leadData?: any, documentSummaries?: Array<{file_name: string; summary: string}>, semanticContext?: string, longTermMemories?: string, productCatalog?: string): Promise<string> {
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
        sections.push("- advance_stage: quando o lead progrediu na jornada — especifique target_stage e target_pipe (whatsapp, confirmacao, propostas, upsell_base, upsell_gestao, campanha)");
        sections.push("O lead pode estar em MÚLTIPLOS funis simultaneamente (WhatsApp + Carteira + Confirmação etc). Movimente no funil correto.");
        sections.push("Essencial: movimente o lead conforme a conversa evolui. Não deixe leads qualificados ou desqualificados sem usar a ferramenta.");
        sections.push("");
      }

      // Time-Aware Behavior — janela ativa + comportamento contextual.
      // Fallback legacy: se behavior_windows vazio, mantém bloco DISPONIBILIDADE clássico.
      const timeContext = resolveActiveWindow(
        { behavior_windows: capabilities.behavior_windows, availability: availability as { timezone?: string } },
      );
      if (timeContext) {
        sections.push("# CONTEXTO TEMPORAL");
        sections.push("");
        sections.push("IMPORTANTE: Adapte sua resposta ao momento atual e ao comportamento configurado para esta janela.");
        sections.push("");
        sections.push(timeContext.formatted);
        if (responseDelaySeconds && responseDelaySeconds > 0) {
          sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
        }
        sections.push("");
      } else if (availability.mode) {
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
    // 1.5 KNOWLEDGE BASE — instrucao leve, conteudo via search_knowledge tool
    // =====================================================
    if (documentSummaries && documentSummaries.length > 0) {
      const docNames = documentSummaries.map(d => d.file_name?.trim()).filter(Boolean);
      sections.push("");
      sections.push("# BASE DE CONHECIMENTO");
      sections.push("");
      sections.push(`Voce tem acesso a uma base de conhecimento com ${documentSummaries.length} documento(s)${docNames.length > 0 ? ': ' + docNames.join(', ') : ''}.`);
      sections.push("");
      sections.push("REGRA CRITICA — CONSULTA OBRIGATORIA:");
      sections.push("- Antes de responder QUALQUER pergunta sobre produtos, precos, servicos, especificacoes, politicas, catalogo ou informacoes comerciais, voce DEVE chamar a ferramenta search_knowledge.");
      sections.push("- NAO responda de memoria. NAO improvise. SEMPRE consulte a base primeiro.");
      sections.push("- Use os dados retornados pela busca para formular sua resposta com precisao.");
      sections.push("- Se a busca nao retornar informacoes relevantes, diga honestamente: 'Vou verificar essa informacao e te retorno em breve.'");
      sections.push("- Se o lead pedir um documento, catalogo ou arquivo, use a ferramenta send_document.");
      sections.push("- Fale naturalmente — nunca mencione 'base de conhecimento', 'documento' ou 'ferramenta de busca'.");
      sections.push("");
    }

    // =====================================================
    // 1.52 CATÁLOGO DE PRODUTOS — dados estruturados dos produtos da empresa
    // =====================================================
    if (productCatalog && productCatalog.trim().length > 0) {
      sections.push("");
      sections.push("# CATÁLOGO DE PRODUTOS");
      sections.push("");
      sections.push("Abaixo estão os produtos da empresa com detalhes reais. Use ESTES dados para responder sobre produtos, preços e condições:");
      sections.push("");
      sections.push(productCatalog);
      sections.push("");
      sections.push("REGRAS SOBRE PRODUTOS:");
      sections.push("- Use EXATAMENTE os valores de ticket e condições listados acima. Não invente preços.");
      sections.push("- Se o lead perguntar sobre um produto que não está na lista, diga que vai verificar.");
      sections.push("- Se um produto tem materiais disponíveis (PDF, imagem, catálogo), ofereça enviar quando fizer sentido comercial.");
      sections.push("- Para enviar material de produto, use a ferramenta send_product_material com o ID do material.");
      sections.push("- Não envie materiais sem contexto. Acompanhe com mensagem explicativa.");
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

    // 1.6 SEMANTIC CONTEXT — agora handled pelo search_knowledge tool (multi-turn)
    // Nao injetar mais no prompt — o agente consulta ativamente via tool

    // =====================================================
    // 1.5. CONTEXTO DE INTERVENÇÃO HUMANA RECENTE
    // =====================================================
    try {
      const { data: recentTransfer } = await this.supabase
        .from("lead_history")
        .select("metadata, created_at")
        .eq("lead_id", this.currentLeadId)
        .eq("action", "ai_toggled")
        .not("metadata", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentTransfer) {
        const transferTime = new Date(recentTransfer.created_at);
        const minutesAgo = Math.round((Date.now() - transferTime.getTime()) / 60_000);
        const metadata = recentTransfer.metadata as Record<string, unknown>;
        const reason = metadata?.reason as string;

        // Only inject context if transfer was within last 24h and has a reason (copilot-initiated)
        if (minutesAgo < 1440 && reason) {
          sections.push("");
          sections.push("# CONTEXTO IMPORTANTE");
          sections.push(`Esta conversa foi transferida para um vendedor humano há ${minutesAgo} minutos.`);
          sections.push(`Motivo original da transferência: ${reason}`);
          sections.push("O vendedor interveio e devolveu a conversa para você.");
          sections.push("Continue naturalmente, sem repetir perguntas já feitas.");
          sections.push("");
        }
      }
    } catch (e) {
      console.warn("[AgentEngine] Failed to check recent handoff (non-fatal):", e);
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
      if (leadData.pipe_whatsapp) sections.push(`- Etapa no funil WhatsApp: ${leadData.pipe_whatsapp}`);
      if (leadData.confirmacao_status) {
        let confirmacaoInfo = `- Etapa no funil Confirmação: ${leadData.confirmacao_status}`;
        if (leadData.confirmacao_meeting_date) confirmacaoInfo += ` (reunião: ${leadData.confirmacao_meeting_date})`;
        if (leadData.confirmacao_is_confirmed) confirmacaoInfo += ' [CONFIRMADO]';
        sections.push(confirmacaoInfo);
      }
      if (leadData.propostas_status) {
        let propostasInfo = `- Etapa no funil Propostas: ${leadData.propostas_status}`;
        if (leadData.propostas_sale_value) propostasInfo += ` (valor: R$${leadData.propostas_sale_value})`;
        if (leadData.propostas_product_type) propostasInfo += ` (produto: ${leadData.propostas_product_type})`;
        sections.push(propostasInfo);
      }
      if (leadData.upsell_base_stage) sections.push(`- Etapa na Carteira Base: ${leadData.upsell_base_stage}`);
      if (leadData.upsell_gestao_stage) sections.push(`- Etapa na Carteira Gestão: ${leadData.upsell_gestao_stage}`);
      if (leadData.upsell_potencial) sections.push(`- Potencial do cliente: ${leadData.upsell_potencial}`);
      if (leadData.upsell_is_active === false) sections.push(`- ⚠️ Cliente INATIVO na carteira (possível churn)`);
      if (leadData.campanha_stage) sections.push(`- Etapa na Campanha: ${leadData.campanha_stage}`);
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
    // Suporta todos os funis: whatsapp, confirmacao, propostas, upsell_base, upsell_gestao
    // =====================================================
    const kanbanRules = capabilities?.copilot_agent_kanban_rules;
    if (kanbanRules && Array.isArray(kanbanRules) && kanbanRules.length > 0) {
      // Montar mapa de pipe → stage atual do lead
      const pipeLabels: Record<string, string> = {
        whatsapp: "WhatsApp",
        confirmacao: "Confirmação",
        propostas: "Propostas",
        upsell_base: "Carteira Base",
        upsell_gestao: "Carteira Gestão",
        campanha: "Campanhas",
      };
      const currentStages: Array<{ pipe: string; stage: string }> = [];
      if (leadData?.pipe_whatsapp?.trim()) currentStages.push({ pipe: 'whatsapp', stage: leadData.pipe_whatsapp.trim() });
      if (leadData?.confirmacao_status?.trim()) currentStages.push({ pipe: 'confirmacao', stage: leadData.confirmacao_status.trim() });
      if (leadData?.propostas_status?.trim()) currentStages.push({ pipe: 'propostas', stage: leadData.propostas_status.trim() });
      if (leadData?.upsell_base_stage?.trim()) currentStages.push({ pipe: 'upsell_base', stage: leadData.upsell_base_stage.trim() });
      if (leadData?.upsell_gestao_stage?.trim()) currentStages.push({ pipe: 'upsell_gestao', stage: leadData.upsell_gestao_stage.trim() });
      if (leadData?.campanha_stage?.trim()) currentStages.push({ pipe: 'campanha', stage: leadData.campanha_stage.trim() });

      // Encontrar regras que matcham qualquer pipe/stage atual
      const matchedRules: Array<{ rule: any; pipe: string; stage: string }> = [];
      for (const cs of currentStages) {
        const rule = kanbanRules.find(
          (r: { pipe_type?: string; stage_name?: string }) =>
            r?.pipe_type === cs.pipe && r?.stage_name?.toLowerCase() === cs.stage.toLowerCase()
        );
        if (rule) matchedRules.push({ rule, pipe: cs.pipe, stage: cs.stage });
      }

      if (matchedRules.length > 0) {
        sections.push("# REGRAS DA ETAPA ATUAL (Kanban)");
        sections.push("");
        for (const { rule, pipe, stage } of matchedRules) {
          const pipeLabel = pipeLabels[pipe] || pipe;
          sections.push(`Você está conversando com um lead na etapa "${rule.stage_name}" do funil ${pipeLabel}.`);
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
        }
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

    // =====================================================
    // FORMATO DE SAÍDA — PROTEÇÃO CONTRA VAZAMENTO DE JSON/TOOL
    // =====================================================
    sections.push("");
    sections.push("# FORMATO DE SAÍDA (OBRIGATÓRIO)");
    sections.push("");
    sections.push('- NUNCA escreva blocos JSON ou código no seu conteúdo de resposta. NUNCA escreva {"action":...} ou {"action_input":...} no texto.');
    sections.push("- Para executar qualquer ação (agendar, enviar material, qualificar, transferir etc), use EXCLUSIVAMENTE o mecanismo nativo de tool/function call do modelo — nunca descreva a ação em texto.");
    sections.push("- Para enviar um material, use a tool `send_product_material` (com `material_id` UUID). NÃO existe tool `send_media` — não invente nomes.");
    sections.push('- Use o delimitador `||SPLIT||` em MAIÚSCULAS exatas para separar mensagens. Nunca use `||split||` ou variações.');
    sections.push("- Se não for separar, apenas escreva o texto direto, sem delimitador.");

    // =====================================================
    // AUDIO MODE INSTRUCTIONS (TTS)
    // =====================================================
    if (capabilities.tts_config) {
      const ttsConfig = capabilities.tts_config as { mode: string; max_chars: number };
      const shouldAddAudioInstructions =
        ttsConfig.mode === "always" ||
        (ttsConfig.mode === "mirror" && (this.incomingMessageType === "audio" || this.incomingMessageType === "ptt"));

      if (shouldAddAudioInstructions) {
        sections.push("");
        sections.push("# [MODO ÁUDIO ATIVO]");
        sections.push("Suas respostas serão convertidas em áudio (voice note). Por isso:");
        sections.push(`- Mantenha respostas curtas e diretas (máximo ${ttsConfig.max_chars} caracteres)`);
        sections.push("- Use linguagem falada, natural, como se estivesse gravando um áudio");
        sections.push("- Evite listas, bullet points, formatação markdown — nada disso aparece em áudio");
        sections.push("- Evite siglas ou abreviações que não soam bem quando faladas");
        sections.push("- Não use emojis");
      }
    }

    // =====================================================
    // REASONING CHAIN (chain-of-thought visível p/ debug)
    // =====================================================
    const reasoningMode = (capabilities.reasoning_mode ?? 'always') as 'always' | 'actions_only' | 'off';
    if (reasoningMode !== 'off') {
      const trigger = reasoningMode === 'always'
        ? 'SEMPRE'
        : 'QUANDO usar tools (schedule_meeting, qualify_lead, transfer_to_human, advance_stage, send_product_material, etc)';
      sections.push("");
      sections.push("# FORMATO DE RESPOSTA OBRIGATÓRIO");
      sections.push("");
      sections.push(`${trigger} responda EXATAMENTE neste formato:`);
      sections.push("");
      sections.push("<thinking>");
      sections.push("Pense passo-a-passo:");
      sections.push("1. O que o lead realmente quer?");
      sections.push("2. Qual contexto da conversa importa?");
      sections.push("3. Qual é a melhor ação? (responder texto OU usar tool)");
      sections.push("4. Se vou usar tool: pré-condições atendidas? (lead tem telefone? agenda livre? stage correto?)");
      sections.push("5. Riscos da ação?");
      sections.push("</thinking>");
      sections.push("<response>");
      sections.push("[mensagem que vai pro lead — texto puro, pode usar ||SPLIT||]");
      sections.push("</response>");
      sections.push("");
      sections.push("CRÍTICO: conteúdo de <thinking> NUNCA aparece pro lead. Apenas <response> é entregue.");
      sections.push("Se for usar tool, ainda assim feche o <thinking> antes de invocar a tool.");
    }

    return sections.join("\n");
  }

  /**
   * Build Dynamic Tools (baseado em capabilities)
   */
  private async buildDynamicTools(
    capabilities: any,
    orgCustomFields: { field_name: string }[] = [],
    pipelineStages: { stage_key: string; name: string; pipeline_type: string }[] = []
  ) {
    const tools: any[] = [];

    // search_knowledge — PRIMEIRO tool, alta prioridade
    // Disponivel quando o agente tem documentos na KB
    try {
      const { count } = await this.supabase
        .from('copilot_agent_documents')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', capabilities.id)
        .eq('status', 'ready');

      if (count && count > 0) {
        tools.push({
          name: 'search_knowledge',
          description: 'Consulta a base de conhecimento da empresa. Use OBRIGATORIAMENTE antes de responder sobre produtos, servicos, precos, especificacoes, politicas ou catalogo. Retorna informacoes precisas dos documentos da empresa.',
          input_schema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Termo de busca. Ex: "saude bucal", "preco omega", "politica troca"',
              },
            },
            required: ['query'],
          },
        });
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to check KB docs:', e);
    }

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
      // Agrupar etapas por pipeline para mostrar ao LLM
      const pipeLabelsForTool: Record<string, string> = {
        whatsapp: 'WhatsApp',
        confirmacao: 'Confirmação',
        propostas: 'Propostas',
        upsell_base: 'Carteira Base',
        upsell_gestao: 'Carteira Gestão',
        campanha: 'Campanhas',
      };
      let stageDescription = '';
      if (pipelineStages.length > 0) {
        const grouped: Record<string, string[]> = {};
        for (const s of pipelineStages) {
          const key = s.pipeline_type || 'whatsapp';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(s.stage_key);
        }
        const parts = Object.entries(grouped).map(([pipe, stages]) =>
          `${pipeLabelsForTool[pipe] || pipe}: ${stages.join(', ')}`
        );
        stageDescription = parts.join(' | ');
      } else {
        stageDescription = 'WhatsApp: novo, abordado, respondeu, esfriou, agendado';
      }
      tools.push({
        name: 'advance_stage',
        description: `Avança o lead para outra etapa do funil. Etapas disponíveis por funil: ${stageDescription}. Use quando o lead progredir na jornada.`,
        input_schema: {
          type: 'object',
          properties: {
            target_stage: { type: 'string', description: 'Etapa de destino' },
            target_pipe: { type: 'string', description: `Funil de destino (whatsapp, confirmacao, propostas, upsell_base, upsell_gestao, campanha). Padrão: whatsapp`, enum: ['whatsapp', 'confirmacao', 'propostas', 'upsell_base', 'upsell_gestao', 'campanha'] },
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

    // Tool: Enviar documento da base de conhecimento ao lead via WhatsApp
    try {
      const { data: agentDocs } = await this.supabase
        .from('copilot_agent_documents')
        .select('id, file_name, summary')
        .eq('agent_id', capabilities.id)
        .eq('status', 'ready');

      if (agentDocs && agentDocs.length > 0) {
        const docList = agentDocs
          .map((d: { id: string; file_name: string; summary: string | null }) =>
            `- "${d.file_name}" (id: ${d.id})${d.summary ? ` — ${d.summary.substring(0, 80)}...` : ''}`
          )
          .join('\n');

        tools.push({
          name: 'send_document',
          description: `Envia um documento/arquivo da base de conhecimento para o lead via WhatsApp. Use quando o lead pedir um catalogo, proposta, tabela de precos, ou qualquer documento disponivel.\n\nDocumentos disponiveis:\n${docList}`,
          input_schema: {
            type: 'object',
            properties: {
              document_id: {
                type: 'string',
                description: 'ID do documento a enviar (use os IDs listados acima)',
              },
              caption: {
                type: 'string',
                description: 'Mensagem curta que acompanha o arquivo (opcional, max 200 chars)',
              },
            },
            required: ['document_id'],
          },
        });
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to load documents for send_document tool:', e);
    }

    // Tool: send_product_material — send product-specific files (PDFs, images) to lead
    try {
      const { data: productMats } = await this.supabase
        .from('product_materials')
        .select('id, product_id, file_name, material_type, products!inner(name)')
        .eq('organization_id', this.organizationId)
        .eq('is_active', true);

      if (productMats && productMats.length > 0) {
        const matList = productMats.map((m: any) =>
          `- "${m.file_name}" (id: ${m.id}, produto: ${m.products?.name || 'N/A'}, tipo: ${m.material_type})`
        ).join('\n');

        tools.push({
          name: 'send_product_material',
          description: `Envia um material de produto (PDF comercial, catalogo, imagem, flyer) para o lead via WhatsApp. Use quando o lead demonstrar interesse em um produto e fizer sentido enviar material de apoio.\n\nMateriais disponiveis:\n${matList}`,
          input_schema: {
            type: 'object',
            properties: {
              material_id: {
                type: 'string',
                description: 'ID do material a enviar (use os IDs listados acima)',
              },
              caption: {
                type: 'string',
                description: 'Mensagem curta que acompanha o material (opcional, max 200 chars)',
              },
            },
            required: ['material_id'],
          },
        });
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to load product materials for send_product_material tool:', e);
    }

    // Tool para transferir atendimento para outro setor via SZ.chat
    let szChatConfig: { team_mappings: Record<string, unknown> } | null = null;
    try {
      const { data } = await this.supabase
        .from("sz_chat_config").select("team_mappings")
        .eq("organization_id", this.organizationId).eq("is_active", true).maybeSingle();
      szChatConfig = data;
    } catch (e) {
      console.warn('[AgentEngine] sz_chat_config query failed (non-fatal):', e);
    }

    if (szChatConfig?.team_mappings && Object.keys(szChatConfig.team_mappings).length > 0) {
      const teamNames = Object.keys(szChatConfig.team_mappings);
      tools.push({
        name: 'transfer_sz_chat',
        description: `Transferir o atendimento para outro setor da empresa. Setores disponíveis: ${teamNames.join(", ")}. Use quando o cliente solicitar algo fora do escopo comercial.`,
        input_schema: {
          type: 'object',
          properties: {
            target_team_name: {
              type: 'string',
              description: `Nome do setor para transferir. Opções: ${teamNames.join(", ")}`,
              enum: teamNames,
            },
            message_to_client: {
              type: 'string',
              description: 'Mensagem para o cliente informando sobre a transferência',
            },
          },
          required: ['target_team_name', 'message_to_client'],
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
   * Process LLM Response (OpenRouter/OpenAI format).
   *
   * Returns the FIRST actionable tool_call for inline handling (search_knowledge
   * is processed specially by the outer loop). Any additional tool_calls are
   * surfaced via `extraToolCalls` so the caller can enfileirá-las em paralelo
   * em vez de descartá-las silenciosamente (era um bug: CR-3).
   *
   * Logs `finish_reason` and presence of text content for diagnostics.
   */
  private async processLLMResponse(response: any, conversation: any, capabilities: any) {
    let assistantMessage = '';
    let actionToExecute: { action: string; params: Record<string, unknown>; tenant_id: string } | null = null;
    const extraToolCalls: Array<{ action: string; params: Record<string, unknown>; tenant_id: string }> = [];
    let nextState = conversation.state;

    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No response from LLM');
    }

    const message = choice.message;
    const finishReason = choice.finish_reason ?? 'unknown';

    console.log('[AgentEngine] LLM response:', {
      finish_reason: finishReason,
      has_content: !!message?.content,
      tool_calls_count: message?.tool_calls?.length ?? 0,
    });

    // Extrair resposta de texto
    if (message.content) {
      assistantMessage = message.content;
    }

    // Processar tool calls (múltiplos tratados corretamente).
    // Estratégia: coletar tudo que tem JSON válido. Primeiro válido vira
    // actionToExecute; os demais vão para extraToolCalls. Entradas com JSON
    // corrompido são silenciosamente puladas (com log error) — nunca são
    // enfileiradas com params vazios/meios-porcos, o que causaria side-effects
    // imprevisíveis (ex: advance_stage sem stage name).
    if (message.tool_calls && message.tool_calls.length > 0) {
      const parsed: Array<{ toolName: string; entry: typeof actionToExecute }> = [];
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        let toolParams: Record<string, unknown> | null = null;
        try {
          toolParams = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error('[AgentEngine] Error parsing tool arguments:', e, 'raw:', toolCall.function.arguments);
          continue;
        }
        parsed.push({
          toolName,
          entry: {
            action: this.mapToolToAction(toolName),
            params: toolParams ?? {},
            tenant_id: this.organizationId,
          },
        });
      }
      if (parsed.length > 0) {
        actionToExecute = parsed[0].entry;
        nextState = this.determineNextState(conversation.state, parsed[0].toolName);
        for (let i = 1; i < parsed.length; i++) {
          if (parsed[i].entry) extraToolCalls.push(parsed[i].entry!);
        }
      }
    }

    return { nextState, actionToExecute, assistantMessage, extraToolCalls, finishReason };
  }

  /**
   * Map tool name to n8n action
   */
  /** T3B.8: delegado pra _shared/copilot/dispatcher.ts (pure function) */
  private mapToolToAction(toolName: string): string {
    return mapToolToActionExternal(toolName);
  }

  /**
   * Determine next state based on action
   */
  /** T3B.5: delegado pra _shared/copilot/state-machine.ts (pure function) */
  private determineNextState(currentState: string, toolName: string): string {
    return determineNextStateExternal(currentState, toolName);
  }

  /**
   * Enfileira uma tool call para execução assíncrona via worker.
   * Mapeia o nome da action (UPPER_CASE) para action_type (snake_case)
   * e gera idempotency_key baseado nos parâmetros.
   */
  private async enqueueToolAction(action: any, conversationId: string, turnCount?: number) {
    const params = action.params || {};

    // Mapeamento de ação para action_type na fila
    const ACTION_MAP: Record<string, string> = {
      'SCHEDULE_MEETING': 'schedule_meeting',
      'CREATE_LEAD': 'create_lead',
      'UPDATE_CRM': 'update_crm',
      'UPDATE_LEAD': 'update_lead',
      'TRANSFER_HUMAN': 'transfer_to_human',
      'UPDATE_QUALIFICATION_SCORE': 'update_qualification_score',
      'ADVANCE_STAGE': 'advance_stage',
      'CONFIRM_MEETING': 'confirm_meeting',
      'ADVANCE_CONFIRMATION_STAGE': 'advance_confirmation_stage',
      'CREATE_CUSTOM_FIELD': 'create_custom_field',
      'TRANSFER_SZ_CHAT': 'transfer_sz_chat',
      'SEND_DOCUMENT': 'send_document',
      'SEND_PRODUCT_MATERIAL': 'send_product_material',
    };

    const actionType = ACTION_MAP[action.action];

    // SEARCH_KNOWLEDGE: handled inline via multi-turn, never enqueued
    if (action.action === 'SEARCH_KNOWLEDGE') {
      return { success: true, queued: false, message: 'Handled inline' };
    }

    // QUALIFY/DISQUALIFY: processados via state machine + enqueueAutomationActions
    if (action.action === 'QUALIFY_LEAD' || action.action === 'DISQUALIFY_LEAD') {
      console.log(`[AgentEngine] ${action.action} - será processada via state machine em enqueueAutomationActions`);
      return { success: true, queued: false, message: `${action.action} delegada para automação` };
    }

    // UPDATE_CRM: placeholder, não enfileira
    if (action.action === 'UPDATE_CRM') {
      return { success: true, message: 'UPDATE_CRM - integração externa (placeholder)' };
    }

    if (!actionType) {
      console.warn('[AgentEngine] Action não suportada para enqueue:', action.action);
      return { success: false, error: `Ação não suportada: ${action.action}` };
    }

    // Injetar current_lead_id para create_custom_field
    if (action.action === 'CREATE_CUSTOM_FIELD' && this.currentLeadId) {
      params.current_lead_id = this.currentLeadId;
    }

    // Gerar idempotency_key (Onda 1 / T1.3.2: turn-based quando disponível)
    const leadId = params.lead_id || this.currentLeadId;
    const idempotencyKey = this.buildIdempotencyKey(actionType, leadId, params, turnCount);

    const result = await enqueueAiAction(this.supabase, {
      organizationId: this.organizationId,
      leadId: leadId || undefined,
      conversationId: conversationId.startsWith('temp_') ? undefined : conversationId,
      actionType,
      payload: params,
      idempotencyKey,
    });

    console.log(`[AgentEngine] Action ${action.action} enqueued:`, result);
    return { success: true, queued: result.queued, action_id: result.id };
  }

  /**
   * Gera chave de idempotência baseada no tipo de ação e parâmetros.
   */
  /** T3B.6: delegado pra _shared/copilot/dispatcher.ts (pure function) */
  private buildIdempotencyKey(
    actionType: string,
    leadId: string | null,
    params: Record<string, unknown>,
    turnCount?: number,
  ): string {
    return buildIdempotencyKeyExternal(actionType, leadId, this.organizationId, params, turnCount);
  }

  // ── Tool execution methods removed — all writes now go through pending_ai_actions queue ──
  // See: _shared/ai-action-executor.ts for the actual execution logic
  // See: process-ai-actions/index.ts for the worker that processes the queue

  /**
   * Update Conversation State
   */
  /** T3B.8: delegado pra state-machine.ts (RPC atomic) + dispatcher.ts (assistant message) */
  private async updateConversationState(conversationId: string, newState: string, message: string) {
    await updateConversationStateExternal(this.supabase, conversationId, newState);
    await addMessageToMemoryExternal(this.supabase, conversationId, "assistant", message);
  }

  /** T3B.8: delegado pra dispatcher.ts (com idempotency_key turn-bucket 5min) */
  private async addMessageToMemory(conversationId: string, role: string, content: string) {
    await addMessageToMemoryExternal(this.supabase, conversationId, role, content);
  }

  /** T3B.8: delegado pra dispatcher.ts (logDecision com success/errorMessage opcional) */
  private async logDecision(
    conversationId: string,
    stateBefore: string,
    stateAfter: string,
    action: any,
    capabilities: any,
    opts?: { success?: boolean; errorMessage?: string; reasoningChain?: string },
  ) {
    await logDecisionExternal(this.supabase, this.organizationId, conversationId, stateBefore, stateAfter, action, capabilities, opts);
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

  // Opt-out detection removed — LLM handles it via prompt/transfer_to_human.

  // detectSentiment + classifyIntent extraídos para engine/utils.ts

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
    const intent    = classifyIntent(userMessage);
    const sentiment = detectSentiment(userMessage);  // item #17

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

  // checkOutOfHours extraído para engine/utils.ts
}
