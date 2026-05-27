# 2026-05-27 — Slice 8 workflows

Slice 8 da modularização (`feat/modularizacao/07-workflows`, stacked sobre slice 7). Frontend do BC workflows migrado para `src/modules/workflows/`. Backend (5 edge functions + `_shared/workflow-*` + `_shared/actions/` + `_shared/action-handlers/`) continua fora — vai para slices 15/16. Área frágil 🟠 — moves mecânicos sem alteração de comportamento.

## Mudanças

- **workflows**: 1 pasta de components (`automacoes/`) com 43 arquivos (11 raiz + `action-configs/` + `edges/` + `nodes/` + `sidebar-panels/`) migrada; 7 hooks soltos (`useWorkflows`, `useWorkflowAnalytics`, `useWorkflowPortability`, `useWorkflowTemplates`, `useStageWorkflows`, `useAutomationHealth`, `useAutoFollowUp`); 3 pages (Automacoes, AutomacoesEditor, AutomacoesExecucoes)
- **App.tsx**: lazy imports atualizados — Automacoes + AutomacoesEditor + AutomacoesExecucoes agora resolvem em `@/modules/workflows/pages/...` (via path relativo `./modules/workflows/pages/...`)
- **API pública**: `src/modules/workflows/index.ts` populado — hooks workflow CRUD + execuções, analytics, portability, templates, stage<->workflow bindings, automation health (dashboard master), `triggerFollowUpAutomation` server-side helper
- **Status**: módulo marcado Active no `src/modules/workflows/CLAUDE.md`. `src/modules/CLAUDE.md` mapa atualizado (linha 6 Skeleton → Active)
- **Codemod**: `scripts/codemod-slice8.mjs` criado a partir de template slice 7. 43 arquivos modificados, 65 replacements (13 component paths + 1 action-configs subpath, 49 hook paths, 3 page paths absolutos + 3 paths relativos do App.tsx)

## Decisão — hooks adjacentes não migrados

Brief pedia análise caso a caso de `useAutoAdminAssignment` e `useAutoMoveUpsellClients`.

- **`useAutoAdminAssignment.ts`** → **NÃO migrado**. Bootstrap de identity (atribui role admin ao primeiro usuário criado, cria team_member). Zero referência a workflow APIs ou triggers. Possivelmente migra pra `identity` em slice futura.
- **`useAutoMoveUpsellClients.ts`** → **NÃO migrado**. Orquestração leads/carteira pura — calcula dias desde última venda e movimenta clientes `upsell_clients` baseado em regras de pipeline (`auto_move_min_days`/`auto_move_max_days`). Zero referência a workflow APIs ou triggers. Migra pra `carteira` no slice 10.

## Arquivos tocados (resumo)

- `src/modules/workflows/{components,hooks,pages,index.ts,CLAUDE.md}` — populados via 54 renames (`git mv`)
- `src/App.tsx` — 3 imports automacoes reescritos (lazy)
- `src/components/automacoes/` — removido (vazio)
- 7 hooks soltos `src/hooks/use{Workflow*,StageWorkflows,AutomationHealth,AutoFollowUp}` — removidos (movidos)
- `src/pages/Automacoes.tsx`, `src/pages/AutomacoesEditor.tsx`, `src/pages/AutomacoesExecucoes.tsx` — removidos (movidos)
- ~30 arquivos cross-module com imports atualizados (pipelines pages/hooks/kanban, modules/identity master MasterAutomationHealth, hooks/useCampanhas, components/system-alerts AlertsBanner)
- ~15 testes em `tests/unit/` com paths atualizados (mocks `vi.mock("@/hooks/useAutoFollowUp", ...)` agora apontam pro módulo)
- `scripts/codemod-slice8.mjs` — script de codemod (utility, pode ser preservado)

## Decisões

- **Backend (5 edge functions + `_shared/workflow-*` + `_shared/actions/` + `_shared/action-handlers/` + audit nomenclatura) fora deste slice** — vão para slices 15/16 conforme planejamento original
- **`triggerStageChangedWorkflows` chamado em 3 lugares — NÃO consolidado** — bug doc reconhecido (`08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md`). Fix em slice 19 event-bus (piloto migra `lead.stage_changed`)
- **Pages NÃO em index.ts** — padrão dos slices 4-7 (App.tsx faz deep-import via React.lazy)
- **Stacking sobre slice 7** (não esperar merge) — convenção da feature em andamento
- **`useAutoAdminAssignment` e `useAutoMoveUpsellClients` mantidos em `src/hooks/`** — análise acima

## QA literal

