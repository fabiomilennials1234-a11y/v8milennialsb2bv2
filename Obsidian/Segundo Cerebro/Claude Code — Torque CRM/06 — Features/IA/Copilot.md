---
type: feature
title: Copilot
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
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

## Toggle Copilot — sistema unificado (Onda 1+2+3 — 2026-04-26)

Bugs reportados pelo time ("switch não desliga", "responde mesmo desligado", "switch volta sozinho", etc) tratados em 3 ondas:

### Onda 1 — Hotfixes
- RPC `toggle_lead_ai/toggle_phone_ai/get_phone_ai_status` corrigida pra users multi-org (deriva org do lead via EXISTS, não LIMIT 1).
- UNIQUE INDEX `idx_leads_org_phone_unique` previne duplicatas (race webhook Meta).
- RPC `master_set_copilot_disabled` bypass `team_members` pra Master cross-org com audit.
- ChatShellWithContext usa RPC canônica.

### Onda 2 — Unify
- **`useCopilotToggle`** hook único — substitui 5 hooks fragmentados.
- Query key canônica `["copilot-toggle", orgId, normalizedPhone]`.
- Realtime publication em `phone_ai_preferences` + `useCopilotToggleRealtime` em MainLayout — broadcast cross-tela e cross-usuário.

### Onda 3 — Canonical
- Edge functions (`agent-message`, `sz-chat-webhook`, `process-copilot-followups`) lêem via `isCopilotCanceled` (preferences-first com fallback leads). `leads.ai_disabled` deixou de ser fonte de decisão.
- Trigger `sync_ai_state_from_preferences` propaga `phone_ai_preferences.ai_disabled` → `conversations.ai_state` automaticamente. Resolve banner takeover ambíguo.
- Página Master `/master/copilot-toggle-audit` — histórico de toggles + drift detection.

### Fonte de verdade

`phone_ai_preferences` (PK `organization_id+normalized_phone`) é fonte canônica:
- Frontend lê via `useCopilotToggle` (que chama `get_phone_ai_status`)
- Backend lê via `isCopilotCanceled` em `_shared/copilot/cancellation.ts`
- `conversations.ai_state` deriva via trigger
- `leads.ai_disabled` é denormalização (RPCs sincronizam ambas)

## Historico de mudancas

- **2026-04-26**: Toggle Copilot Onda 1+2+3 — fonte única canônica + hook unificado + realtime + audit page. Ver `07 — Changelog/2026-04-26.md`.
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

---

## Time-Aware Behavior (2026-04-26)

Capa nova sobre `availability`. Agente sabe que horas é, dia da semana, e segue instrução textual diferente por janela de horário.

### Schema
- `copilot_agents.behavior_windows` JSONB `[]`
- `copilot_agents.behavior_enforcement` text `'hard'|'soft'` (CHECK)

### Janela
```
{ id, name, days[], start: HH:MM, end: HH:MM, behavior: text }
```
Até 6 janelas por agente. First-match wins. Wrap midnight suportado (end ≤ start).

### Enforcement
- **Hard** (default): janela com behavior vazio devolve canned `out_of_hours_message` — não chama LLM
- **Soft**: sempre chama LLM com contexto temporal injetado — nunca bloqueia

### Resolver
`supabase/functions/_shared/copilot/time-context.ts` — `resolveActiveWindow(agent, now)` retorna `{ window, formatted, hasBehavior } | null`. Timezone-aware via `Intl.DateTimeFormat` (do agente em `availability.timezone`).

### Prompt
Bloco `# DISPONIBILIDADE` legacy substituído por `# CONTEXTO TEMPORAL` em `agent-engine.ts:1339`. Conteúdo:
```
- Agora: domingo, 27/04/2026 23:14 (America/Sao_Paulo)
- Janela ativa: "Madrugada"
- Comportamento esperado: tom casual, sinaliza retorno amanhã 9h
```

### Audit
`runtime_logs.payloadSnapshot.time_context` registra `{window_id, window_name, has_behavior, enforcement}` por mensagem.

### UI
`wizard-steps/AvailabilityStep.tsx` refatorada:
- Toggle global hard/soft (cards explicativos)
- Lista até 6 janelas (nome + dias chips + start/end + behavior textarea)
- Timeline 7×24 com cores por janela, gaps em vermelho
- Validação 24/7 obrigatória — save bloqueado com gaps + lista detalhada
- Preview "Agora seria janela X com behavior Y"

### Retrocompat
- Agente legacy (sem `behavior_windows`) → resolver retorna null → bloco DISPONIBILIDADE clássico mantido
- Agente backfilled (janela "Padrão" 7d/24h vazia) + `enforcement='hard'` → comportamento idêntico anterior
- 26 agentes prod backfilled automaticamente na migration

