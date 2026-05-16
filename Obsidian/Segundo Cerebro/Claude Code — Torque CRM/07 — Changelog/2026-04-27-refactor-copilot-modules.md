---
type: changelog
title: Changelog — 2026-04-27 (sessão tarde) — Refactor Copilot + Wizard Removal + Tabs Playground
status: shipped
created: 2026-04-27
updated: 2026-04-27
tags: [uncategorized]
related: []
owner: gabriel
---

# Changelog — 2026-04-27 (sessão tarde) — Refactor Copilot + Wizard Removal + Tabs Playground

Sessão long-form, tudo no branch `develop`. **Nada em `main`/prod ainda** — push pra main aguarda decisão explícita do CTO + smoke E2E real após aplicar migrations pendentes em dev.

## Sumário do que foi feito

| Item | Tipo | Linhas | Commit |
|---|---|---|---|
| 1. Time-Aware no playground + AgentConfigModal | feat | +718/-4 | `37f8e91` |
| 2. Remoção wizard legacy | chore | +1/-12.384 | `501ae98` |
| 3. Resolve obsidian merge conflict | chore | +10/-11 | `e9c8691` |
| 4. Tabs Prompt/Tools/Conhecimento + secao Produtos | feat | +78/-34 | `0aa3f5f` |
| 5. ai-action-executor.ts → 9 módulos `_shared/actions/*` | refactor (Fase A) | +1.648/-1.369 | `e0a0095` |
| 6. agent-engine utils puros → `engine/utils.ts` | refactor (B.1) | +373/-258 | `43b44b3` |
| 7. Smoke + comportamento + stress (47 testes) | test | +470 | `9506e12` |
| 8. E2E playwright habilitado (13/13 verde) | test | +23/-16 | `f5d3174` |
| 9. buildDynamicPrompt + buildDynamicTools → engine/* | refactor (B.2) | +1.236/-1.052 | `067d93b` |
| 10. processLLMResponse + enqueue helpers → engine/decide-action.ts | refactor (B.3) | +343/-280 | `bf40cbd` |
| 11. createConversation + saveContext + extractMemories → engine/persist-response.ts | refactor (B.4) | +285/-224 | `4371e2f` |
| 12. history loaders + compression → engine/history.ts | refactor (B.5) | +369/-308 | `57d795a` |
| 13. load-context aggregator | refactor (B.7) | +31/-3 | `fc2c2c9` |

Total: 13 commits, **~14k linhas movimentadas**, **0 testes regressivos**, deploy DEV LIVE.

---

## 1. Time-Aware no playground + AgentConfigModal

**Problema**: Time-Aware Behavior (deploy de ontem) ficou órfão. Wizard de criação foi descontinuado, mas a UI de Time-Aware vivia lá. Playground (`/copilot/novo` + `/copilot/:id/editar`) e modal de edição rápida (`AgentConfigModal`) não expunham os campos.

**Solução**:
- Novo componente `src/components/copilot/BehaviorWindowsEditor.tsx` (presentational, props-based, sem RHF). Reusável em 3 lugares.
- Adicionado `behaviorWindows` + `behaviorEnforcement` ao tipo `PlaygroundData`. Defaults com 3 janelas cobrindo 24/7.
- `CopilotPlayground` hidrata os campos no load + persiste no save + bloqueia save se cobertura 24/7 incompleta.
- `PlaygroundSettings` ganhou seção colapsável "Comportamento por horário (Time-Aware)" após "Horário de Funcionamento".
- `AgentConfigModal` ganhou nova tab "Comportamento" (4 tabs total: Geral / Funis / Comportamento / Audio) com save isolado direto em `copilot_agents`.

Backend, resolver `time-context.ts` e formato de save inalterados.

## 2. Remoção wizard legacy (-12.384 linhas)

**Problema**: Wizard de criação de copilot (`CopilotWizard.tsx` + 33 wizard-steps + 8 wizard-configs + `CopilotWizardTest.tsx`) foi substituído pelo `CopilotPlayground` (`/copilot/novo` + `/copilot/:id/editar`). Único link vivo era `StepAtivacao.tsx` no onboarding apontando pra `/copilot/novo-wizard`.

**Auditoria de paridade** (em [[2026-04-27#Auditoria de paridade wizard ↔ playground]]):
- Tools playground = capability flag + tool instruction (texto livre). Cobrem o COMO mas não os DADOS estruturados.
- 6 features dependem de tabela auxiliar (FAQs, kanban_rules, followup_rules, qualification.required_fields, few_shot_examples, automation_actions) — o backend faz lookup ou match estrutural. Tool flag liga, mas sem dado a IA improvisa. Funciona degradado.
- 3 features são cobertas implicitamente via texto livre do prompt (business_context, allowed/forbidden_topics, personality).

**Decisão do CTO**: deletar wizard mesmo. Playground supre a maioria dos casos via tool instructions; UI dedicada pros 6 gaps (FAQs/kanban/followup/qualification/examples/automation) entra depois quando alguém precisar.

**Removido**:
- `src/components/copilot/CopilotWizard.tsx` (1.214 linhas)
- `src/components/copilot/wizard-steps/` (33 arquivos)
- `src/components/copilot/wizard-configs/` (8 arquivos)
- `src/pages/CopilotWizardTest.tsx`
- Rotas `/copilot/novo-wizard` e `/copilot/teste-wizard` em `App.tsx`
- Lazy imports correspondentes
- Onboarding link (`StepAtivacao.tsx:15`) apontando agora pra `/copilot/novo`

**Mantido**: Hook `useUpdateCopilotAgentFromWizard` (CopilotPlayground depende). Tipos `CopilotWizardData` (hook usa internamente).

## 3. Tabs no playground + seção Produtos

**Problema**: Painel esquerdo do CopilotPlayground tinha PromptEditor + 3 painéis colapsáveis empilhados. Bagunçado. Editores curtos (min-h 100-140px). Nada para descrever produtos do cliente — campo essencial pro agente de vendas.

**Solução**:
- 3 tabs no painel esquerdo: **Prompt / Tools / Conhecimento**.
- Chat de teste (`LivePreviewChat`) sempre visível à direita em todas as tabs.
- **Nova seção `products`** em `PromptSections` (entre Fluxo e Instruções). Placeholder rico mostrando padrão de catálogo (planos, preços, diferenciais).
- Editores aumentados: personality 120→220, objective 100→200, flow 140→260, products 280, instructions 120→220 (min-h em px).
- Tab Prompt agrupa PromptEditor + PlaygroundSettings (horário, time-aware, comportamento, agente proativo).
- Wiring retrocompat: `PromptSections.products` opcional, spread defensivo em handleTemplateChange, narrowing seguro com `sectionValue ?? ""`.

Backend: `buildSystemPrompt` (frontend, em `CopilotPlayground.tsx`) injeta bloco `# PRODUTOS E SERVICOS` no `system_prompt` quando preenchido. Vai junto pro LLM via flux normal.

## 4. Refactor Fase A — `ai-action-executor.ts` → módulos por capability

**Problema**: God module 1.373 linhas. Manutenção ruim, bugs de regressão recorrentes.

**Estrutura nova** sob `supabase/functions/_shared/actions/`:

| Arquivo | Responsabilidade |
|---|---|
| `types.ts` | `ActionRecord`, `ActionResult`, `NOOP_ACTION_TYPES` |
| `index.ts` | Dispatcher `executeAiAction` (switch slim) |
| `log-history.ts` | `ACTION_HISTORY_MAP` + `logToLeadHistory` |
| `schedule-meeting.ts` | `executeScheduleMeeting`, `executeConfirmMeeting`, `executeAdvanceConfirmationStage` |
| `update-lead.ts` | `executeCreateLead`, `executeUpdateLead`, `executeCreateCustomField` |
| `move-card.ts` | `executeAdvanceStage`, `executeUpdatePipelineStage` |
| `qualify-lead.ts` | `executeUpdateQualificationScore`, `executeAutomation` |
| `transfer-human.ts` | `immediateTransferHuman`, `executeTransferHuman`, `executeTransferHumanNotify`, `executeTransferSzChat` |
| `send-document.ts` | `executeSendDocument` |
| `_helpers.ts` | `upsertPipeWhatsapp`, `executeMoveToPipe` (privados) |

`_shared/ai-action-executor.ts` virou **fachada de re-export** com 4 exports: `ActionRecord`, `ActionResult`, `NOOP_ACTION_TYPES`, `executeAiAction`, `immediateTransferHuman`. Imports externos não mudaram.

**Validação**: 23 testes verdes (`shared-ai-action-executor`, `ai-action-executor-time-aware`, `agent-engine-fallback`, `whatsapp-messages-idempotency-contract`).

## 5. Refactor Fase B — `agent-engine.ts` → módulos por fase do pipeline

**Problema**: God module 2.920 linhas com `class AgentEngine` orquestrando tudo. Coração do copilot, área frágil declarada em CLAUDE.md.

**Estrutura nova** sob `supabase/functions/agent-message/engine/`:

| Arquivo | Step | Linhas | Responsabilidade |
|---|---|---|---|
| `utils.ts` | B.1 | 354 | parseCustomInstructions, extractTopic, detectIntent, calculateLeadTemperature, calculateEngagementScore, detectSentiment, classifyIntent, checkOutOfHours |
| `build-prompt.ts` | B.2 | 786 | buildDynamicPrompt (assembla system_prompt do agente) |
| `build-tools.ts` | B.2 | 415 | buildDynamicTools (lista de tools disponíveis baseada em capabilities) |
| `decide-action.ts` | B.3 | 307 | processLLMResponse + enqueueToolAction + enqueueAutomationActions + enqueuePipelineStageUpdate |
| `persist-response.ts` | B.4 | 262 | createConversation + saveConversationContext + updateContextSummaryAfterTurn + extractAndSaveMemories |
| `history.ts` | B.5 | 354 | getConversationHistory + getWhatsAppMessageHistory + compressHistoryIfNeeded + extractContextFromMessages + loadConversationContext |
| `load-context.ts` | B.7 | 30 | aggregator de re-exports dos loaders compartilhados |

`agent-engine.ts` reduziu 2.920 → 924 linhas (-68%). Class `AgentEngine` continua como **orchestrator**: `processMessage` chama as funções extraídas via `*External` aliases.

**Wrappers public mantidos** (retrocompat com tests):
- `AgentEngine.processLLMResponse()` → `processLLMResponseExternal()` (tests/unit/agent-engine-fallback.test.ts depende)

**Pulados** (ROI baixo):
- B.6 (followup.ts) — `generateFollowupMessage` usa muito state interno (`this.X`). Extração traria interface bloating.
- B.8 (call-llm.ts) — `OpenRouterClient` já é wrapper sobre OpenRouter API. Adicionar mais um wrapper agrega zero.

**Validação**: 71 testes verdes em 5 arquivos (`refactor-smoke` 47 testes + 4 tests files de agent-engine/ai-action-executor).

---

## Deploys feitos

```
DEV (project bcfadphgsibjzivtbjvc):
  agent-message       deployed 2026-04-27 ~14:20  (após Fase B.7)
  process-ai-actions  deployed mesmo timestamp

PROD (project jsjsmuncfkbsbzqzqhfq):
  NADA. main intacto em 0aa3f5f.
```

## Smoke / E2E

- **Unit/integration**: 47 novos (`refactor-smoke.test.ts`) + 24 pré-existentes mantidos verdes. 0 regressões introduzidas.
- **E2E playwright**: 13/13 passando após criar user e2e em dev (`e2e@torque.test`) e ajustar locators (`/login` → `/auth`, placeholder de senha → `input#password`). Ver `tests/e2e/auth.setup.ts`.
- **Smoke real do agent-message em dev**: BLOQUEADO. Schema dev tem 24 migrations pendentes (mais recentes: `20260919000000`, `20260920000000`, `20260921000000`). Foreign keys de `copilot_agent_faqs`/`copilot_agent_kanban_rules` não estão no schema cache PostgREST → query `SELECT_AGENT` falha. Fix: aplicar migrations pendentes em dev (decisão do CTO).

## Bundle frontend

```
Antes: CopilotWizard-BXUfmYPr.js  287KB minificado / 70KB gzip
Depois: removido — wizard deletado
```

---

## Promoção pra main (quando autorizado)

1. **Aplicar migrations pendentes em dev**:
   ```
   supabase db push --linked
   ```
   24 migrations a aplicar. Maioria é DDL aditiva. Revisar `supabase/migrations/` antes.

2. **Smoke E2E real em dev**:
   - Criar agent + lead de teste (script já validado em `tests/unit/refactor-smoke.test.ts`).
   - Disparar `agent-message` com payload realista.
   - Verificar `conversations.state` incrementa, `conversation_messages` salvas, `pending_ai_actions` enfileiradas, `runtime_logs` recebe `prompt_built`, `lead_history` recebe side-effects.
   - Limpar entidades de teste após validação.

3. **Promover develop → main**:
   ```
   git push origin develop:main
   ```
   13 commits do dia entram. Backwards compatible — fachadas e wrappers preservam contratos externos.

4. **Deploy edge functions em prod**:
   ```
   supabase functions deploy agent-message process-ai-actions \
     --project-ref jsjsmuncfkbsbzqzqhfq
   ```

5. **Monitoramento pós-deploy** (primeiras 24h):
   - `runtime_logs.action='prompt_built'` deve continuar populado (não cair pra zero).
   - `pending_ai_actions.status='processed'` deve aumentar normalmente.
   - Sentry: zero novos erros do tipo `import` ou `cannot find module` nos paths refatorados.
   - Tempo médio de resposta do agent-message deve ficar igual ao baseline (~3-4s p50).

## Risco controlado

- **Comportamento idêntico ao pré-refactor**: cada extração foi byte-a-byte (ordem de seções do prompt, mensagens de erro, idempotency keys, ações enfileiradas, logs).
- **Fachadas de re-export**: `_shared/ai-action-executor.ts` ainda expõe `executeAiAction`, `immediateTransferHuman`, `ActionRecord`, `ActionResult`. Callers externos (`process-ai-actions`, tests, `agent-engine`) continuam intactos.
- **Wrappers public na class**: `AgentEngine.processLLMResponse()` mantido como wrapper.
- **Rollback fácil**: `git revert` dos commits específicos é viável caso prod regrida.

## Refs cruzados

- [[06 — Features/IA/Copilot]]
- [[04 — Decisões/ADR-2026-04-27-refactor-agent-engine-modular]]
- [[ADR-2026-04-26-trilha-3-unificacao-engines-refactor-copilot]] (refactor parcial anterior — módulos `_shared/copilot/*`)
- [[2026-04-27]] (manhã — Workflow Time-Aware Window)

---

## Auditoria de paridade wizard ↔ playground

| Feature | Wizard | Playground (hoje) | Backend usa | Tool playground supre? |
|---|---|---|---|---|
| FAQs (lista Q&A + embeddings) | ✅ | ❌ envia `[]` | ✅ `agent-engine.ts:1424` injeta no prompt | ❌ Tool RESPONDER_FAQ é só toggle. RAG semântico precisa de `copilot_agent_faqs` populada. |
| Kanban rules (pipe+stage→behavior) | ✅ | ❌ envia `[]` | ✅ `agent-engine.ts:1731` match estrutural | ❌ MOVER_CARD toggle só. LLM decide sem regra clara. |
| Followup rules (timing+intervalo+sequência) | ✅ | ❌ envia `[]` | ✅ `process-copilot-followups` cron | ❌ Cron lê tabela. Tabela vazia = zero followup automático. |
| Qualification rules (campos required/optional) | ✅ | ❌ envia `{}` | ✅ `agent-engine.ts:1208` | ❌ LLM improvisa quais perguntas fazer. Inconsistente. |
| Few-shot examples | ✅ | ❌ envia `[]` | ✅ `agent-engine.ts:1442` injeta `# EXEMPLOS DE CONVERSA` | ❌ Sem dado, sem exemplo. |
| Automation actions (on qualify/disqualify) | ✅ | ❌ vazio | ✅ `agent-engine.ts:566` imperativo | ❌ Move stage, adiciona tag, notifica. Imperativo, não LLM. |
| Personality (tone/style/energy) | ✅ | ❌ hardcoded | ✅ usa | ✅ Texto livre da seção `personality` substitui. |
| Outbound config (delay, retries, msg) | ✅ | ✅ parcial | ✅ `outbound-trigger` | ✅ |
| Activation triggers | ✅ | ✅ parcial | ✅ | ✅ |
| Behavior windows (Time-Aware) | ✅ | ✅ (hoje) | ✅ `time-context.ts` | ✅ |
| Business context | ✅ | ❌ envia `{}` | ✅ `agent-engine.ts:1206` | ✅ Pode escrever direto na seção `personality`/`objective` do prompt. |
| Topics permitidos/proibidos | ✅ | ❌ envia `[]` | ✅ `agent-engine.ts:1396-1413` | ✅ Texto livre cobre. |

**Conclusão**: 6 features dependem de tabela auxiliar (deveriam virar tabs no `AgentConfigModal` numa fase 2 do refactor). Pra cliente simples (qualificar genérico, transferir, atender FAQ via documents anexados), playground basta.
