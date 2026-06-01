# 2026-05-27 — Slice 9 campaigns

Slice 9 da modularização (`feat/modularizacao/08-campaigns`, stacked sobre slice 8). Frontend do BC campaigns migrado para `src/modules/campaigns/`. Backend (6 edge functions + `_shared/campaign-distribution.ts`) continua fora — vai para slices 15/16. Moves mecânicos sem alteração de comportamento; zero pixel, zero schema.

## Mudanças

- **campaigns**: 1 pasta de components (`campanhas/`) com 20 arquivos migrada; 4 hooks soltos (`useCampanhas`, `useCampaignTemplates`, `useMassSendJobs`, `useDispatchQueueItems`); 3 pages (Campanhas, CampanhaDetail, MassSend órfã); pasta `src/pages/campaigns/` deletada (vazia após move)
- **App.tsx**: lazy imports atualizados — Campanhas + CampanhaDetail agora resolvem em `@/modules/campaigns/pages/...` (via path absoluto)
- **API pública**: `src/modules/campaigns/index.ts` populado — Campanha CRUD/stages/members/leads/viewers/pipe-automations/dispatch-rules, campaign templates + dispatch batches/logs/stats, mass send (Uazapi `/sender/*`), dispatch queue (cross-module com pipelines)
- **`communication.useWhatsAppChat` barrel** atualizado: re-export de `useMassSend*` agora aponta pra `@/modules/campaigns` (API pública), não mais deep-import — alinha com convenção de cross-module via barrel público
- **Status**: módulo marcado Active no `src/modules/campaigns/CLAUDE.md`. `src/modules/CLAUDE.md` mapa atualizado (linha campaigns Skeleton → Active)
- **Codemod**: `scripts/codemod-slice9.mjs` criado a partir de template slice 8. 41 arquivos modificados, 67 replacements (components paths + hook paths + page paths absolutos + paths relativos do App.tsx)

## Decisão — hooks adjacentes não migrados

Brief pediu análise caso a caso de `useUpsellCampanhas`, `useOutboundMetrics`, `MessageTemplates.tsx`.

- **`useUpsellCampanhas.ts`** → **NÃO migrado**. Entidade `upsell_campanhas` pertence ao domínio `carteira` (upsell pós-venda), não a campaigns. Consumido exclusivamente por `src/components/upsell/` (que migra pra carteira em slice 10). Mover agora criaria cross-module desnecessário pré-slice 10.
- **`useOutboundMetrics.ts`** → **NÃO migrado**. Métricas agregadas do dashboard outbound — domínio `analytics` (slice 12). Consumido por `DashboardOutbound.tsx` + `OutboundMetricCards.tsx`. Zero dependência das entidades de campaigns.
- **`useChecklistTemplates.ts`** → **NÃO migrado**. Domínio `engagement` (checklists), não campaign templates.
- **`useOnboardingTemplates.ts`** → **NÃO migrado**. Domínio `platform` (onboarding).
- **`src/pages/MessageTemplates.tsx`** → **NÃO migrado**. Cross-cutting platform feature: usa `useMessageTemplates` de `@/modules/communication` (`message_templates` table — command-based templates de mensagem, scope `/m/` no chat). Zero referência a `useCampaignTemplates`. Decisão final em slice 14 (platform).
- **`src/lib/template-variables.ts`** → **NÃO migrado**. Cross-cutting (usado por communication + workflows + campaigns). Permanece em `src/lib/` até slice 14/16.
- **`src/lib/leadsImportTemplate.ts`** + **`upsellImportTemplate.ts`** → **NÃO migrado**. Não relacionados a campaign templates — são utilities de planilhas CSV de import (leads + upsell).
- **`useDispatchQueueItems.ts`** → **MIGRADO** (decisão de inclusão). Cross-module (pipelines + campaigns) mas a entidade `outbound_dispatches` é semanticamente "dispatch of campaign-style sequence". Exposto na API pública — `pipelines/components/shared/PipeDispatchRulesSection.tsx` importa de `@/modules/campaigns`.

## Arquivos tocados (resumo)

