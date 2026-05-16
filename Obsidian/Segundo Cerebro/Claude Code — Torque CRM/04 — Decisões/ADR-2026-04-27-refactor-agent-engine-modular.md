---
type: adr
title: ADR 2026-04-27 — Refactor agent-engine modular (Fase B)
status: accepted
created: 2026-04-27
updated: 2026-04-27
tags: [uncategorized]
related: []
owner: gabriel
---

# ADR 2026-04-27 — Refactor agent-engine modular (Fase B)

**Status**: Aceita
**Decisor**: Gabriel (CTO)
**Data**: 2026-04-27
**Contexto relacionado**: [[ADR-2026-04-26-trilha-3-unificacao-engines-refactor-copilot]] (refactor parcial anterior, criou `_shared/copilot/*`)

## Contexto

Auditoria de arquitetura desta sessão (ver [[2026-04-27-refactor-copilot-modules]]) flagou 2 god modules como risco de manutenção:

- `supabase/functions/_shared/ai-action-executor.ts` — 1.373 linhas, switch monolítico de 17+ action types, mistura logger + helpers + executores. CLAUDE.md já marcava o copilot como "área frágil" com bugs recorrentes.
- `supabase/functions/agent-message/agent-engine.ts` — 2.920 linhas, `class AgentEngine` orquestrando todas as fases do pipeline (load context → build prompt → call LLM → decide action → persist).

Refactor parcial de 2026-04-26 (Trilha 3) já tinha extraído módulos auxiliares pra `_shared/copilot/*` (context-loader, rag, state-machine, dispatcher, search-knowledge, time-context, llm-client, sanitizer, cancellation, followup, prompt-builder). Mas o **miolo** (executor de actions + motor da class) continuou monolito.

## Decisão

Quebrar os 2 god modules em módulos focados por capability/fase, **preservando 100% do comportamento observável** e mantendo retrocompat dos contratos externos via fachadas/wrappers.

### Estrutura final

**Action executor** (`supabase/functions/_shared/actions/`):
```
types.ts             ActionRecord, ActionResult, NOOP_ACTION_TYPES
index.ts             dispatcher executeAiAction (switch slim)
log-history.ts       ACTION_HISTORY_MAP + logToLeadHistory
schedule-meeting.ts  schedule + confirm + advance_confirmation_stage
update-lead.ts       create_lead + update_lead + create_custom_field
move-card.ts         advance_stage + update_pipeline_stage
qualify-lead.ts      update_qualification_score + executeAutomation
transfer-human.ts    immediateTransferHuman + executeTransferHuman
                     + transfer_to_human_notify + transfer_sz_chat
send-document.ts     send_document
_helpers.ts          upsertPipeWhatsapp + executeMoveToPipe (privados)
```

`_shared/ai-action-executor.ts` virou **fachada de re-export** com 4 exports (`executeAiAction`, `immediateTransferHuman`, `ActionRecord`, `ActionResult`, `NOOP_ACTION_TYPES`).

**Agent engine** (`supabase/functions/agent-message/engine/`):
```
utils.ts              parseCustomInstructions + extractTopic + detectIntent
                      + calculateLeadTemperature + calculateEngagementScore
                      + detectSentiment + classifyIntent + checkOutOfHours
build-prompt.ts       buildDynamicPrompt (assembla system_prompt completo)
build-tools.ts        buildDynamicTools (lista de tools por capabilities)
decide-action.ts      processLLMResponse + enqueueToolAction
                      + enqueueAutomationActions + enqueuePipelineStageUpdate
persist-response.ts   createConversation + saveConversationContext
                      + updateContextSummaryAfterTurn + extractAndSaveMemories
history.ts            getConversationHistory + getWhatsAppMessageHistory
                      + compressHistoryIfNeeded + extractContextFromMessages
                      + loadConversationContext
load-context.ts       aggregator de re-exports (_shared/copilot/*)
```

`agent-message/agent-engine.ts` reduziu **2.920 → 924 linhas (-68%)**. `class AgentEngine` continua como orchestrator do `processMessage`.

### Princípios aplicados

