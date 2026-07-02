# Module — platform

**Status:** 🟢 Active (slice 14 + cleanup longtail slice 16 — 2026-05-28)
**BC:** platform (cross-cutting infrastructure)
**Entidade primária:** Onboarding flow + Settings + Observability + Dead Letter
**Owner:** plataforma / ops

## Escopo

Infraestrutura do produto. Não é domínio de negócio. Inclui:

- **Onboarding** — fluxo de setup inicial da org (criar instância WA, primeiro pipe, primeiro agente)
- **Settings** — configurações da org (settings de feature, message templates, message limits)
- **Privacidade** — LGPD/GDPR — export user data, delete user data
- **Observability** — health checks, audit logs, system alerts
- **Dead Letter** — fila de jobs falhos
- **Cron health** — monitoring de jobs cron
- **Push notifications** — service worker, push subscriptions
- **Feature flags** — `useFeatureFlag`
- **Recent items / saved views** — UX state cross-domain
- **API keys** — pra integração externa
- **Templates** — message templates compartilhados (não confundir com workflow templates)
- **Help center** — docs in-app
- **Logger / Sentry init** — observability boot
- **Command palette** — `Cmd+K`

## Não-escopo

- Auth/permissões → `identity`
- Cron de workflow execution → `workflows.process-workflow-executions`
- Health checks específicos do WhatsApp → `communication.whatsapp-health-monitor`

## API pública (`index.ts`) — slice 14 (atual)

Exports re-exportados via barrel (ver `./index.ts`):

- **Hooks (top-level):** `useFeatureFlag`, `useApiKeys`, `useSlaConfigs`, `useWebhooks`, `useHelpCenter`, `useHealthHistory`, `useConsent`, `useLogger`, `useTrackView`, `useOnlineStatus`, `usePushSubscription` (`use-push-subscription`), `useServiceWorkerUpdate` (`use-sw-update`), `useOnboarding`, `useOnboardingAdvance`, `useOnboardingState`, `useOnboardingTemplates`
- **Hooks (onboarding/):** `useDemoData`, `useOnboardingChecklist`, `usePrimeOnboardingProgress`
- **Hooks (slice 16 longtail):** `useSavedViews`, `useApplyViewFromUrl`, `useGlobalShortcuts`, `useKeyboardShortcuts`, `useSandbox`
- **Lib:** `feature-flags`, `feature-registry` (`FEATURES`, `LIMITS`, `FeatureKey`, `LimitKey`, `getFeatureMeta`, `getLimitMeta`, `isUnlimited`, `SIDEBAR_FEATURE_MAP`, `CAMPAIGN_TYPE_FEATURE_MAP`, `FUNNEL_TEMPLATE_FEATURE_MAP`), `logger` (`logger`, `LogLevel`, `LogContext`), `optimistic-lock` (`OptimisticLockConflictError`, `isPostgrestNoRows`), `rate-limit` (`createRateLimiter`, `tokenBucket`), `onboarding-suggestions`, `pipeline-config-from-quiz`, `tv-config-from-quiz`
- **Components:** `GlobalErrorBoundary`, `PushPermissionPrompt`, `ServiceWorkerUpdater`, `PlanFeatureProtectedRoute` (guard de rota por feature de plano — deep-import via App.tsx), `OnboardingChecklist`, `OnboardingFlow`, `OnboardingGate`, `OnboardingQuestion`, `OnboardingWizard`, `AlertsDropdown`, `AlertsBanner`, + `components/command/*` (Command palette `Cmd+K`), `components/saved-views/*`, `components/layout/*` (slice 16 longtail)
- **Pages (deep-import via React.lazy, NÃO no barrel):** `pages/Configuracoes`, `pages/Privacidade`, `pages/NotFound`, `pages/OnboardingHub` (+ `OnboardingHubPreview` dev-only). `pages/Onboarding` legada deletada 2026-07-02 (plan-tiers-cleanup).
- **Settings panels** (`components/settings/*`): NÃO re-exportados — `Configuracoes.tsx` faz lazy interno por aba (chunking).
- Eventos (post slice 19): `onboarding.step_completed`, `feature_flag.toggled`, `system.health_degraded`

