---
type: reference
title: Modularização — Auditoria de Duplicatas
status: active
created: 2026-05-26
updated: 2026-05-26
tags: [modularizacao, auditoria, duplicatas]
related:
  - "[[ADR-2026-05-26-modularizacao-monolito-modular]]"
  - "[[event-bus-plano]]"
owner: gabriel
---

# Modularização — Auditoria de Duplicatas

**Created:** 2026-05-26
**Owner:** arquiteto
**Status:** Diagnóstico (input pra slices de dedup do SPEC)
**SPEC:** [`.specs/features/modularizacao/SPEC.md`](../../../../../.specs/features/modularizacao/SPEC.md)

Pré-requisito da modularização: dedupe ANTES de mover. Mover hook duplicado pra módulo perpetua o problema.

Números atuais:
- **223** hooks `.ts` em `src/hooks/` (.test.ts contam)
- **97** edge functions em `supabase/functions/<nome>/`
- **62** subpastas/arquivos em `src/components/`
- **63** módulos em `supabase/functions/_shared/`
- **47** pages no root `src/pages/`

---

## 1. Hooks — duplicatas críticas

### 1.1 Histórico/timeline/changelog do lead (4 hooks, 3 fontes)

| Hook | Fonte | Status |
|------|-------|--------|
| `useLeadHistory` | `lead_history` table | Legacy |
| `useLeadTimeline` | RPC paginada por filtros (manual/agent/automation/system) | Nova |
| `useFieldChangelog` | (sem queryFn — só `FIELD_LABELS`) | Órfão funcional |
| `useFieldChanges` | RPC `get_lead_field_changes` | Ativo |

Componentes consumidores espalhados: `ActivityFeed`, `TimelineItem`, `LeadDetailTimeline`, `LeadDetailNotes`, `LeadStageHistory`, `LeadTabHistory`, `ContextPanelHistory`, `FieldChangelogTimeline`, `ClientDetailModal`, ~~`ProposalDetailModal`~~ (deletado 2026-07-02), `ConfirmacaoDetailModal` (~10).

**Recomendação:** consolidar em `useLeadTimeline` (mais rico). Migrar `useLeadHistory` → emitir como source `manual/system` do timeline. `useFieldChangelog` → mover `FIELD_LABELS` pra `shared/format/`, deletar hook. `useFieldChanges` → renomear pra `useLeadFieldChanges`, mantém RPC mas vira sub-query do timeline.

### 1.2 Copilot toggle (3 hooks)

- `useCopilotToggle.ts`
- `useCopilotToggleAudit.ts`
- `useCopilotToggleRealtime.ts`

**Recomendação:** single `useCopilotToggle({ withAudit?, withRealtime? })`. Ou compõe: `useCopilotToggle` base + `useCopilotToggleAudit` decorator. Audit + Realtime são side-effects sobre 1 estado.

### 1.3 Realtime (3 hooks)

- `useRealtimeChannel.ts`
- `useRealtimeChannelStatus.ts`
- `useRealtimeSubscription.ts`

CLAUDE.md raiz já documenta `useRealtimeSubscription` como API canônica. Outros 2 são plumbing interno — devem ir pra `core/realtime/` (não exportados).

### 1.4 Form save (3 padrões)

- `useAutoSaveField.ts`
- `useExplicitSaveForm.ts`
- `useOptimisticConflictHandler.ts`

3 estratégias diferentes coexistem. Decisão: qual é o padrão? Hipótese: AutoSave pra inline edit, ExplicitSave pra modais. ConflictHandler usado por ambos? **Bloqueador:** definir convenção antes de modularizar.

### 1.5 Order/Deal/Approval (sobreposição)

- `useDeals` + `useDealItems`
- `useNewOrder` + `useQuickOrder` + `useOrderApproval`
- `useApprovals` + `useUpsellOrders` + `useJobOfferApprovals` (?)

Esclarecer: Deal ≠ Order? Ou Order é instância concreta do Deal? CONTEXT.md lista "Order" — Deal não aparece. Suspeita: `useDeals*` é UI legacy de pre-pipeline.

### 1.6 Master admin (6 hooks)

