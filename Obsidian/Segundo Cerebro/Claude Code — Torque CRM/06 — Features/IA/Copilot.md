---
tags:
  - claude-code
  - feature
  - torque-crm
  - ia
created: 2026-04-12
last_updated: 2026-04-26
status: active
---

# Copilot

> [!warning] Area Fragil — agora com refactor + cobertura
> Continua sendo o fluxo mais complexo. Mas Trilha 3.B (2026-04-26) extraiu
> 17 funcoes pure de `agent-engine.ts` (3314 → 2828 LOC) pra modulos
> `_shared/copilot/*.ts` com **88 testes unit 100% PASS**. Bugs estruturais
> de Onda 1 (race condition turn_count, idempotency_key, transfer atomic)
> corrigidos via RPCs atomic. Cache LRU em `loadCapabilities` evita 1
> query/mensagem em burst.
> Ao mexer aqui ainda: testar criar agente → configurar → ativar →
> conversar. Mas agora tu tem testes pra rodar antes (`npx vitest run tests/unit/copilot/`).

> [!info] Feature flag `organizations.copilot_engine_version` (Trilha 3.B B3)
> Coluna `v1` (default) | `v2` controla qual engine roda por org. Hoje
> v1==v2 funcionalmente (refactor B1 transparente). Toggle disponivel em
> `/master/automation-health` tab "Engine". Quando v2 real divergir
> (refactor maior, mudanca LLM, etc), canary 1-2 orgs antes rollout 100%.

## O que faz

Agentes IA conversacionais que interagem com leads via WhatsApp/SZ.Chat. Templates: qualificador, sdr, followup, agendador, prospectador, custom. Cada agente tem personalidade (tom, estilo, energia), capabilities, regras de kanban por stage, follow-up rules, FAQs embedadas via pgvector (1536d Gemini), e TTS via ElevenLabs.

## Regras de negocio

- Um agente default por org
- Copilot respeita human takeover (pausa 10 min quando humano assume)
- Batch de 8s para agrupar msgs antes de responder
- SmartSplitMessage para chunking natural de respostas longas
- Max FAQs e agentes por plano (quota enforcement via org_quotas)
- Conversas em `conversations` + `conversation_messages`
- System prompt gerado automaticamente pelo Playground (nao editado manualmente)

## Como o usuario usa (fluxo atual)

1. Copilot → Criar Agente
2. **CopilotPlayground** — interface unica com:
   - Prompt editor (personalidade, objetivo, fluxo, instrucoes)
   - Settings colapsaveis (temperature, delay, disponibilidade)
   - Tools panel (10 ferramentas configuraveis com instrucoes)
   - Knowledge base (docs + links)
   - Live chat preview (teste em tempo real)
3. Templates funcionam como **presets** que pre-populam o playground
4. Ativa agente → agente responde automaticamente a leads no WhatsApp
5. Monitora metricas em CopilotMetrics
6. Config rapida via AgentConfigModal (tabs: Geral + Funis)

## Edge cases

- Agente sem business_context gera respostas genericas
- Lead sem telefone nao recebe mensagens do agente
- Conversation sem messages nao aparece no historico
- Desativar agente nao para conversations em andamento imediatamente (batch em progresso completa)

---

## Como funciona (tecnico)

### Componentes (ativos)

- `src/pages/Copilot.tsx` — Lista de agentes, criar/ativar/desativar/deletar
- `src/pages/CopilotMetrics.tsx` — Analytics de performance
- `src/components/copilot/playground/` — **Fluxo principal de criacao/edicao** (CopilotPlayground)
- `src/components/copilot/AgentConfigModal.tsx` — Config rapida (tabs Geral + Funis)
- `src/components/copilot/AgentFollowupRulesTab.tsx` — Regras de follow-up
- `src/components/copilot/AgentKanbanRulesTab.tsx` — Regras por stage do kanban
- `src/components/copilot/AgentMetricsTab.tsx` — Metricas do agente
- `src/components/copilot/AgentTtsSettings.tsx` — Config TTS ElevenLabs