## Slice 16 longtail — absorvido

Slice 16 movimentou para os módulos os hooks/components que residiam em `src/components/` e `src/hooks/` root:

| Item | Destino |
|---|---|
| `useGlobalShortcuts`, `useKeyboardShortcuts`, `useSavedViews`, `useApplyViewFromUrl`, `useSandbox` | `platform` |
| `components/command/*`, `components/saved-views/*`, `components/layout/*` | `platform` |
| `useTags`, `useImportBatches`, `useEnrichment`, `useBulkActions`, `useBulkSelection`, `useBatchedLeadMetrics` | `leads` |
| `components/bulk-actions/BulkActionBar` | `leads` |
| `useEmailAccounts`, `useEmails`, `useAiEmailDrafts`, `useSms`, `components/email/*`, `components/sms/*`, `components/ai/AiEmailWriter`, `pages/MessageTemplates` | `communication` |
| `useGoogleCalendar`, `useGoogleCalendarSharing` | `integrations` |
| `useLossReasons` | `pipelines` |
| `components/team/*`, `useAvatarMap`, `useAutoAdminAssignment` | `identity` |
| `components/oraculo/OraculoComercial` | `copilot` |
| `components/calls/LogCallModal`, `components/ai/CoachingSidebar`, `components/ai/NextBestActionsPanel` | `engagement` |
| `useRealtimeChannel`, `useRealtimeChannelStatus`, `useRealtimeSubscription` | `src/shared/realtime/` |
| `usePersistedState`, `useDebounce`, `useOptimisticConflictHandler`, `useCountUp`, `use-viewport`, `useAutoSaveField`, `useExplicitSaveForm` | `src/shared/hooks/` |
| `use-toast` | mantido em `src/hooks/` (shadcn primitive) |

Edge functions: doc-only (slice 15) — flat layout em `supabase/functions/` mantido (Supabase CLI constraint).

## Áreas frágeis

- Service worker update — UX deve avisar usuário sem perder estado
- Onboarding state machine — múltiplos paths convergentes
- Dead letter retry — não pode loop infinito
- Push notifications — permission flow varia por browser

## Backend (NÃO migrado — fica em `supabase/functions/`)
- `supabase/functions/cron-health-check/`
- `supabase/functions/check-api-health/`
- `supabase/functions/process-webhook-deliveries/`
- `supabase/functions/process-scheduled-user-messages/`
- `supabase/functions/retry-dead-letter-jobs/`
- `supabase/functions/reprocess-job/`
- `supabase/functions/onboarding-advance/`
- `supabase/functions/webhook-orchestrator/` (auditar)
- `supabase/functions/webhook-send-test/` (USADO por `WebhookSettings.tsx:197`)
- `supabase/functions/_shared/sentry.ts`, `logger.ts`, `rate-limit.ts` (não encontrado — verificar), `security-headers.ts`, `cors.ts`, `response.ts`, `supabase-admin.ts`, `validation.ts`, `edge-framework.ts`, `fetch-utils.ts`, `track.ts`
- `supabase/functions/_shared/job-tracker.ts`, `instance-write-guard.ts`, `webhook-utils.ts`, `url-validator.ts`, `time-variables.ts`, `embeddings.ts`, `followupSchedule.ts`, `onboarding-engine.ts`, `message-sanitizer.ts`

## Slice de migração

**Slice 14** (active) + **slice 16** (longtail cleanup) — frontend completo. Backend: doc-only mapping.

## Dedup pendente

- `useAutoSaveField` vs `useExplicitSaveForm` — convenção (decisão CTO pendente)
- `_shared/` core utils → `_shared/core/` (slice 16)

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Runbook cron+webhooks: `Obsidian/.../06 — Features/Infra/Runbook — Cron e Webhooks.md`
- Tutorial onboarding dev: `Obsidian/.../09 — Tutorials/01-onboarding-dev.md`