`useMasterAuditLogs`, `useMasterAuth`, `useMasterOperations`, `useMasterOrganizations`, `useMasterPlans`, `useMasterUsers` — coesos, viram módulo `identity/master/`.

### 1.7 Analytics (8 hooks)

`useAnalytics` + `useAnalyticsComercial` + `useAnalyticsEngajamento` + `useAnalyticsFilters` + `useAnalyticsFinanceiro` + `useAnalyticsOverview` + `useAnalyticsPipesFunis` + `useAnalyticsUtms`.

Padrão consistente — não é duplicata, é decomposição saudável. Move bloco pra `modules/analytics/hooks/`.

### 1.8 Pipe legacy vs Pipeline (16 hooks misturando 2 modelos)

| Modelo legacy (views `pipe_*`) | Modelo novo (`pipeline_entries`) |
|--------------------------------|-----------------------------------|
| `usePipeConfirmacao` | `usePipelineEntries` |
| `usePipeConfirmacaoByLeadId` | `usePipelines` |
| `usePipePropostaByLeadId` | `usePipelineStages` |
| `usePipePropostaItems` | `usePipelineDisplayConfig` |
| `usePipePropostas` | `useCustomPipelines` |
| `usePipeWhatsapp` | `useCustomPipelineMembers` |
| `usePipeDispatchRules` | |
| `usePipeDistribution` | |
| `usePipeMetrics` | |
| `usePrefetchPipes` | |

Memory `reference_pipe_views_compat.md` confirma: pipe_* são views de compat. **Decisão:** modularização NÃO faz unificação modelo (out-of-scope), mas slice 04-pipelines deve isolar todos os 16 em `modules/pipelines/`. Cleanup futuro = projeto separado.

### 1.9 Hooks WhatsApp instance/write (5)

`useLeadWriteInstance`, `usePreferredInstance`, `useUserWriteInstanceFlag`, `useWhatsAppInstanceAllowedMembers`, `useOrgWhatsAppMigration`.

Misturam 3 camadas: instance resolution (qual instância usar pra mandar), allowlist (quem pode mandar), migration flag (Evolution→Uazapi). **Recomendação:** namespace `modules/communication/instance/`. Avaliar inline de `useUserWriteInstanceFlag` (1 caller?).

### 1.10 ChatBubble (2)

`useChatBubble` + `useChatBubbleState`. Provavelmente 1 hook + 1 selector. Auditar: se state é trivial → merge.

### 1.11 Outros suspeitos (validar)

- `useAvatarMap` — único caller? Inline.
- `useCountUp`, `useDebounce`, `usePersistedState`, `useViewport`, `useOnlineStatus`, `useKeyboardShortcuts`, `useGlobalShortcuts` → `shared/hooks/` (cross-cutting, não-domínio).
- `useLogger` (frontend) vs `_shared/logger.ts` (edge) — naming inconsistente mas escopos distintos, mantém.

---

## 2. Components — duplicatas críticas

### 2.1 Lead — 3 pastas

```
src/components/lead/         # lead-card, pipe, tabs, modal — domínio principal
src/components/lead-detail/  # modal-redesign novo (ADR-2026-05-17)
src/components/leads/        # LeadModal.tsx (884 linhas), TimelineItem, FieldChangelogTimeline
```

`lead-detail/LeadDetailContent.tsx` já é stub re-export de `lead/LeadDetailContent.tsx` (legado de redesign). Resto não.

**Recomendação:** consolidar em `modules/leads/components/`. Estrutura interna por subsistema (`card/`, `modal/`, `timeline/`, `tabs/`).

### 2.2 Pipeline — 6 pastas

```
pipelines/        custom-pipelines/   pipe-propostas/
kanban/           confirmacao/        funis/
```

**Mapa:**
- `pipelines/` — CRUD genérico
- `kanban/` — visualização
- `custom-pipelines/` — UI de configuração de pipelines customizados
- `pipe-propostas/` — UI de stage específico (legado)
- `confirmacao/` — UI de stage confirmação (legado)
- `funis/` — Hub geral (page `FunisHub.tsx`)

**Recomendação:** consolidar em `modules/pipelines/components/{kanban,custom,legacy}`. `funis/` vira `modules/pipelines/components/hub/`.