- `src/modules/campaigns/{components,hooks,pages,lib,index.ts,CLAUDE.md}` — populados via 27 renames (`git mv`)
- `src/App.tsx` — 2 imports campanhas reescritos (lazy)
- `src/components/campanhas/` — removido (vazio)
- `src/pages/campaigns/` — removido (vazio)
- 4 hooks soltos `src/hooks/use{Campanhas,CampaignTemplates,MassSendJobs,DispatchQueueItems}` — removidos (movidos)
- `src/pages/Campanhas.tsx`, `src/pages/CampanhaDetail.tsx`, `src/pages/campaigns/MassSend.tsx` — removidos (movidos)
- 9 arquivos cross-module com imports atualizados:
  - `src/components/shared/DispatchQueueSheet.tsx`
  - `src/modules/communication/hooks/useWhatsAppChat.ts` (barrel — re-exporta via API pública agora)
  - `src/modules/leads/components/lead/create/LeadCreateForm.tsx`
  - `src/modules/leads/hooks/lead/useLeadCampaignsAttach.ts`
  - `src/modules/pipelines/components/shared/PipeDispatchRulesSection.tsx`
  - `src/modules/workflows/components/sidebar-panels/{ActionPanel,CampaignSelectorField,CampaignStageSelectorField,CampaignTemplateSelectorField,TriggerPanel}.tsx`
- 23 arquivos internos do próprio módulo (auto-imports entre components/pages do módulo)
- 9 testes em `tests/unit/` com paths atualizados (mocks `vi.mock("@/hooks/use*", ...)` agora apontam pro módulo)
- `scripts/codemod-slice9.mjs` — script de codemod (utility, pode ser preservado)

## Decisões

- **Backend (6 edge functions + `_shared/campaign-distribution.ts`) fora deste slice** — vão para slices 15/16 conforme planejamento original
- **`triggerStageChangedWorkflows` chamado dentro de `useCampanhas.useExtractLeadToPipe` — NÃO consolidado** — parte do bug doc `08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md`. Fix em slice 19 event-bus
- **Pages NÃO em index.ts** — padrão dos slices 4-8 (App.tsx faz deep-import via React.lazy)
- **Stacking sobre slice 8** (não esperar merge) — convenção da feature em andamento
- **MassSend.tsx órfã preservada** — `src/pages/campaigns/MassSend.tsx` não está routed em App.tsx atualmente (descoberto durante migração). Mantida em `@/modules/campaigns/pages/MassSend.tsx` para futura roteamento — alternativa de deletar rejeitada (engenheiro não deleta código sem brief explícito)
- **`useUpsellCampanhas`, `useOutboundMetrics`, `MessageTemplates.tsx` mantidos fora de campaigns** — análise acima
- **`useMassSendJobs` re-exportado por communication via API pública (`@/modules/campaigns`)** — alinha com convenção de cross-module via barrel; comunicação anterior fazia deep-import durante slice 6, agora corrigido

## QA literal

```
TypeScript:  npx tsc --noEmit       →  EXIT=0 (verde)
ESLint:      npm run lint           →  0 errors, 2448 warnings (= baseline slice 8)
Build:       npm run build          →  ✓ verde (PWA injectManifest, precache 279 entries, ~7890 KiB)
Unit tests:  npm run test:unit      →  47 failed | 3891 passed | 150 skipped (4088 total)
             baseline pré-slice 8 (memória CI baseline red)  →  47 failed | 3891 passed | 150 skipped
             slice 8 fechou em                                 →  46 failed | 3892 passed | 150 skipped
             slice 9 fechou em                                 →  47 failed | 3891 passed | 150 skipped
             diff: 1 teste flaky (timing/mock-init) flipou desde slice 8 — inspeção manual confirma sem relação com campaigns
Tests campaign-related em isolado:
  npx vitest run tests/unit/use-campanhas.test.ts \
                 tests/unit/hooks-batch-{4,6,7}.test.ts \
                 tests/unit/hooks-sprint2-campaign-templates.test.ts \
                 tests/unit/mass-send.test.tsx \
                 tests/unit/hooks-types-batch.test.ts
  →  187 passed | 0 failed (7 files, 0 regressões)
```