> [!warning] Dead Code — Wizard (deprecated)
> Os seguintes arquivos existem no codebase mas **NAO sao usados na UI**:
> - `src/components/copilot/CopilotWizard.tsx` — Wizard multi-step antigo (rota `/copilot/novo-wizard`, nao linkada)
> - `src/pages/CopilotWizardTest.tsx` — Pagina de teste do wizard (marcada pra remocao)
> - `src/lib/copilot/followupSchedule.ts` — Logica de agendamento de follow-up (importado por ninguem)
> - `src/lib/copilot/prompt-quality.ts` — Score de qualidade do prompt (so importado pelo wizard)
> - `src/lib/copilot/step-tips.ts` — Dicas por step do wizard (so importado pelo wizard)
> - `src/lib/copilot/prompt-utils.ts` — Preview de prompt (so no wizard e TestConversationStep)
> 
> **Templates (`templates.ts`) e template-prompts (`template-prompts.ts`) continuam ATIVOS** — usados como presets no Playground.

### Hooks

- `useCopilotAgents()` / `useCopilotAgent(id)` — CRUD de agentes
- `useCreateCopilotAgent()` / `useUpdateCopilotAgent()` / `useDeleteCopilotAgent()`
- `useToggleCopilotAgent()` / `useSetDefaultCopilotAgent()`
- `useCopilotAgentFaqs()` — FAQs com embeddings
- `useCopilotKanbanRules()` — Regras por stage
- `useAgentFollowupRules()` — Automacao de follow-ups
- `useCopilotSubscription()` — Realtime
- `useCopilotPromptBuilder()` — Construcao do system prompt
- `useCopilotAgentAudios()` — Audios TTS

### Edge Functions

- `agent-message` — Processamento de mensagem via OpenRouter LLM
- `summarize-conversation` — Resumo de conversas
- `evaluate-agent-conversation` — Avaliacao de qualidade
- `generate-agent-examples` — Gerar exemplos de conversa
- `generate-business-context` — Gerar contexto de negocio
- `generate-custom-instructions` — Gerar instrucoes customizadas
- `generate-faq-embeddings` — Embeddings FAQs (pgvector 1536d Gemini)
- `generate-faqs` — Gerar FAQs automaticas
- `test-copilot-chat` — Teste de chat
- `elevenlabs-proxy` — TTS
- `outbound-trigger` — Disparo outbound

### Shared Modules

- `_shared/ai-action-executor.ts` — Executor de acoes IA
- `_shared/embeddings.ts` — Embeddings Gemini + pgvector
- `_shared/natural-messaging.ts` — Humanizacao de mensagens
- `_shared/message-humanizer.ts` — Humanizacao
- `_shared/tts-elevenlabs.ts` — Text-to-speech

### Tabelas

- `copilot_agents` — template_type, personality_tone/style/energy, skills[], allowed_topics[], forbidden_topics[], main_objective, objective_composite JSONB, system_prompt, is_active, is_default
- `copilot_agent_faqs` — question, answer, position (embeddings via pgvector)
- `copilot_agent_kanban_rules` — pipe_type, stage_name, goal, behavior, allowed_actions[], forbidden_actions[]
- `copilot_agent_followup_rules` — name, trigger_type, priority, filters JSONB, behavior JSONB
- `copilot_agent_audios` — name, storage_path, public_url, mime_type, is_active
- `conversations` — lead_id, agent_id, status
- `conversation_messages` — conversation_id, role, content, timestamp

### Types

- `src/types/copilot.ts` — Tipos para agent config, FAQs, kanban rules, follow-up rules, TTS, objective composite (inclui tipos legados do wizard que ainda sao usados pelos types)

### Fluxo de dados

