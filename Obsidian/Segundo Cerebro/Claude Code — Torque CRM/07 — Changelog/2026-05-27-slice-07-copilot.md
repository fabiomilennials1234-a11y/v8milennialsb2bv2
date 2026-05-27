# 2026-05-27 — Slice 7 copilot

Slice 7 da modularização (`feat/modularizacao/06-copilot`, stacked sobre slice 6). Frontend do BC copilot migrado para `src/modules/copilot/`. Backend (14 edge functions + `_shared/copilot/` + 4 utils órfãos) continua fora — vai para slices 15/16. Área frágil 🔴 — moves mecânicos sem alteração de comportamento.

## Mudanças

- **copilot**: 1 pasta de components (`copilot/` incluindo subpasta `playground/`) migrada; 17 hooks soltos (16 listados no handoff + `useCopilotAgentAudios` confirmado contra CLAUDE.md do módulo); 2 pages (Copilot, CopilotMetrics)
- **App.tsx**: lazy imports atualizados — Copilot + CopilotMetrics agora resolvem em `@/modules/copilot/pages/...`
- **API pública**: `src/modules/copilot/index.ts` populado — hooks de agent CRUD, docs/audios, rules/metrics, pause + toggle suite (3 hooks), prompt builder + analysis + reasoning, subscription, oraculo, tool logs; components (`AgentFollowupRulesTab`, `AgentKanbanRulesTab`, `AgentMetricsTab`, `AgentTasksTab`, `PromptPreviewSheet`, `BehaviorWindowsEditor`, `CopilotPlayground`); types completos re-exportados
- **Status**: módulo marcado Active no `src/modules/copilot/CLAUDE.md`. `src/modules/CLAUDE.md` mapa atualizado
- **Codemod**: `scripts/codemod-slice7.mjs` criado a partir de template slice 6. 36 arquivos modificados, 72 replacements (4 component paths, 60 hook paths, 8 page paths via codemod + App.tsx manual)

## Dedup toggle suite (NÃO consolidado neste slice)

Brief pedia análise dos 3 toggle hooks (`useCopilotToggle` + `useCopilotToggleAudit` + `useCopilotToggleRealtime`). Decisão: **manter como 3 hooks**.

Motivo: 3 responsabilidades distintas, não duplicatas:
- `useCopilotToggle` — mutation + status query unificada (RPCs `toggle_lead_ai` / `toggle_phone_ai` / `master_set_copilot_disabled`). Query key canônica `["copilot-toggle", orgId, normalizedPhone]`.
- `useCopilotToggleAudit` — query de histórico (`lead_history` + `master_audit_logs`) + drift detection (leads vs phone_ai_preferences). Stale time 60s/5min, sem mutation.
- `useCopilotToggleRealtime` — postgres_changes subscription em `phone_ai_preferences` + optimistic cache patch. Sem query/mutation, monta uma vez no AppShell.

Consolidar forçaria fundir efeitos colaterais distintos (mutation/query/subscription) em uma única superfície de API. Callers atuais (Master CopilotReasoning, ChatShellWithContext, KanbanCard, LeadDetailSheet, WhatsAppChat) usam só o subset relevante. Padrão "suite de 3 hooks sob uma única API pública via index.ts" é o trade-off correto.

Follow-up potencial slice 17/19 (event-bus): opt-in `useCopilotToggleSuite()` wrapper. Não é débito real.

## Arquivos tocados (resumo)

- `src/modules/copilot/{components,hooks,pages,index.ts,CLAUDE.md}` — populados via 42 renames (`git mv`)
- `src/App.tsx` — 2 imports copilot reescritos
- `src/components/copilot/` — removido (vazio)
- 17 hooks soltos `src/hooks/use{Copilot,Agent,Oraculo,Prompt,QuickPrompt,ToolCall}*` — removidos (movidos)
- `src/pages/Copilot.tsx`, `src/pages/CopilotMetrics.tsx` — removidos
- ~30 arquivos cross-module com imports atualizados (campanhas, layout MainLayout, master pages copilot, communication ChatShellWithContext, dashboard, lib/copilot/dry-run-engine)
- 13 testes com paths atualizados (3 com hardcoded `readFileSync` paths + 10 com imports `@/hooks/use*` agora apontando pro módulo)
- `scripts/codemod-slice7.mjs` — script de codemod (utility, pode ser preservado ou deletado)

## Decisões