### 2.3 Chat — 2 pastas justificadas

`chat/` (WhatsApp) e `chat-meta/` (Messenger+Instagram) são canais diferentes. **NÃO consolidar** em 1 pasta — manter em `modules/communication/{whatsapp,meta}/`. Mas ambos compartilham primitives (bubble, composer, context-panel) — extrair pra `modules/communication/shared/`.

### 2.4 Campanhas (não há `campaigns/` em components, só em pages)

`src/components/campanhas/` único. Em `src/pages/` há `Campanhas.tsx` + `CampanhaDetail.tsx` + pasta `campaigns/`. SPEC errou ao listar `campanhas/`+`campaigns/` como duplicatas em components — em pages sim, components não. Corrigir.

### 2.5 Dashboard — 3 pastas

`dashboard/`, `dashboard-outbound/`, `tv/`. Mais `performance/`, `analytics/`, `revisao/`. **Recomendação:** `modules/analytics/components/{dashboard,tv,outbound,performance,revisao}/`.

### 2.6 Carteira/Upsell/Proposals/Deals — 4 pastas mesmo BC

CONTEXT.md agrupa em "carteira". **Recomendação:** `modules/carteira/components/{client,upsell,proposal,deal}/`.

### 2.7 Engagement — 5 pastas

`agenda/`, `activities/`, `followups/`, `checklists/`, `calls/`. Mais `gamification/`, `badges/`, `ranking/`. CONTEXT.md tem "engagement" como BC. **Recomendação:** `modules/engagement/components/`.

### 2.8 Pages órfãs/legacy

- `MockupChat.tsx` + `MockupChatV2.tsx` + `MockupChatV3.tsx` + `MockupChatV3 2.tsx` (último tem espaço no nome = file corrupto de copy-paste). Verificar router; deletar se não roteados.
- `Negocios.tsx` vs `PipePropostas.tsx` vs `Deals` — qual é o ativo?
- `Premiacoes.tsx` vs `Comissoes.tsx` — payouts vs comissões (provavelmente OK distintos). **Resolvido 2026-07-02:** `Premiacoes.tsx` (+ `Ranking`/`Metas`/`GestaoMetas` v1) deletadas — órfãs sem rota; `Comissoes.tsx` vive.

---

## 3. Edge functions — duplicatas críticas

### 3.1 Webhooks inbound (8 functions ambíguas)

| Function | Purpose | Sobreposição |
|----------|---------|--------------|
| `lead-webhook` | Inbound lead externo (n8n, Meta Ads) | — |
| `webhook-new-lead` | **(?)** | Provável duplicata `lead-webhook` |
| `meta-webhook` | Meta inbound (FB/IG msgs) | — |
| `whatsapp-webhook` | Uazapi inbound | — |
| `webhook-calcom` | Calcom event | — |
| `meeting-webhook` | **(?)** | Provável duplicata `webhook-calcom` |
| `webhook-confirmacao` | **(?)** | — |
| `webhook-orchestrator` | Router central (?) | Se ativo, outros viram subroutas |
| `webhook-send-test` | Teste de webhook do usuário | ~~DELETAR~~ **VIVO** — usado por `WebhookSettings.tsx:197` (auditoria corrigida 2026-07-02) |
| `webhook-validate-url` | Helper validation | **DELETADA 2026-07-02** (plan-tiers-cleanup) — zero call-sites |
| `partner-webhook` | **(?)** | Auditar |
| `sz-chat-webhook` | SZ.Chat inbound | — |
| `google-calendar-webhook` | GCal push | — |
| `tinyerp-webhook` | TinyERP push | — |
| `erp-order-webhook` | **(?)** | Provável duplicata `tinyerp-webhook` |

**Recomendação:** auditoria 1-a-1 dos `webhook-*` ambíguos. Padrão final: `modules/integrations/<provider>/webhook/` para inbound de terceiros; `modules/<bc>/webhook/` pra Torque-specific (lead-webhook → `modules/leads/webhook/`).

### 3.2 Senders/dispatchers (5 functions + 6 _shared)

Edge:
- `agent-message` (Copilot turn — 🔴 área frágil)
- `send-meta-message`
- `sz-chat-send`
- `outbound-trigger`
- `semi-automatic-dispatch`