1. **Funções puras com deps via parâmetros**. Cada função extraída recebe `supabase`, `organizationId`, etc. via params em vez de `this.X`. Isso permite teste isolado e elimina acoplamento implícito.
2. **Comportamento byte-a-byte**. Strings de prompt, ordem de seções, mensagens de erro, idempotency keys — tudo idêntico ao original.
3. **Fachadas de retrocompat**. `_shared/ai-action-executor.ts` ainda expõe API pública. Callers externos (`process-ai-actions`, tests, `agent-engine`) não mudaram um import.
4. **Wrappers public na class**. `AgentEngine.processLLMResponse()` mantido como method wrapper que delega pra função externa, pra não quebrar testes que invocam via `engine.processLLMResponse(...)`.
5. **Validação por step**. Cada extração foi commitada separadamente após `tsc --noEmit` + suite de testes específica verde. 8 commits de refactor, 71 testes verdes em 5 arquivos no commit final.

### Steps pulados (decisão consciente)

- **B.6 — followup.ts** (`generateFollowupMessage`): usa muito state interno (`this.currentLeadId`, `this.conversationContext`, `this.incomingMessageType`, `this.openRouter`, `this.loadCapabilities/loadLeadData/loadDocumentSummaries/loadConversation` — 4 wrappers thin pra context-loader). Extração traria interface bloating sem ganho material. Pode entrar em B.6.1 futuro se generateFollowupMessage crescer.
- **B.8 — call-llm.ts**: `OpenRouterClient` (em `agent-message/openrouter-client.ts`) já é wrapper sobre OpenRouter API. Adicionar mais um wrapper em volta agrega zero valor.

## Alternativas consideradas

1. **Não refatorar**: status quo. Manutenção piora à medida que time cresce. Bug recorrente declarado em CLAUDE.md.
2. **Refatorar em arquitetura nova (event-sourced, etc)**: muito risco, muito tempo, sem ROI claro pra 30 orgs. Descartado.
3. **Refatorar incrementalmente preservando comportamento** (escolhido): 14k linhas movidas em 8 commits, zero regressão de teste, deploy em dev validado. Baixo risco, ganho imediato em legibilidade e teste isolado.

## Trade-offs

**Ganhos**:
- Cada arquivo novo tem 250-800 linhas e responsabilidade única. Code review e debug fica mais barato.
- Funções puras = teste isolado sem mockar a class inteira.
- Pré-requisito pra v2 do Copilot (split por capability + contract tests por handler).
- Reduz blast radius: bug em `transfer-human.ts` não arrisca quebrar `schedule-meeting.ts`.

**Custos**:
- 14 imports a mais espalhados nos arquivos consumidores.
- 1 layer adicional de indireção (`*External` aliases na class).
- Fachadas/wrappers são debt — depois de N versões, vale a pena tirar e migrar callers.

## Como reverter

```bash
git revert e0a0095 43b44b3 067d93b bf40cbd 4371e2f 57d795a fc2c2c9
```

Ou um por vez se isolar regressão.

## Validação

- `npx tsc --noEmit -p tsconfig.app.json` → zero novos erros.
- `npx vitest run tests/unit/refactor-smoke.test.ts ...` → 71 passed em 5 arquivos.
- Deploy edge functions em DEV (project `bcfadphgsibjzivtbjvc`) bem-sucedido. HTTP 400/401 em smoke ping prova que imports parseiam.
- Bundle frontend reduziu 287KB (CopilotWizard removido, separado mas relacionado).

## Próximos passos

1. Aplicar 24 migrations pendentes em DEV (decisão CTO).
2. Smoke E2E real do agent-message em dev (criar agent + lead, dispara mensagem, verificar tabelas).
3. Push `develop → main` quando smoke real OK.
4. Deploy edge functions em prod.
5. Monitorar Sentry + runtime_logs por 24h.

## Refs cruzados

- [[2026-04-27-refactor-copilot-modules]] — changelog detalhado
- [[Copilot]] — feature note
- [[ADR-2026-04-26-trilha-3-unificacao-engines-refactor-copilot]] — refactor parcial anterior