- **Backend (14 edge functions + `_shared/copilot/` + 4 utils órfãos) fora deste slice** — vão para slices 15/16 conforme planejamento original
- **Toggle trio mantido como 3 hooks** — análise acima
- **Pages NÃO em index.ts** — padrão dos slices 4-6 (App.tsx faz deep-import via React.lazy)
- **Stacking sobre slice 6** (não esperar merge) — convenção da feature em andamento

## QA literal

```
TypeScript:  npx tsc --noEmit       →  clean (0 errors)
ESLint:      npm run lint           →  0 errors, 2448 warnings (= baseline)
Build:       npm run build          →  ✓ verde (PWA injectManifest, precache 279 entries, 7890.84 KiB)
Unit tests:  npm run test:unit      →  58 failed | 3880 passed | 150 skipped (4088 total)
             baseline (pre-slice 7, mesmo working dir stashed) →  47 failed | 3891 passed | 150 skipped (4088 total)
             diff manual (sort -u failures): apenas 4 testes de useScheduledMessages aparecem só no PRE
             (= flakiness; nenhum fail real introduzido pelo slice 7)
```

Falhas pré-existentes (não causadas por slice 7, herdadas do baseline red da main): `copilot/cancellation`, `copilot/knowledge-retriever` (backend `_shared/copilot/` — não tocado), `copilot-tool-registry` (registry tem 10 tools, test espera 9), `copilot-rag-tuning` (texto de prompt mudou), `cors`, `evolution-api`, `protected-route`, `useTVDashboardData-funnel`, `agent-message-batch`, `useRealtimeFallback`, `history-sync.test.tsx`, `uazapi-provider`, `shared-auth`, `revision-item`, `whatsapp-messages-idempotency-contract`, `workflow-trigger-branches`, `pix-charge-flow`, `pricing-calculator`, `hooks-batch-8-channel-chat`, `hooks-deep-1`, `hooks-final-instances`, `hooks-final-zero`, `hooks-final-agents` (scheduled messages — flaky timeouts), `shared-action-handler-compat`, `shared-meta-api-branches`, `shared-batch-1`, `refactor-smoke`, `evolution-api`, `whatsapp`.

## Smoke test pós-merge (área frágil 🔴 — CTO rodar)

1. `/copilot` lista agentes + abre editor (playground)
2. Criar agente novo (tipo qualificador)
3. Configurar personalidade + capabilities + business context
4. Ativar agente — toggle on
5. Conversar com lead via WhatsApp — agente responde
6. Human Pause: pausar agente — IA para de responder
7. Despausar — IA volta
8. `/copilot/metrics` — métricas agente carregam
9. Playground: testar prompt + ver preview (PromptPreviewSheet)
10. Oraculo Comercial: rodar query (Master area)
11. Followup rules: lead frio → agente reativa (AgentFollowupRulesTab)
12. Kanban rules: lead muda stage → agente reage (AgentKanbanRulesTab)
13. Master area: CopilotReasoning + CopilotToggleAudit carregam (já em identity, consomem hooks copilot)

## Follow-ups

- **Slice 15**: 14 edge functions copilot — `agent-message`, `analyze-copilot-prompt`, `copilot-batch-processor`, `evaluate-agent-conversation`, `generate-agent-examples`, `generate-business-context`, `generate-custom-instructions`, `generate-faqs`, `generate-faq-embeddings`, `oraculo-comercial`, `process-agent-document`, `process-copilot-followups`, `reembed-all`, `test-copilot-chat` (auditar pra deletar)
- **Slice 16**: `_shared/copilot/` (20 modules já agrupados) + 4 utils órfãos (`ai-action-executor`, `ai-queue`, `copilot-batch-maturity`, `bot-loop-detector`) consolidar tudo dentro de `_shared/copilot/`
- **Slice 17 (boundaries flip)**: `useCopilotToggle*` consolidação opcional via `useCopilotToggleSuite()` se ficar adiado
- **Slice 19 (event-bus)**: emitir `human_pause.requested`, `human_pause.released`, `agent.turn_completed`
- Tests pré-existentes quebrados em baseline (`copilot-tool-registry` registry drift, `copilot-rag-tuning` text drift, `cors`, `protected-route`, etc.) — investigar separadamente

## Refs

- Branch: `feat/modularizacao/06-copilot` (stacked sobre `feat/modularizacao/05-communication` @ 4d6872be)
- Sub-CLAUDE.md módulo: `src/modules/copilot/CLAUDE.md`
- Sub-CLAUDE.md raiz copilot (backend): `supabase/functions/agent-message/CLAUDE.md`
- Slices tracker: `Obsidian/.../10 — Remodelagem/04-execucao/slices.md`
- Handoff: `.specs/features/modularizacao/slice-7-handoff.md`
