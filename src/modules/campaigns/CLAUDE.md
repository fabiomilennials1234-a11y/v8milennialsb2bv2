# Module — campaigns

**Status:** 🟢 Active (slice 9 — frontend completo. Backend `_shared/campaign-distribution.ts` + edge functions `campaign-rule-dispatch`, `process-outbound-dispatches`, `outbound-trigger`, `mass-send-{create,status,control}` no slice 15/16)
**BC:** campaigns
**Entidade primária:** Campaign + Mass Send
**Owner:** marketing / vendas

## Escopo

Campanhas paralelas aos pipes. Cada campanha:
- Objetivo (`qualificacao`, `agendamentos`, `propostas`, `livre`) + deadline
- Agente IA (opcional — pra conversar com lead)
- Metas (volume, conversão)
- Round-robin entre membros do time (SDR/Closer)
- Sequence de mensagens (dispatch rules + steps com delay/timeout/wait_response)
- Templates pré-aprovados (com variáveis `{{lead.name}}`, `{{lead.empresa}}`, etc.)
- Stages dinâmicas (Kanban) + viewers (permissões granulares)
- Pipe automations (campanha → pipe destino quando lead atinge estágio)

Mass send: envio em massa one-shot via Uazapi `/sender/*` para lista de leads (separado de campanha contínua) — `uazapi_sender_jobs`.

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
├── components/                    # 20 components do domínio
│   ├── AddLeadToCampanhaModal.tsx
│   ├── AgentSelectorStep.tsx
│   ├── CampaignEndModal.tsx
│   ├── CampaignTemplateSelector.tsx
│   ├── CampanhaAnalytics.tsx
│   ├── CampanhaAutomaticaPanel.tsx
│   ├── CampanhaCard.tsx
│   ├── CampanhaDisparosTab.tsx
│   ├── CampanhaDispatchRulesSection.tsx
│   ├── CampanhaKanban.tsx
│   ├── CampanhaPipeAutomationsSection.tsx
│   ├── CampanhaSemiAutomaticaPanel.tsx
│   ├── CampanhaViewersSection.tsx
│   ├── CreateCampanhaModal.tsx
│   ├── CreateTemplateModal.tsx
│   ├── EditCampanhaModal.tsx
│   ├── ExtractToPipeModal.tsx
│   ├── ImportLeadsModal.tsx
│   ├── ManageStagesModal.tsx
│   └── TemplateSelectorStep.tsx
├── hooks/
│   ├── useCampanhas.ts            # CRUD + stages + members + leads + viewers + pipe automations + dispatch rules
│   ├── useCampaignTemplates.ts    # Templates + dispatch batches + logs + stats
│   ├── useMassSendJobs.ts         # Uazapi /sender/* one-shot mass send
│   └── useDispatchQueueItems.ts   # Outbound dispatch queue (cross-module: campaigns + pipelines)
├── pages/
│   ├── Campanhas.tsx              # Lista de campanhas
│   ├── CampanhaDetail.tsx         # Detalhe (Kanban + analytics + dispatch + viewers + stages)
│   └── MassSend.tsx               # UI de mass send (não roteada atualmente — órfã, mantida pra futuro)
├── lib/                           # vazio — utils internos quando necessário
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

Internals (não re-exportados — usados apenas via Pages do próprio módulo e dentro de `Campanhas`/`CampanhaDetail`).

### Pages

NÃO re-exportadas — App.tsx faz deep-import via React.lazy:
- `@/modules/campaigns/pages/Campanhas`
- `@/modules/campaigns/pages/CampanhaDetail`
- `@/modules/campaigns/pages/MassSend` (órfã — não roteada hoje, preservada)

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
- ~~`src/components/campanhas/`~~ (20 files) → `./components/`
- ~~`src/hooks/useCampanhas.ts`~~ → `./hooks/useCampanhas.ts`
- ~~`src/hooks/useCampaignTemplates.ts`~~ → `./hooks/useCampaignTemplates.ts`
- ~~`src/hooks/useMassSendJobs.ts`~~ → `./hooks/useMassSendJobs.ts`
- ~~`src/hooks/useDispatchQueueItems.ts`~~ → `./hooks/useDispatchQueueItems.ts`
- ~~`src/pages/Campanhas.tsx`~~ → `./pages/Campanhas.tsx`
- ~~`src/pages/CampanhaDetail.tsx`~~ → `./pages/CampanhaDetail.tsx`
- ~~`src/pages/campaigns/MassSend.tsx`~~ → `./pages/MassSend.tsx`

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
