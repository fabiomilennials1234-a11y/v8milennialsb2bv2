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
import { buildDynamicPrompt as buildDynamicPromptExternal } from "./engine/build-prompt.ts";
import { buildDynamicTools as buildDynamicToolsExternal } from "./engine/build-tools.ts";
import {
  processLLMResponse as processLLMResponseExternal,
  enqueueToolAction as enqueueToolActionExternal,
  enqueueAutomationActions as enqueueAutomationActionsExternal,
  enqueuePipelineStageUpdate as enqueuePipelineStageUpdateExternal,
} from "./engine/decide-action.ts";
import {
  createConversation as createConversationExternal,
  saveConversationContext as saveConversationContextExternal,
  updateContextSummaryAfterTurn as updateContextSummaryAfterTurnExternal,
  extractAndSaveMemories as extractAndSaveMemoriesExternal,
} from "./engine/persist-response.ts";
import {
  loadConversationContext as loadConversationContextExternal,
  getConversationHistory as getConversationHistoryExternal,
} from "./engine/history.ts";

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
      this.loadConversation(leadId, capabilities.id).then(c => c || createConversationExternal(this.supabase, this.organizationId, leadId, capabilities.id)),
      this.loadLeadData(leadId),
      loadConversationContextExternal(this.supabase, this.organizationId, leadId),
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
    const systemPrompt = await buildDynamicPromptExternal({
      supabase: this.supabase,
      capabilities,
      conversation,
      leadData,
      documentSummaries,
      semanticContext,
      longTermMemories,
      productCatalog,
      currentLeadId: this.currentLeadId,
      conversationContext: this.conversationContext,
      incomingMessageType: this.incomingMessageType,
    });

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
    const tools = await buildDynamicToolsExternal({
      supabase: this.supabase,
      organizationId: this.organizationId,
      capabilities,
      orgCustomFields,
      pipelineStages,
    });

    // 6. Call LLM via OpenRouter
    console.log('[AgentEngine] Step 6: Getting conversation history...');
    const historyMessages = await getConversationHistoryExternal({
      supabase: this.supabase,
      openRouter: this.openRouter,
      organizationId: this.organizationId,
      currentLeadId: this.currentLeadId,
      conversationId: conversation.id,
    });
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

      const { nextState: ns, actionToExecute: action, assistantMessage: msg, extraToolCalls } =
        processLLMResponseExternal(response, conversation, this.organizationId);
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
          executionResult = await enqueueToolActionExternal({
            supabase: this.supabase,
            organizationId: this.organizationId,
            currentLeadId: this.currentLeadId,
            action: currentAction,
            conversationId: conversation.id,
            turnCount: conversation.turn_count,
          });
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
    await enqueuePipelineStageUpdateExternal(
      this.supabase,
      this.organizationId,
      leadId,
      conversation.turn_count,
      actionToExecute,
    );

    // 12. Enqueue Automation Actions (if configured)
    console.log('[AgentEngine] Step 13: Enqueuing automation actions...');
    await enqueueAutomationActionsExternal(
      this.supabase,
      this.organizationId,
      leadId,
      nextState,
      capabilities,
    );

    console.log('[AgentEngine] Message processing complete', { parts: messageParts.length });

    // 13. Auto-update conversation_context_summary (item #2) — assíncrono, não bloqueia resposta
    updateContextSummaryAfterTurnExternal(this.supabase, this.organizationId, leadId, nextState, userMessage, cleanMessage, conversation.turn_count + 1)
      .catch(e => console.warn('[AgentEngine] Context summary update failed (non-fatal):', e));

    // 13.5. Item #19: Extrair e salvar memórias de longo prazo (fire-and-forget)
    extractAndSaveMemoriesExternal({
      supabase: this.supabase,
      openRouter: this.openRouter,
      organizationId: this.organizationId,
      leadId,
      agentId: capabilities.id,
      conversationId: conversation.id,
      turnCount: conversation.turn_count + 1,
      userMessage,
      assistantMessage: cleanMessage,
    })
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

  // enqueueAutomationActions + enqueuePipelineStageUpdate extraidos para engine/decide-action.ts.
  // processLLMResponse + enqueueToolAction idem. AgentEngine delega via *External.
  // Wrapper publico mantido para retrocompat com tests/unit/agent-engine-fallback.test.ts.
  async processLLMResponse(response: any, conversation: any, _capabilities?: any) {
    return processLLMResponseExternal(response, conversation, this.organizationId);
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

  // extractAndSaveMemories extraido para engine/persist-response.ts

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

  // loadConversationContext + getDefaultContext + extractContextFromMessages extraidos para engine/history.ts

  // saveConversationContext + createConversation extraidos para engine/persist-response.ts

  // buildDynamicPrompt + buildDynamicTools extraídos para engine/build-prompt.ts
  // e engine/build-tools.ts. AgentEngine delega via buildDynamicPromptExternal /
  // buildDynamicToolsExternal (importados no topo).

  /**
  // getConversationHistory + compressHistoryIfNeeded + getWhatsAppMessageHistory extraidos para engine/history.ts

  // processLLMResponse + enqueueToolAction extraidos para engine/decide-action.ts

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
    this.conversationContext = await loadConversationContextExternal(this.supabase, this.organizationId, leadId);
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
    const basePrompt = await buildDynamicPromptExternal({
      supabase: this.supabase,
      capabilities,
      conversation: fakeConv,
      leadData,
      documentSummaries,
      currentLeadId: this.currentLeadId,
      conversationContext: this.conversationContext,
      incomingMessageType: this.incomingMessageType,
    });

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

  // updateContextSummaryAfterTurn extraido para engine/persist-response.ts

  // checkOutOfHours extraído para engine/utils.ts
}
