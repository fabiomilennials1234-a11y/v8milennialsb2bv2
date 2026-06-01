---
type: reference
title: As-Is — Duplicatas Mapeadas
status: active
created: 2026-05-26
tags: [remodelagem, as-is, duplicatas]
related: ["[[problemas-criticos]]", "[[auditoria-duplicatas]]"]
---

# As-Is — Duplicatas Mapeadas

Síntese executiva. Detalhe completo com paths e linhas em [[auditoria-duplicatas]] (`06 — Features/modularizacao/auditoria-duplicatas.md`).

## Hooks duplicados/sobrepostos

| Grupo | Hooks | Recomendação |
|-------|-------|--------------|
| Histórico do lead | `useLeadHistory` + `useLeadTimeline` + `useFieldChangelog` + `useFieldChanges` | Consolidar em `useLeadTimeline` (mais rico). `FIELD_LABELS` → `shared/format/` |
| Copilot toggle | `useCopilotToggle` + `useCopilotToggleAudit` + `useCopilotToggleRealtime` | Single hook composable |
| Realtime | `useRealtimeChannel` + `useRealtimeChannelStatus` + `useRealtimeSubscription` | Manter só o último (canônico segundo CLAUDE.md). Outros 2 → `core/realtime/` interno |
| Form save | `useAutoSaveField` + `useExplicitSaveForm` + `useOptimisticConflictHandler` | Decidir convenção (bloqueador CTO) |
| Pipe legacy vs novo | 16 hooks misturando `usePipe*` (views compat) e `usePipeline*` (entries) | Isolar em `modules/pipelines/` por subnamespace. Cleanup = projeto separado |
| Order/Deal/Approval | `useDeals`, `useNewOrder`, `useQuickOrder`, `useOrderApproval`, `useApprovals`, `useUpsellOrders` | Auditar: Deal é entidade viva? (bloqueador CTO) |

## Components duplicados

| Domínio | Pastas atuais | Alvo |
|---------|---------------|------|
| Lead | `lead/` + `lead-detail/` + `leads/` | `modules/leads/components/{card,modal,timeline,tabs}/` |
| Pipeline | `pipelines/` + `kanban/` + `custom-pipelines/` + `pipe-propostas/` + `confirmacao/` + `funis/` | `modules/pipelines/components/{kanban,custom,legacy,hub}/` |
| Chat | `chat/` + `chat-meta/` | `modules/communication/{whatsapp,meta,shared}/` (canais distintos, primitivos compartilhados) |
| Carteira | `carteira/` + `upsell/` + `proposals/` + `deals/` | `modules/carteira/components/{client,upsell,proposal,deal}/` |
| Analytics | `analytics/` + `dashboard/` + `dashboard-outbound/` + `tv/` + `performance/` + `revisao/` | `modules/analytics/components/{dashboard,tv,outbound,performance,revisao}/` |
| Engagement | `agenda/` + `activities/` + `followups/` + `checklists/` + `calls/` + `gamification/` + `badges/` + `ranking/` | `modules/engagement/components/` |
| Pages órfãs | `MockupChat.tsx` + `V2` + `V3` + `V3 2` (filename corrupto) | Deletar (bloqueador CTO confirmar) |

## Edge functions duplicadas/ambíguas