```
Lead envia mensagem (WhatsApp/SZ.Chat)
  → evolution-webhook / sz-chat-webhook
    → Detecta agente ativo para a instancia
      → Batch 8s (agrupa mensagens consecutivas)
        → agent-message: busca context + FAQs (pgvector) + kanban rules
          → OpenRouter LLM gera resposta + acoes
            → SmartSplitMessage chunka resposta
              → Envia chunks via Evolution API / SZ.Chat
                → Se acao: executa (mover stage, add tag, etc.)
                  → Se TTS ativo: gera audio via ElevenLabs → envia
```

---

## Fonte de verdade do ai_disabled

Desde 2026-04-22, a fonte de verdade para "IA ligada/desligada" por contato é a tabela `phone_ai_preferences(organization_id, normalized_phone, ai_disabled, ...)`. `leads.ai_disabled` continua existindo como denormalização. Consumidores (agent-message, evolution-webhook, get_lead_ai_status) **não mudaram** — leem de `leads.ai_disabled` como sempre, que é mantido em sincronia pelas RPCs `toggle_phone_ai` e `toggle_lead_ai`.

Ver detalhes em [[Chat WhatsApp#Toggle de IA (ai_disabled)]] e [[ADR-2026-04-22-phone-ai-preferences]].

> [!warning] Gap de envio — task pendente
> Existe uma janela de 15–36s entre o copilot **gerar** a resposta (via OpenRouter LLM em `agent-message`) e o **envio** pelo Evolution API. Durante essa janela, `ai_disabled` **não** é re-checada. Resultado: se o vendedor desliga a IA no meio dessa janela, a mensagem da IA ainda é enviada. Task separada — resolver via re-check em `agent-message` imediatamente antes do send. A task atual fechou as inconsistências de estado; essa fecha o gap temporal.

## Invariantes operacionais (pós-ADR 2026-04-23)

- **Toda resposta do Copilot termina em 1 de 3 estados explícitos**: texto válido / transferência humana / erro estruturado com telemetria. Fallback genérico é último recurso com `fallback_used=true` em runtime_logs.
- **Contrato OpenAI respeitado**: assistant com tool_calls envia `content:null`, nunca string vazia.
- **Forced-text turn**: se o loop multi-turn termina sem texto, o engine faz uma chamada extra com `tool_choice:'none'` antes de cair em fallback.
- **Telemetria por invocação** em `runtime_logs.payload_snapshot`: `turns_used`, `tools_called`, `finish_reasons`, `forced_text_turn_used`, `fallback_used`, `truncated`.
- **Tenant isolation em loadConversation**: filtra por `(lead_id, agent_id, organization_id)` com `.order().limit(1)` — sem risco de cross-agent bleeding.
- **`organization_id` obrigatório** no body de `agent-message`. Modo legado de lookup cross-tenant por telefone foi removido (retorna 400).
- **Uazapi → Copilot bridge**: `whatsapp-webhook` dispara `agent-message` fire-and-forget em cada incoming com texto. Parity com `sz-chat-webhook` e `evolution-webhook`.

## Reasoning Chain (RC v1 — 2026-04-26)

Agentes respondem em formato `<thinking>...</thinking><response>...</response>`. O `<thinking>` é capturado em `runtime_logs.reasoning` e correlacionado em `agent_decision_logs.reasoning_chain` — nunca chega ao lead.

### Configuração por agente

`copilot_agents.reasoning_mode`:
- `'always'` (default) — toda resposta tem reasoning.
- `'actions_only'` — só quando o turno usa tool (schedule_meeting, qualify_lead, transfer_to_human, advance_stage, send_product_material, etc).
- `'off'` — desliga; bloco não vai pro prompt.

### Fluxo

1. `buildDynamicPrompt` injeta seção `# FORMATO DE RESPOSTA OBRIGATÓRIO` quando `reasoning_mode != 'off'`.
2. LLM responde com `<thinking>...</thinking><response>...</response>`.
3. `sanitizeAssistantMessage` (passo 0) chama `extractReasoningChain` — extrai reasoning, devolve só conteúdo de `<response>`. Defensive: se `<thinking>` abriu sem fechar, descarta tudo após (anti-vazamento).
4. `processMessage` dispara `logRuntime({module:'copilot', action:'reasoning'})` fire-and-forget.
5. `logDecision` recebe `opts.reasoningChain` → grava em `agent_decision_logs.reasoning_chain`.

### UI

Página `/master/copilot-reasoning` (Master Admin, permission `audit`) — filtros de org, agente, conversation, janela. Tabela com expand inline pro raciocínio completo.

### Custo estimado

- Tokens/turn: +30-50%.
- Latência: +1-3s.
- Mitigação: feature flag por agente; rollback hard via `UPDATE copilot_agents SET reasoning_mode='off'`.

### Invariantes

- Conteúdo de `<thinking>` **nunca** aparece em `conversation_messages.content`. Defensive strip + final cleanup garantem.
- `runtime_logs.reasoning` é NULL quando `reasoning_mode='off'` ou agente não emitiu o bloco — não bloqueia turno.

## Cancel-on-Disable (RC-cancel — 2026-04-26)

Quando user clica no switch pra desativar o copilot mid-conversa, qualquer mensagem em-flight é cancelada. Cobre 3 janelas de delay:

1. **Pré-LLM** (batch wait sz-chat-webhook): re-check pós-batch (existia).
2. **Durante LLM** (5-30s): `agent-message` checa pós-LLM. Se desativado, delete assistant message recém-persistida + retorna `skipped: true`.
3. **Per-chunk** (smartSplit + setTimeout): senders checam antes de cada chunk. Cancela loop.

Helper: `_shared/copilot/cancellation.ts` — `isCopilotCanceled(supabase, orgId, phone)` lê `phone_ai_preferences.ai_disabled` (fonte de verdade) com fallback `leads.ai_disabled`.

Senders patcheados:
- `sendSzChatResponse` (sz-chat-webhook)
- `outbound-sender.sendText` (BDR)
- `followup-sender` (followups)
- `agent-message/index.ts` pós-LLM

Logs: `runtime_logs WHERE module='copilot' AND action='copilot_canceled'` com payload `{ gate, chunks_sent, chunks_total, source }`.

Decisões CTO:
- Reply cancelada NÃO entra no histórico (delete da `conversation_messages`).
- Cancela tudo no meio (chunk N+1 não envia mesmo se chunk N saiu).
- Liga universal (sem feature flag).

NÃO coberto: `whatsapp-webhook` Uazapi reply (rota não mapeada), `send_document/send_product_material` (sem delay relevante).

## Historico de mudancas

- **2026-04-26**: Cancel-on-Disable (RC-cancel) — cancela copilot mid-flight em todas as janelas de delay. Ver `07 — Changelog/2026-04-26.md` (seção RC-cancel).
- **2026-04-26**: Reasoning Chain v1 — chain-of-thought visível pra debug, configurável por agente, default `'always'`. Ver `07 — Changelog/2026-04-26.md` (seção RC).
- **2026-04-23**: Fallback elimination + Uazapi→Copilot bridge + tenant isolation + telemetria. Ver [[ADR-2026-04-23-copilot-fallback-elimination]].
- **2026-04-22**: Fonte única do ai_disabled migrada para `phone_ai_preferences`. Gap temporal de envio mapeado como débito.
- **2026-04-13**: Documentacao atualizada — wizard deprecated, Playground e o fluxo principal. Dead code mapeado.
- **2026-04-12**: Documentacao inicial criada.

## Links relacionados

- [[Chat WhatsApp]]
- [[WhatsApp Evolution]]
- [[SZ Chat]]
- [[Follow-ups]]
- [[Workflow Builder]]
