---
tags:
  - claude-code
  - feature
  - torque-crm
  - ia
created: 2026-04-12
last_updated: 2026-04-12
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
- System prompt gerado automaticamente pelo wizard (nao editado manualmente)

## Como o usuario usa

1. Copilot → Criar Agente
2. Wizard de 20+ steps: template, personalidade, objetivo, FAQs, regras kanban, follow-up rules
3. Ativa agente → agente responde automaticamente a leads no WhatsApp
4. Monitora metricas em CopilotMetrics
5. Pode testar via Playground antes de ativar

## Edge cases

- Agente sem business_context gera respostas genericas
- Lead sem telefone nao recebe mensagens do agente
- Conversation sem messages nao aparece no historico
- Desativar agente nao para conversations em andamento imediatamente (batch em progresso completa)

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Copilot.tsx` — Lista de agentes
- `src/pages/CopilotMetrics.tsx` — Analytics de performance
- `src/components/copilot/CopilotWizard.tsx` — Wizard multi-step (20+ steps)
- `src/components/copilot/AgentConfigModal.tsx` — Config rapida
- `src/components/copilot/AgentFollowupRulesTab.tsx` — Regras de follow-up
- `src/components/copilot/AgentKanbanRulesTab.tsx` — Regras por stage do kanban
- `src/components/copilot/AgentMetricsTab.tsx` — Metricas do agente
- `src/components/copilot/AgentTtsSettings.tsx` — Config TTS ElevenLabs
- `src/components/copilot/playground/` — Interface de teste

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

- `src/types/copilot.ts` — Tipos para wizard, agent config, FAQs, kanban rules, follow-up rules, TTS, objective composite

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

## Historico de mudancas

## Links relacionados

- [[Chat WhatsApp]]
- [[WhatsApp Evolution]]
- [[SZ Chat]]
- [[Follow-ups]]
- [[Workflow Builder]]
