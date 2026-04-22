---
tags:
  - claude-code
  - feature
  - torque-crm
  - ia
created: 2026-04-12
last_updated: 2026-04-22
status: active
---

# Copilot

> [!danger] Area Fragil
> Fluxo que mais gera confusao com usuarios e bugs recorrentes. Ao mexer aqui, SEMPRE testar o fluxo completo: criar agente → configurar → ativar → conversar com lead.

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

## Historico de mudancas

- **2026-04-22**: Fonte única do ai_disabled migrada para `phone_ai_preferences`. Gap temporal de envio mapeado como débito.
- **2026-04-13**: Documentacao atualizada — wizard deprecated, Playground e o fluxo principal. Dead code mapeado.
- **2026-04-12**: Documentacao inicial criada.

## Links relacionados

- [[Chat WhatsApp]]
- [[WhatsApp Evolution]]
- [[SZ Chat]]
- [[Follow-ups]]
- [[Workflow Builder]]