`_shared`:
- `message-gateway.ts`, `outbound-sender.ts`, `followup-sender.ts`, `audio-sender.ts`, `whatsapp-dispatch.ts`, `dispatch-router.ts`

Memory + agente confirmaram: gateway centraliza, mas outbound + followup replicam delays/chunking. **Recomendação:** unificar via `MessageSender` interface em `_shared/communication/`. Edge functions ficam thin (decidem contexto + chamam sender). Feature-flag `unified_message_gateway` já existe.

### 3.3 Process-* workers (8 functions, mesma forma)

`process-ai-actions`, `process-copilot-followups`, `process-followup-automations`, `process-outbound-dispatches`, `process-pipe-distribution`, `process-scheduled-user-messages`, `process-webhook-deliveries`, `process-workflow-executions`.

Todas são chamadas por pg_cron + auth `x-cron-secret` + processam fila de DB. **Recomendação:** manter funções separadas (paralelismo + isolamento de erro), mas extrair template `withCronWorker(handler)` em `_shared/cron/`. Reduz boilerplate de 8 cabeçalhos idênticos.

### 3.4 Copilot/Agent (12 functions)

`agent-message`, `analyze-copilot-prompt`, `copilot-batch-processor`, `evaluate-agent-conversation`, `generate-agent-examples`, `generate-business-context`, `generate-custom-instructions`, `oraculo-comercial`, `summarize-conversation`, `test-copilot-chat` (dev), `process-copilot-followups`, `process-agent-document`.

Maior cluster do codebase. `_shared/copilot/` já agrupa parcial. **Recomendação:** todas → `supabase/functions/copilot/<fn>/`. `test-copilot-chat` → deletar ou mover pra `tests/`.

### 3.5 TinyERP (8 functions)

`tinyerp-connect`, `tinyerp-disconnect`, `tinyerp-fetch-nfe`, `tinyerp-proxy`, `tinyerp-push-order`, `tinyerp-push-upsell-order`, `tinyerp-sync-products`, `tinyerp-webhook` + `erp-order-webhook`.

**Recomendação:** todas → `modules/integrations/tinyerp/`. `erp-order-webhook` confirmar se é tinyerp legacy ou outro ERP — se tinyerp, renomear; se outro, manter separado.

### 3.6 Google Calendar (6 functions)

`google-calendar-{callback,connect,disconnect,events,sharing,webhook}` — todas coesas. → `modules/integrations/google-calendar/`.

### 3.7 Identity admin (9 functions)

`admin-reset-user-password`, `assign-user-to-org`, `attach-to-org-by-pending-invite`, `create-org-user`, `list-organizations`, `list-unassigned-users`, `remove-org-member`, `save-member-permissions`, `get-member-permissions`.

→ `modules/identity/`.

### 3.8 Test/dev artifacts (3 — deletar ou mover)

`test-copilot-chat`, `test-workflow-system`, `webhook-send-test`. Mover pra `tests/edge-functions/` ou deletar se obsoletos.

### 3.9 Generate-* (5)

`generate-agent-examples`, `generate-business-context`, `generate-custom-instructions`, `generate-faq-embeddings`, `generate-faqs`. Copilot-side, todas → `copilot/`.

### 3.10 Mass-send-* (3)

`mass-send-control`, `mass-send-create`, `mass-send-status`. Coeso. → `modules/campaigns/mass-send/`.

---

## 4. `_shared/` — duplicatas + cleanup

### 4.1 Message stack (6 módulos)

`message-gateway` + `outbound-sender` + `followup-sender` + `audio-sender` + `whatsapp-dispatch` + `dispatch-router` + `natural-messaging` + `greeting-orchestrator` + `message-humanizer` + `message-sanitizer` + `message-classifier` + `send-dedup`.

Stack inteira de envio espalhada no root. **Recomendação:** `_shared/communication/{send,humanize,classify,dedup}/`.

### 4.2 WhatsApp stack (6 módulos)

`whatsapp-client.ts`, `whatsapp-dispatch.ts`, `whatsapp-media.ts`, `whatsapp-providers/`, `uazapi-client.ts`, `uazapi-types.ts`.