| Grupo | Functions | Volume | Alvo |
|-------|-----------|--------|------|
| Webhooks ambíguos | `lead-webhook` vs `webhook-new-lead`; `webhook-calcom` vs `meeting-webhook`; `tinyerp-webhook` vs `erp-order-webhook` | 6 com sobreposição suspeita | Auditoria 1-a-1 + consolidar |
| TinyERP | `tinyerp-{connect,disconnect,fetch-nfe,proxy,push-order,push-upsell-order,sync-products,webhook}` + `erp-order-webhook` | 9 | `modules/integrations/tinyerp/` |
| WhatsApp | `whatsapp-{api-proxy,dlq-replay,health-monitor,media-retry,rebind-webhook,session-watchdog,webhook}` | 7 | `modules/communication/whatsapp/` |
| Process workers | `process-{ai-actions,copilot-followups,followup-automations,outbound-dispatches,pipe-distribution,scheduled-user-messages,webhook-deliveries,workflow-executions}` | 8 | Template `withCronWorker` em `_shared/cron/` |
| Copilot | `agent-message`, `analyze-copilot-prompt`, `copilot-batch-processor`, `evaluate-agent-conversation`, `generate-*` (4), `oraculo-comercial`, `summarize-conversation`, `process-copilot-followups`, `process-agent-document` + dev | 12 | `modules/copilot/` |
| Google Calendar | `google-calendar-{callback,connect,disconnect,events,sharing,webhook}` | 6 | `modules/integrations/google-calendar/` |
| Identity admin | `admin-reset-user-password`, `assign-user-to-org`, `attach-to-org-by-pending-invite`, `create-org-user`, `list-organizations`, `list-unassigned-users`, `remove-org-member`, `save-member-permissions`, `get-member-permissions` | 9 | `modules/identity/` |
| Mass send | `mass-send-{control,create,status}` | 3 | `modules/campaigns/mass-send/` |
| Dev/test | `test-copilot-chat`, `test-workflow-system`, `webhook-send-test` | 3 | Deletar ou mover pra `tests/` |
| Meta | `meta-{ads-insights,conversation-profile,oauth-callback,webhook}` + `send-meta-message` | 5 | `modules/communication/meta/` + `modules/integrations/meta/` |
| Senders | `agent-message`, `send-meta-message`, `sz-chat-send`, `outbound-trigger`, `semi-automatic-dispatch` | 5 | Thin edges chamando `MessageSender` unificado |

## `_shared/` (63 módulos no root)

| Stack | Módulos | Alvo |
|-------|---------|------|
| Message | `message-gateway`, `outbound-sender`, `followup-sender`, `audio-sender`, `whatsapp-dispatch`, `dispatch-router`, `natural-messaging`, `greeting-orchestrator`, `message-humanizer`, `message-sanitizer`, `message-classifier`, `send-dedup` | 12 | `_shared/communication/{send,humanize,classify,dedup}/` |
| WhatsApp | `whatsapp-client`, `whatsapp-dispatch`, `whatsapp-media`, `whatsapp-providers/`, `uazapi-client`, `uazapi-types` | 6 | `_shared/integrations/whatsapp/` |
| Workflow | `workflow-executor`, `workflow-action-handler`, `workflow-condition-evaluator`, `workflow-trigger`, `workflow-trigger-dedup`, `actions/`, `action-handlers/` | 7 (auditar split `actions/` vs `action-handlers/`) | `_shared/workflows/` |
| Auth/permission | `auth.ts`, `user-auth.ts`, `permission_engine.ts`, `permission-actions.ts`, `assert-permission.ts` | 5 (auditar `auth.ts` vs `user-auth.ts`) | `_shared/identity/` |
| Copilot | `copilot/` (parcial) + `copilot-batch-maturity`, `ai-queue`, `ai-action-executor`, `bot-loop-detector` | 5 | Tudo dentro de `_shared/copilot/` |
| Core | `cors`, `response`, `sentry`, `logger`, `security-headers`, `supabase-admin`, `validation`, `edge-framework`, `fetch-utils`, `track` | 10 | `_shared/core/` |
| Domain-specific (single caller) | `tts-elevenlabs`, `tinyerp-utils`, `meta-api`, `asaas` (verificar órfão) | 4 | `_shared/<bc>/` |

## Total impacto

| Camada | Estado atual | Após dedup + modularização |
|--------|--------------|----------------------------|
| `src/hooks/` no root | 250+ | 0 (todos em `modules/<bc>/hooks/` ou `shared/hooks/`) |
| `src/components/` no root | 62 pastas/arquivos | 0 (todos em `modules/<bc>/components/`) |
| `src/pages/` no root | 47 | 0 (todos em `modules/<bc>/pages/`) |
| `supabase/functions/` no root | 97 | 0 (todos em `modules/<bc>/<fn>/`) |
| `supabase/functions/_shared/` no root | 63 | ~10 (só `core/` no root) |
| Funções/hooks/components deletados | — | ~20-30 (dev artifacts + duplicatas confirmadas) |

## Refs

- [[auditoria-duplicatas]] — detalhe com paths e linhas
- [[panorama-atual]]
- [[problemas-criticos]]