### Status (sessão 2026-04-26)
- F1 migration + backfill ✅ deploy prod
- F2 backend (resolver + prompt + checkOutOfHours) ✅
- F3 UI ✅
- F4 hooks/types ✅
- F5 semantic via prompt ✅ (F5b adiado: programmatic blocking de tools)
- F6 audit ✅

### Pendente
- F5b: blocking de `schedule_meeting` (slot fora comercial), mensagem variável em `transfer_to_human`. Precisa mudar assinatura tool handlers.
- Smoke E2E manual: criar janela "Madrugada" em agente real, conversar 23h, verificar resposta segue behavior + log time_context

Ver: [[ADR-2026-04-26-copilot-time-aware-behavior]]

---

## Refactor modular — agent-engine + ai-action-executor (sessão 2026-04-27)

Os 2 god modules do copilot foram quebrados em módulos focados por capability/fase.

### Estrutura nova

**Action executor** (`supabase/functions/_shared/actions/`):
| Arquivo | Capability |
|---|---|
| `types.ts` | ActionRecord, ActionResult, NOOP_ACTION_TYPES |
| `index.ts` | Dispatcher executeAiAction (switch slim) |
| `log-history.ts` | ACTION_HISTORY_MAP + logToLeadHistory |
| `schedule-meeting.ts` | schedule + confirm + advance_confirmation_stage |
| `update-lead.ts` | create_lead + update_lead + create_custom_field |
| `move-card.ts` | advance_stage + update_pipeline_stage |
| `qualify-lead.ts` | update_qualification_score + executeAutomation |
| `transfer-human.ts` | immediateTransferHuman + executeTransferHuman + transfer_to_human_notify + transfer_sz_chat |
| `send-document.ts` | send_document |
| `_helpers.ts` | upsertPipeWhatsapp + executeMoveToPipe (privados) |

`_shared/ai-action-executor.ts` virou fachada (4 re-exports). 1.373 linhas → 24 linhas.

**Agent engine pipeline** (`supabase/functions/agent-message/engine/`):
| Arquivo | Fase |
|---|---|
| `utils.ts` | Helpers puros (parseCustomInstructions, extractTopic, calculateLeadTemperature, classifyIntent, detectSentiment, checkOutOfHours, etc) |
| `build-prompt.ts` | buildDynamicPrompt — assembla system_prompt completo do agente |
| `build-tools.ts` | buildDynamicTools — lista de tools por capabilities |
| `decide-action.ts` | processLLMResponse + enqueueToolAction + enqueueAutomationActions + enqueuePipelineStageUpdate |
| `persist-response.ts` | createConversation + saveConversationContext + updateContextSummaryAfterTurn + extractAndSaveMemories |
| `history.ts` | getConversationHistory + getWhatsAppMessageHistory + compressHistoryIfNeeded + extractContextFromMessages + loadConversationContext |
| `load-context.ts` | Aggregator de re-exports (`_shared/copilot/*`) |

`agent-engine.ts` reduziu **2.920 → 924 linhas (-68%)**. `class AgentEngine` continua como orchestrator do `processMessage`. Cada método público delega via `*External` aliases.

### Arquivos onde mexer no Copilot agora

| Cenário | Ir em |
|---|---|
| Bug em qualificação/transfer/agendamento | `_shared/actions/<capability>.ts` |
| Mudar prompt do agente | `agent-message/engine/build-prompt.ts` |
| Adicionar nova tool | `agent-message/engine/build-tools.ts` |
| Mudar como processo decisão de ação | `agent-message/engine/decide-action.ts` |
| Mudar persistência (conversation, contexto, memórias) | `agent-message/engine/persist-response.ts` |
| Mudar como histórico é carregado/comprimido | `agent-message/engine/history.ts` |
| Helpers puros (intent, sentiment, etc) | `agent-message/engine/utils.ts` |
| Orquestração geral (processMessage) | `agent-message/agent-engine.ts` |

### Comportamento

**Idêntico ao pré-refactor**. Strings de prompt, ordem de seções, mensagens de erro, idempotency keys, ações enfileiradas — byte-a-byte preservados.

### Validação

- 71 testes verdes (47 smoke + comportamento + stress, 24 pré-existentes) em 5 arquivos.
- Deploy DEV LIVE (project `bcfadphgsibjzivtbjvc`).
- E2E playwright 13/13 verde com user `e2e@torque.test` em dev.
- Smoke real em dev: BLOQUEADO (24 migrations pendentes em dev — `copilot_agent_faqs`/`copilot_agent_kanban_rules` FKs faltando no schema cache).

### Refs

- [[ADR-2026-04-27-refactor-agent-engine-modular]]
- [[2026-04-27-refactor-copilot-modules]]