```
ESLint:      npm run lint           →  0 errors, 2448 warnings (= baseline)
Build:       npm run build          →  ✓ verde (PWA injectManifest, precache 279 entries, ~7890 KiB)
Unit tests:  npm run test:unit      →  46 failed | 3892 passed | 150 skipped (4088 total)
             baseline pré-slice 7 (memória CI baseline red) →  47 failed | 3891 passed | 150 skipped
             slice 7 fechou em                                 →  58 failed | 3880 passed | 150 skipped
             slice 8 fechou em                                 →  46 failed | 3892 passed | 150 skipped (melhor que slice 7, dentro do baseline)
             diff: workflow-trigger-branches já falhava no pré-slice 8 (verificado com git stash)
Tests workflow-related em isolado:
  npx vitest run hooks-batch-8-workflows.test.ts use-workflows.test.ts \
                 hooks-sprint2-stage-workflows.test.ts menu-pix-nodes.test.tsx \
                 workflowPortability.test.ts
  →  74 passed | 0 failed (5 files, 0 regressões)
```

Falhas pré-existentes (não causadas por slice 8): `copilot/cancellation`, `copilot/knowledge-retriever`, `copilot-tool-registry`, `copilot-rag-tuning`, `cors`, `evolution-api`, `protected-route`, `useTVDashboardData-funnel`, `agent-message-batch`, `useRealtimeFallback`, `history-sync.test.tsx`, `uazapi-provider`, `shared-auth`, `revision-item`, `whatsapp-messages-idempotency-contract`, `workflow-trigger-branches`, `pix-charge-flow`, `pricing-calculator`, `hooks-batch-8-channel-chat`, `hooks-deep-1`, `hooks-final-instances`, `hooks-final-zero`, `hooks-final-agents` (scheduled messages — flaky timeouts), `shared-action-handler-compat`, `shared-meta-api-branches`, `shared-batch-1`, `refactor-smoke`, `whatsapp`.

## Smoke test pós-merge (área frágil 🟠 — CTO rodar)

1. `/automacoes` lista workflows
2. Criar workflow novo (trigger `lead_created` + action `send_message`)
3. Abrir editor (`/automacoes/editor/<id>`) — canvas + sidebar + toolbar carregam
4. Adicionar nodes (action, condition, delay, copilot, webhook_call, wait_response, wait_business_window, split_ab, goto, assign_responsible, end)
5. Salvar workflow — persiste no banco
6. Ativar workflow — toggle on
7. Criar lead — workflow dispara (verificar `workflow_executions`)
8. `/automacoes/execucoes/<id>` — lista execuções + steps + retry de falhada
9. Template — `WorkflowTemplates` em `/automacoes` clona template
10. Export — `WorkflowImportDialog` baixa JSON
11. Import — re-upload do JSON cria workflow
12. Master `/master/automation-health` — stats + dead letter + failed workflows + stuck actions + circuit broken webhooks + system alerts (banner)
13. Pipelines: Kanban (PipeWhatsapp/Confirmacao/Propostas + CustomPipeline) mostra badge `StageWorkflowsBadgeWrapper` em stage que tem workflow vinculado
14. Pipe move → workflow dispara (`triggerStageChangedWorkflows`)
15. Follow-up automation: lead muda stage → cria follow_ups via `triggerFollowUpAutomation`

## Follow-ups

- **Slice 10 (carteira)**: mover `useAutoMoveUpsellClients` pra `src/modules/carteira/hooks/`
- **Slice 15**: 5 edge functions workflow — `process-workflow-executions`, `process-ai-actions`, `process-followup-automations`, `get-automation-jobs`, `test-workflow-system` (auditar pra deletar)
- **Slice 16**: `_shared/workflow-*.ts` (executor, action-handler, condition-evaluator, trigger, trigger-dedup) + audit `actions/` vs `action-handlers/` (nomenclatura ambígua) → consolidar tudo dentro de `_shared/workflows/`. Considerar mover tipos `Workflow*` em `@/types/workflow` pra dentro do módulo
- **Slice 17 (boundaries flip)**: warn-only → error nos cross-imports
- **Slice 19 (event-bus piloto)**: emitir `workflow.step_executed`, `workflow.completed`, `workflow.failed`. Fix `triggerStageChangedWorkflows` chamado em 3 lugares (bug doc)
- Tests pré-existentes quebrados em baseline — investigar separadamente

## Refs

- Branch: `feat/modularizacao/07-workflows` (stacked sobre `feat/modularizacao/06-copilot` @ cf8c2163)
- Sub-CLAUDE.md módulo: `src/modules/workflows/CLAUDE.md`
- Bug doc: `Obsidian/.../08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md` (resolução slice 19)
- Slices tracker: `Obsidian/.../10 — Remodelagem/04-execucao/slices.md`
- Slice de referência: slice 7 copilot (commit cf8c2163, changelog `2026-05-27-slice-07-copilot.md`)
