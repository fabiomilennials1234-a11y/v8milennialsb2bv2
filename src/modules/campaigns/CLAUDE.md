# Module — campaigns

**Status:** 🟢 Active (slice 9 — frontend migrado. UI Kanban de campanhas **retirada** — entidade + hooks vivos, gestão migrou pra funis com prazo (`pipelines/FunisHub`) + envio em massa em `/disparos`. Backend `_shared/campaign-distribution.ts` + edge functions `campaign-rule-dispatch`, `process-outbound-dispatches`, `outbound-trigger`, `mass-send-{create,status,control}` no slice 15/16)
**BC:** campaigns
**Entidade primária:** Campaign + Mass Send
**Owner:** marketing / vendas

## Escopo

> **UI legada do Kanban de campanhas retirada.** As páginas `Campanhas`/`CampanhaDetail` e o cluster de 17 componentes (`CampanhaCard`, `CampanhaKanban`, `CampanhaAnalytics`, `CampanhaViewersSection`, `CampanhaDisparosTab`, `CampanhaAutomaticaPanel`, `CampanhaSemiAutomaticaPanel`, `CampanhaDispatchRulesSection`, `CampanhaPipeAutomationsSection`, `CreateCampanhaModal`, `EditCampanhaModal`, `AddLeadToCampanhaModal`, `CampaignEndModal`, `CampaignTemplateSelector`, `ExtractToPipeModal`, `ImportLeadsModal`, `ManageStagesModal`) foram **deletados**. Campanhas agora são modeladas como **funis com prazo** (funis temporários) em `pipelines/FunisHub`, e o envio em massa vive em `/disparos` (`DisparosPanel`/`NovoDisparo` + Wizard Linear #904). A **entidade** Campaign + seus hooks permanecem vivos (consumidos por `workflows` + `leads` + disparos) — só a superfície de UI Kanban saiu.

> **Fatia B (Funil é Funil, D1/D4):** campanha e disparo apontam pra QUALQUER funil por `pipeline_id` + `stage_id` — o trio de sistema deixou de ser especial. `campanhas.target_pipeline_id`/`target_stage_id` (migration 20270917000000) são o destino canônico; `objective`/`free_target_pipe` viram formato LEGADO aceito na leitura pra sempre (`resolveExtractionTarget` lê id-first). O wizard de Disparos lista os funis reais da org (`usePipelines`) e resolve público via `get_pipeline_lead_ids` (motor único). `blast_plans.pipeline_id` registra o funil de origem do público; `post_send_target` persiste `{pipelineId, stageId, label}` (shapes legados aceitos na leitura).

A entidade Campaign (paralela aos pipes) ainda modela:
- Objetivo (`qualificacao`, `agendamentos`, `propostas`, `livre`) + deadline
- Agente IA (opcional — pra conversar com lead)
- Metas (volume, conversão)
- Round-robin entre membros do time (SDR/Closer)
- Sequence de mensagens (dispatch rules + steps com delay/timeout/wait_response)
- Templates pré-aprovados (com variáveis `{{lead.name}}`, `{{lead.empresa}}`, etc.)
- Stages dinâmicas + viewers (permissões granulares)
- Pipe automations (campanha → pipe destino quando lead atinge estágio)

Esses dados seguem expostos pelos hooks (`useCampanhas`, `useCampanhaStages`, `useCampaignTemplates`, …) e consumidos por `workflows`, `leads` e disparos. O que saiu foi só a UI Kanban de gestão.

Mass send: envio em massa one-shot via Uazapi `/sender/*` para lista de leads (separado de campanha contínua) — `uazapi_sender_jobs`. UI canônica em `/disparos`.

Dispatch queue: fila de itens disparados (por campanha ou pipe) com retry — `outbound_dispatches`.

## Não-escopo

- Lead enrichment → `leads`
- Workflow disparado por campanha (stage_changed → workflow) → `workflows`
- Mensagem em si (delegate ao MessageSender) → `communication`
- Landing page de captura → `marketing`
- Carteira upsell campanhas (`upsell_campanhas`) — domínio carteira → `carteira` (slice 10)
- Message templates platform-wide (`message_templates` table, command-based) → `communication`

## Estrutura

```
src/modules/campaigns/
├── components/                    # Components do domínio (disparo + selectors). Cluster Kanban legado deletado.
│   ├── AgentSelectorStep.tsx
│   ├── BlastPlanCard.tsx
│   ├── CreateTemplateModal.tsx
│   ├── TemplateSelectorStep.tsx
│   └── disparo-wizard/            # Wizard Linear (#904): shell + 6 passos (Pra quem · Mensagem · Destino · Velocidade · Revisão · Acompanhar) + state machine pura. Passo "Destino" (postsend) = movimentação opcional pós-envio: cada lead é movido pro funil/etapa escolhidos NO MOMENTO em que a mensagem dele é enviada (por lote — blast_plans.post_send_target, validado fail-closed em blast-plan-create; move via _shared/action-handlers/move-stage.ts, best-effort)
├── hooks/
│   ├── useCampanhas.ts            # CRUD + stages + members + leads + viewers + pipe automations + dispatch rules
│   ├── useCampaignTemplates.ts    # Templates + dispatch batches + logs + stats
│   ├── useMassSendJobs.ts         # Uazapi /sender/* one-shot mass send
│   ├── useBlastPlans.ts           # Blast Plans auto-batched (ADR-0003 / #707)
│   ├── useDispatchQueueItems.ts   # Outbound dispatch queue (cross-module: campaigns + pipelines)
│   ├── useAudienceResolve.ts      # Resolução de audiência do disparo (#904)
│   └── useDisparoPlanilhaCreate.ts # Criação de disparo por planilha (#904)
├── pages/                         # Páginas Campanhas/CampanhaDetail (Kanban) deletadas — UI = funis com prazo + /disparos
│   ├── DisparosPanel.tsx          # /disparos — porta canônica (empty guiado + histórico) #904
│   └── NovoDisparo.tsx            # /disparos/novo — wrapper do Wizard Linear #904
├── lib/
│   ├── blast-planning.ts          # Twin frontend do core puro Deno (planBlast/nextValidSendTime) #904
│   ├── blast-recipient-view.ts    # Rótulos por estado do destinatário (skip/falha/não confirmada)
│   └── blast-delivery-summary.ts  # Resumo do Disparo: 6 estados + custo previsto/realizado #1724
├── index.ts                       # API pública
└── CLAUDE.md                      # este arquivo
```

## API pública (`index.ts`)

### Hooks

- **Campanha CRUD**: `useCampanhas`, `useCampanha`, `useCreateCampanha`, `useUpdateCampanha`, `useDeleteCampanha`, `useUpdateCampanhaInvestimento`, `useUpdateCampanhaMktConfig`
- **Stages**: `useCampanhaStages`, `useAllCampanhaStages`, `useCreateCampanhaStage`, `useUpdateCampanhaStage`, `useDeleteCampanhaStage`, `useReorderCampanhaStages`
- **Members**: `useCampanhaMembers`, `useUpdateCampanhaMember`
- **Leads**: `useCampanhaLeads`, `useAddCampanhaLead`, `useUpdateCampanhaLead`, `useDeleteCampanhaLead`
- **Viewers**: `useCampanhaViewers`, `useAddCampanhaViewer`, `useRemoveCampanhaViewer`
- **Pipe automations**: `useCampanhaPipeAutomations`, `useCreateCampanhaPipeAutomation`, `useDeleteCampanhaPipeAutomation`
- **Dispatch rules**: `useCampanhaDispatchRules`, `useCampanhaDispatchRuleSteps`, `useCreate/Update/DeleteCampanhaDispatchRule`, `useCreate/Update/DeleteCampanhaDispatchRuleStep`
- **Extract**: `useExtractLeadToPipe`, `resolveExtractionTarget`
- **Constants/helpers**: `OBJECTIVE_TARGET_MAP`, `OBJECTIVE_LABELS`, `OBJECTIVE_DESCRIPTIONS`, `OBJECTIVE_METRIC_LABELS`, `OBJECTIVE_SUCCESS_STAGE_LABELS`, `OBJECTIVE_DEFAULT_STAGES`, `getObjectiveMetricLabel`, `getObjectiveSuccessStageLabel`
- **Templates**: `useCampaignTemplates`, `useCampaignTemplatesByType`, `useCampaignTemplate`, `useCreate/Update/DeleteCampaignTemplate`, `useCampanhaTemplates`, `useAddTemplateToCampanha`, `useRemoveTemplateFromCampanha`, `TEMPLATE_VARIABLES`, `getTimeBasedVariables`, `replaceVariablesWithExamples`, `replaceVariablesWithLeadData`
- **Dispatch batches**: `useDispatchBatches`, `useCreateDispatchBatch`, `useCancelDispatchBatch`, `useDispatchLog`, `useDispatchStats`
- **Mass Send (Uazapi)**: `useMassSendJobs`, `useCreateMassSend`, `useControlMassSend`, `useRefreshMassSendStatus`
- **Dispatch queue** (consumido por `pipelines`): `useCampaignQueueItems`, `usePipeQueueItems`, `useRetryDispatchItems`

### Components

Internals (não re-exportados — usados apenas via Pages do próprio módulo, `DisparosPanel`/`NovoDisparo` e o `disparo-wizard`).

### Pages

NÃO re-exportadas — App.tsx faz deep-import via React.lazy:
- `@/modules/campaigns/pages/DisparosPanel` (rota `/disparos` — porta canônica #904)
- `@/modules/campaigns/pages/NovoDisparo` (rota `/disparos/novo` — Wizard Linear #904)

> `Campanhas`/`CampanhaDetail` (Kanban de campanhas) foram deletadas — a gestão de campanha migrou pra funis com prazo em `pipelines/FunisHub`.

### Types

Re-exportados via index.ts: `CampaignObjective`, `TargetPipe`, `CampaignType`, `AutoConfig`, `LeadDistributionMode`, `Campanha`, `CampanhaStage`, `CampanhaMemberRole`, `CampanhaMember`, `CampanhaLead`, `CampanhaInsert`, `CampanhaStageInsert`, `CampanhaPipeAutomationTarget`, `CampanhaPipeAutomation`, `CampanhaDispatchRuleTriggerType`, `CampanhaDispatchRuleStepActionType`, `CampanhaDispatchRuleTimeoutAction`, `SdrAssignmentMode`, `CampanhaDispatchRule`, `CampanhaDispatchRuleStep`, `CampanhaViewer`, `ExtractLeadToPipeTarget`, `CampaignTemplateMessageType`, `CampaignTemplate`, `CampaignTemplateInsert`, `CampanhaTemplate`, `DispatchBatch`, `LeadFilter`, `DispatchBatchInsert`, `UazapiSenderJob`, `QueueItem`.

### Eventos (post slice 19)

`campaign.created`, `campaign.dispatched`, `campaign.completed`, `mass_send.completed`

## Áreas frágeis

🟠 **Mass send + Uazapi rate limit.** Não pode estourar limites da instance — backend `mass-send-create` calcula delays. Frontend apenas dispara request — não tocar nesta slice (edge functions slice 15).

- **Sequence de mensagens com delays/timeouts** — workflow-like, mas próprio do domínio. Trigger types: `lead_created`, `lead_moved_to_stage`. Step actions: `send_template`, `wait_response`, `change_stage`, `assign_sdr`, `cancel_sequence`. Timeout actions: `continue`, `change_stage`, `send_template`, `cancel_sequence`.
- **Mass send + rate limit** — `uazapi_sender_jobs` tem progresso/status assíncrono. Realtime atualiza UI. `useRefreshMassSendStatus` força sync.
- **Templates com variáveis** — `{{lead.name}}`, `{{lead.empresa}}`, `{{lead.phone}}`, `{{saudacao}}`, `{{data}}`, `{{hora}}` — resolução em `replaceVariablesWithLeadData`.
- **Dispatch queue** (`outbound_dispatches`) — compartilhado com `pipelines` (PipeDispatchRulesSection usa `usePipeQueueItems`). Cross-module via API pública.
- **Stage change fan-out** — `useUpdateCampanhaLead` publica `lead.stage_changed` via `publishEvent` (event-bus). Workflows consumem via handler central `_shared/events/handlers/lead-stage-changed.ts`. Migrado em slice 19 + fase 4 deletou função legacy.

## Dependências cross-module

- `@/modules/identity` — `useOrganization`, `useAuth`, `useCanDo`, `assertPermission`
- `@/modules/workflows` — `triggerFollowUpAutomation` (server-side)
- `@/hooks/useRealtimeSubscription` — transport infra (cross-cutting)
- `@/integrations/supabase/events` — `publishEvent` (event-bus, substitui legacy `triggerStageChangedWorkflows` deletado em fase 4)
- `@/integrations/supabase/client`, `@/integrations/supabase/types`

### Consumidores cross-module (importam de `@/modules/campaigns`)

- `@/modules/communication` — re-exporta `useMassSend*` no barrel `useWhatsAppChat` (uazapi `/sender/*` é transport)
- `@/modules/pipelines` — `usePipeQueueItems`, `useRetryDispatchItems` (dispatch queue compartilhada)
- `@/modules/leads` — `useLeads` precisa de `Campanha`/`CampanhaLead` types (lead-campaign attach)
- `@/modules/workflows` — `useCampanhas` (CampaignSelectorField, CampaignStageSelectorField, CampaignTemplateSelectorField, TriggerPanel, ActionPanel)
- `@/components/shared/DispatchQueueSheet` — `useCampaignQueueItems` (UI shared)

## Origem (slice 9 — frontend migrado em 2026-05-27)

Frontend (✅ migrado pra cá):
- ~~`src/components/campanhas/`~~ (20 files) → `./components/` (17 do cluster Kanban depois **deletados** ao retirar a UI de campanhas; sobraram os selectors de disparo)
- ~~`src/hooks/useCampanhas.ts`~~ → `./hooks/useCampanhas.ts`
- ~~`src/hooks/useCampaignTemplates.ts`~~ → `./hooks/useCampaignTemplates.ts`
- ~~`src/hooks/useMassSendJobs.ts`~~ → `./hooks/useMassSendJobs.ts`
- ~~`src/hooks/useDispatchQueueItems.ts`~~ → `./hooks/useDispatchQueueItems.ts`
- ~~`src/pages/Campanhas.tsx`~~ → ~~`./pages/Campanhas.tsx`~~ **deletada** (UI Kanban de campanhas retirada — gestão migrou pra funis com prazo em `pipelines/FunisHub`). Entidade Campaign + hooks `useCampanhas`/`useCampanhaStages`/… seguem vivos.
- ~~`src/pages/CampanhaDetail.tsx`~~ → ~~`./pages/CampanhaDetail.tsx`~~ **deletada** (idem — junto com o cluster de 17 componentes Kanban: `CampanhaKanban`, `CampanhaAnalytics`, `CreateCampanhaModal`, … ).
- ~~`src/pages/campaigns/MassSend.tsx`~~ → ~~`./pages/MassSend.tsx`~~ **deletada** (#904 — órfã sem rota, substituída pela porta `/disparos`). Hooks `useMassSendJobs`/`useCreateMassSend`/`useControlMassSend`/`useRefreshMassSendStatus` seguem vivos (Quick Blast / Disparos).

Backend (próximas slices):
- `supabase/functions/campaign-rule-dispatch/` (slice 15)
- `supabase/functions/process-outbound-dispatches/` (slice 15)
- `supabase/functions/outbound-trigger/` (slice 15)
- `supabase/functions/mass-send-create/` (slice 15)
- `supabase/functions/mass-send-status/` (slice 15)
- `supabase/functions/mass-send-control/` (slice 15)
- `supabase/functions/_shared/campaign-distribution.ts` (slice 16)

## Decisão — hooks adjacentes não migrados

- **`useUpsellCampanhas.ts`** → **NÃO migrado**. Entidade `upsell_campanhas` pertence ao domínio `carteira` (upsell pós-venda), não a campaigns. Consumido exclusivamente por `src/components/upsell/` (que migra pra carteira em slice 10). Mover agora criaria cross-module desnecessário pré-slice 10.
- **`useOutboundMetrics.ts`** → **NÃO migrado**. Métricas agregadas do dashboard outbound — domínio `analytics` (slice 12). Consumido pelo `DashboardOutbound.tsx` + `OutboundMetricCards.tsx`.
- **`useChecklistTemplates.ts`** → **NÃO migrado**. Domínio `engagement` (checklists), não campaign templates.
- **`useOnboardingTemplates.ts`** → **NÃO migrado**. Domínio `platform` (onboarding).
- **`src/pages/MessageTemplates.tsx`** → **NÃO migrado**. Cross-cutting platform feature: usa `useMessageTemplates` de `@/modules/communication` (`message_templates` table — command-based templates de mensagem). Slice 14 (platform) decide destino final.
- **`src/lib/template-variables.ts`** → **NÃO migrado**. Cross-cutting (usado por communication + campaigns + workflows). Permanece em `src/lib/` até slice 14/16.
- **`src/lib/leadsImportTemplate.ts`** + **`upsellImportTemplate.ts`** → **NÃO migrado**. Não relacionados a campaigns templates — são planilhas CSV de import (leads + upsell).

## Slice de migração

**Slice 9** — `feat/modularizacao/08-campaigns` — completado 2026-05-27. 28 renames (20 components + 4 hooks + 3 pages + 1 codemod script) + 41 arquivos com imports atualizados (67 substituições).

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Slice de referência: slice 8 workflows (commit e9401f06, changelog `2026-05-27-slice-08-workflows.md`)
- Event-bus piloto: `Obsidian/.../10 — Remodelagem/02-solucao/event-bus.md` (resolução slice 19 + dead code removido em fase 4)
