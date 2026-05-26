---
type: reference
title: To-Be — Estrutura Final
status: active
created: 2026-05-26
tags: [remodelagem, to-be, estrutura]
related: ["[[principios-modulo]]", "[[bounded-contexts]]"]
---

# To-Be — Estrutura Final

Layout físico target após conclusão das 19 slices.

## Frontend

```
src/
  modules/
    identity/
      components/
      hooks/
      pages/
      lib/
      index.ts                    # API pública
      CLAUDE.md                   # ownership + áreas frágeis
    leads/
      components/{card,modal,timeline,tabs,form}/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    pipelines/
      components/{kanban,custom,legacy,hub}/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    communication/
      whatsapp/
      meta/
      shared/                     # primitivos chat (bubble, composer, context-panel)
      hooks/
      pages/
      index.ts
      CLAUDE.md
    copilot/
      components/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    workflows/
      components/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    campaigns/
      components/
      mass-send/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    carteira/
      components/{client,upsell,proposal,deal}/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    engagement/
      components/{agenda,activities,followups,checklists,calls,gamification}/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    analytics/
      components/{dashboard,tv,outbound,performance,revisao}/
      hooks/
      pages/
      index.ts
      CLAUDE.md
    billing/
    marketing/
    integrations/
      google-calendar/
      meta/
      tinyerp/
      asaas/
      sz-chat/
      uazapi/
      index.ts
      CLAUDE.md
    platform/
      components/{onboarding,settings,observability}/
      hooks/
      pages/
      index.ts
      CLAUDE.md
  ui/                             # shadcn primitivos (mantém intacto)
  shared/                         # utils puros (cn, format, normalizePhone, optimistic-lock)
  core/                           # supabase client, env, types globais, sentry init
  integrations/supabase/          # types.ts auto-gerado (mantém)
```

## Backend (Supabase)

```
supabase/
  functions/
    _shared/
      core/                       # cors, response, sentry, supabase-admin, security-headers, logger, edge-framework, fetch-utils, track, validation
      events/                     # types, publish, dispatch, registry (slice 19)
      communication/
        send/                     # MessageSender + chunk + humanize
        humanize/
        classify/
        dedup/
      workflows/                  # executor, action-handler, condition-evaluator, trigger, dedup, actions, action-handlers (consolidado)
      identity/                   # auth, user-auth (consolidado), permission_engine, permission-actions, assert-permission
      copilot/                    # tudo do copilot/ atual + batch-maturity, ai-queue, ai-action-executor, bot-loop-detector
      integrations/
        whatsapp/                 # whatsapp-client, whatsapp-dispatch, whatsapp-media, whatsapp-providers, uazapi-client, uazapi-types
        meta/
        tinyerp/
        google-calendar/
        asaas/
        elevenlabs/
      cron/                       # withCronWorker template
    identity/
      admin-reset-user-password/
      assign-user-to-org/
      attach-to-org-by-pending-invite/
      create-org-user/
      list-organizations/
      list-unassigned-users/
      remove-org-member/
      save-member-permissions/
      get-member-permissions/
    leads/
      lead-webhook/
      import-leads/
      calculate-lead-score/
      get-lead-timeline/
      semi-automatic-dispatch/
    pipelines/
      process-pipe-distribution/
      pipe-rule-dispatch/
    communication/
      whatsapp-webhook/
      whatsapp-api-proxy/
      whatsapp-dlq-replay/
      whatsapp-health-monitor/
      whatsapp-media-retry/
      whatsapp-rebind-webhook/
      whatsapp-session-watchdog/
      meta-webhook/
      send-meta-message/
      meta-conversation-profile/
      sz-chat-send/
      sz-chat-webhook/
      history-sync-worker/
      mass-send-create/
      mass-send-status/
      mass-send-control/
      process-scheduled-user-messages/
      process-meta-messages/
      stream-media/
      summarize-conversation/
      meeting-webhook/             # se confirmado vivo
    copilot/
      agent-message/
      analyze-copilot-prompt/
      copilot-batch-processor/
      evaluate-agent-conversation/
      generate-agent-examples/
      generate-business-context/
      generate-custom-instructions/
      generate-faqs/
      generate-faq-embeddings/
      process-agent-document/
      process-copilot-followups/
      oraculo-comercial/
      reembed-all/
    workflows/
      process-workflow-executions/
      process-ai-actions/
      process-followup-automations/
    campaigns/
      campaign-rule-dispatch/
      process-outbound-dispatches/
      outbound-trigger/
    carteira/
      calculate-portfolio-health/
      suggest-retention-action/
      carteira-bulk-message/
    integrations/
      google-calendar/             # 6 functions
      meta/
      tinyerp/                     # 8 functions + erp-order-webhook
      elevenlabs-proxy/
      webhook-calcom/
      partner-webhook/
      refresh-meta-tokens/
      meta-ads-insights/
      meta-oauth-callback/
    platform/
      cron-health-check/
      process-webhook-deliveries/
      retry-dead-letter-jobs/
      reprocess-job/
      onboarding-advance/
      get-automation-jobs/
      get-daily-priorities/
      cadastro-externo-push/
      check-api-health/
      get-member-permissions/      # ou identity/
    event-dispatcher/              # slice 19
```

## Diferenças-chave do As-Is

| Métrica | As-Is | To-Be |
|---------|-------|-------|
| Arquivos no root `src/hooks/` | 250+ | 0 |
| Pastas no root `src/components/` | 62 | 0 (só `ui/`, `shared/`, `core/`) |
| Pages no root `src/pages/` | 47 | 0 |
| Functions no root `supabase/functions/` | 97 | 0 (só `_shared/` + módulos) |
| Módulos no root `_shared/` | 63 | ~10 (só `core/`) |
| Sub-CLAUDE.md | 5 áreas | Toda módulo (14) |
| Boundary enforcement | Nenhum | ESLint + dep-cruiser + CI gate |
| Cross-module communication | Função direta (acopla) | Event-bus piloto (slice 19) |

## Refs

- [[principios-modulo]] — regras de módulo
- [[bounded-contexts]] — 14 BCs detalhados
- [[criterios-sucesso]] — checklist de conclusão
- SPEC: `.specs/features/modularizacao/SPEC.md`