Falhas pré-existentes (não causadas por slice 9 — superset do baseline slice 8): `agent-message-batch`, `copilot/{cancellation,knowledge-retriever}`, `copilot-rag-tuning`, `copilot-tool-registry`, `cors`, `evolution-api`, `history-sync`, `hooks-batch-8-channel-chat`, `hooks-deep-1`, `hooks-final-{agents,instances,zero}`, `InstanceOwnerModal`, `lead-detail-mobile-tabs`, `link-lead-dialog`, `mobile-bottom-nav`, `pix-charge-flow`, `pricing-calculator`, `protected-route`, `refactor-smoke`, `revision-item`, `shared-action-handler-{compat,update-lead}`, `shared-auth`, `shared-batch-1`, `shared-meta-api-branches`, `shared-tinyerp-crypto`, `time-context`, `uazapi-provider`, `use-push-subscription`, `useRealtimeFallback`, `useTVDashboardData-funnel`, `whatsapp`, `whatsapp-messages-idempotency-contract`, `workflow-trigger-branches`.

## Smoke test pós-merge (CTO rodar)

1. `/campanhas` lista campanhas (PermissionProtectedRoute `campaigns.view`)
2. Criar campanha nova (Wizard: objetivo → semi/auto → agente → templates → kanban)
3. Abrir detalhe (`/campanhas/:id`) — Kanban + Analytics + Dispatch + Members + Viewers + Stages carregam
4. Adicionar lead na campanha (AddLeadToCampanhaModal)
5. Importar leads via CSV (ImportLeadsModal)
6. Mover lead entre stages do Kanban — webhook `campaign-rule-dispatch` dispara
7. Configurar dispatch rule + steps (CampanhaDispatchRulesSection) — sequence trigger + step types
8. Extract lead → pipe (ExtractToPipeModal) — `useExtractLeadToPipe` move pra pipe destino
9. Editar campanha (EditCampanhaModal) — investimento, MKT config
10. Manage stages (ManageStagesModal) — add/edit/delete/reorder
11. Viewers (CampanhaViewersSection) — add/remove
12. Pipe automations (CampanhaPipeAutomationsSection) — campanha → pipe destino
13. Templates (CreateTemplateModal + AddTemplateToCampanha) — variáveis `{{lead.name}}` resolvem no preview
14. Dispatch queue (CampanhaDisparosTab) — `useCampaignQueueItems` + retry
15. Campaign analytics tab (CampanhaAnalytics) — funil + métricas
16. CampaignEndModal — encerrar campanha
17. Mass send: instanciar manualmente (rota órfã hoje — apenas verificar build de `@/modules/campaigns/pages/MassSend` carrega)
18. Workflows com triggers de campanha (CampaignSelectorField, CampaignStageSelectorField, CampaignTemplateSelectorField) — sidebar de workflow lista campaigns
19. Pipeline DispatchQueueSheet (`useCampaignQueueItems` em pipelines) — cross-module via API pública funciona

## Follow-ups

- **Slice 10 (carteira)**: mover `useUpsellCampanhas` pra `src/modules/carteira/hooks/` junto com `components/upsell/`
- **Slice 12 (analytics)**: mover `useOutboundMetrics` pra `src/modules/analytics/hooks/`
- **Slice 14 (platform)**: decidir destino final de `MessageTemplates.tsx` + `useMessageTemplates` re-export
- **Slice 15**: 6 edge functions campaigns — `campaign-rule-dispatch`, `process-outbound-dispatches`, `outbound-trigger`, `mass-send-create`, `mass-send-status`, `mass-send-control`
- **Slice 16**: `_shared/campaign-distribution.ts` (auditar pra mover pra `_shared/campaigns/`). Considerar mover tipos `Campanha*` pra dentro do módulo (hoje moram em `hooks/useCampanhas.ts`)
- **Slice 17 (boundaries flip)**: warn-only → error nos cross-imports
- **Slice 19 (event-bus piloto)**: emitir `campaign.dispatched`, `campaign.completed`, `mass_send.completed`. Fix `triggerStageChangedWorkflows` chamado em 3 lugares (bug doc) — `useExtractLeadToPipe` é um deles
- **`MassSend.tsx` órfã** — decidir routing (Configurações? Operações? sub-rota de Campanhas?) ou deletar

## Refs

- Branch: `feat/modularizacao/08-campaigns` (stacked sobre `feat/modularizacao/07-workflows` @ e9401f06)
- Sub-CLAUDE.md módulo: `src/modules/campaigns/CLAUDE.md`
- Bug doc workflow-trigger: `Obsidian/.../08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md` (resolução slice 19)
- Slices tracker: `Obsidian/.../10 — Remodelagem/04-execucao/slices.md`
- Slice de referência: slice 8 workflows (commit e9401f06, changelog `2026-05-27-slice-08-workflows.md`)