→ `_shared/integrations/whatsapp/`.

### 4.3 Workflow stack (7 módulos)

`workflow-executor`, `workflow-action-handler`, `workflow-condition-evaluator`, `workflow-trigger`, `workflow-trigger-dedup`, `actions/`, `action-handlers/`.

`actions/` vs `action-handlers/` — split confuso. **Auditar:** qual é qual? Provavelmente `actions/` = definições, `action-handlers/` = handlers; consolidar nomenclatura.

→ `_shared/workflows/`.

### 4.4 Auth/permission (5 módulos)

`auth.ts`, `user-auth.ts`, `permission_engine.ts`, `permission-actions.ts`, `assert-permission.ts`.

`auth.ts` vs `user-auth.ts` — naming ambíguo. **Recomendação:** consolidar em `_shared/identity/`. Auditar diff entre os 2 `auth*`.

### 4.5 Copilot pré-agrupado

`_shared/copilot/` + `copilot-batch-maturity.ts` + `ai-queue.ts` + `ai-action-executor.ts` + `bot-loop-detector.ts`. Os 4 do root deveriam estar dentro de `copilot/`.

### 4.6 Core utils (mantém no root ou move pra `_shared/core/`)

`cors.ts`, `response.ts`, `sentry.ts`, `logger.ts`, `security-headers.ts`, `supabase-admin.ts`, `validation.ts`, `edge-framework.ts`, `fetch-utils.ts`, `track.ts`. → `_shared/core/`.

### 4.7 Domain-specific (1 caller só? auditar)

- `bot-loop-detector.ts` — só copilot
- `tts-elevenlabs.ts` — só audio-sender?
- `tinyerp-utils.ts` — só tinyerp-* functions
- `meta-api.ts` — só meta-* functions
- `asaas.ts` — só asaas function (não encontrada nas 97 — órfão?)

Mover specifics pra `_shared/<bc>/`.

---

## 5. Tabela consolidada de impacto

| Slice SPEC | Adendo dedup | Esforço extra | Ganho |
|------------|--------------|---------------|-------|
| 03-leads | Merge timeline×history×changelog×fieldChanges | +2h | -3 hooks, -4 components legados |
| 04-pipelines | Namespace pipe-* legacy explícito | +1h | Clareza modelo legacy vs novo |
| 05-communication | Merge realtime hooks | +1h | -2 hooks expostos |
| 06-copilot | Compose toggle hooks | +1h | -2 hooks |
| 07-workflows | Auditar `actions/` vs `action-handlers/` | +2h | Nomenclatura única |
| 14-edge-functions | Auditoria webhooks ambíguos | +3h | -4 functions deletadas |
| 15-shared-cleanup | Subdivisão por stack | +2h | 63 → ~20 arquivos no root `_shared/` |

**Total adendo:** +12h sobre os 80h originais.

---

## 6. Pendências de decisão (CTO)

1. `useFieldChangelog` exporta só `FIELD_LABELS` — confirmar que pode virar `shared/format/lead-field-labels.ts`.
2. `useAutoSaveField` vs `useExplicitSaveForm` — qual é o padrão? Decidir antes de slice 03.
3. `useDeals*` — Deal é entidade ativa ou legado? CONTEXT.md não menciona. Auditar se há páginas roteadas.
4. `webhook-new-lead`, `webhook-confirmacao`, `partner-webhook`, `meeting-webhook`, `erp-order-webhook` — qual o estado de cada um? (vivo, deprecated, órfão).
5. Pages `MockupChat*` (4 variantes) — deletar todas ou manter 1 como dev tool?
6. Event-bus: adotar agora (sincronia atual já cria bugs como `triggerStageChangedWorkflows-duplicate`) ou pós-modularização? Ver [`event-bus-plano.md`](event-bus-plano.md).

---

## Refs

- SPEC: [`.specs/features/modularizacao/SPEC.md`](../../../../../.specs/features/modularizacao/SPEC.md)
- ADR: [ADR-2026-05-26-modularizacao-monolito-modular](../../04%20—%20Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md)
- Event-bus: [event-bus-plano.md](event-bus-plano.md)
- Backlog correlato: `08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md`
