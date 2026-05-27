# Module — platform

**Status:** 🟢 Active (slice 14 populou — feat/modularizacao/13-platform)
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
- **Lib:** `feature-flags`, `feature-registry` (`FEATURES`, `LIMITS`, `FeatureKey`, `LimitKey`, `getFeatureMeta`, `getLimitMeta`, `isUnlimited`, `SIDEBAR_FEATURE_MAP`, `CAMPAIGN_TYPE_FEATURE_MAP`, `FUNNEL_TEMPLATE_FEATURE_MAP`), `logger` (`logger`, `LogLevel`, `LogContext`), `optimistic-lock` (`OptimisticLockConflictError`, `isPostgrestNoRows`), `rate-limit` (`createRateLimiter`, `tokenBucket`), `onboarding-suggestions`, `pipeline-config-from-quiz`, `tv-config-from-quiz`
- **Components:** `GlobalErrorBoundary`, `PushPermissionPrompt`, `ServiceWorkerUpdater`, `OnboardingChecklist`, `OnboardingFlow`, `OnboardingGate`, `OnboardingQuestion`, `OnboardingWizard`, `AlertsDropdown`, `AlertsBanner`
- **Pages (deep-import via React.lazy, NÃO no barrel):** `pages/Configuracoes`, `pages/Onboarding` (page legada), `pages/Privacidade`, `pages/NotFound`
- **Settings panels** (`components/settings/*`): NÃO re-exportados — `Configuracoes.tsx` faz lazy interno por aba (chunking).
- Eventos (post slice 19): `onboarding.step_completed`, `feature_flag.toggled`, `system.health_degraded`

## Pendências para slices futuros

- Slice 17 (cross-cutting cleanup): `src/components/{branding,ai,command,layout,shared,bulk-actions,saved-views,team}/`, `email/`, `sms/`, `calls/`, `src/lib/{analytics*,copilot,lead,format,api-docs}/` e hooks ainda em `src/hooks/` (`useGlobalShortcuts`, `useKeyboardShortcuts`, `useSavedViews`, `useApplyViewFromUrl`, `useRecentItems`, `useRecentActivity`, `useMessageTemplates`, `useMessageLimits`, `useLossReasons`, `useSandbox`, `useEnrichment`, `useEmailAccounts`, `useEmails`, `useAiEmailDrafts`, `useSms`, `useBulkActions`, `useBulkSelection`, `useBatchedLeadMetrics`, `usePersistedState`, `useDebounce`, `useOptimisticConflictHandler`, `useCountUp`, `use-viewport`, `use-toast`, `useFieldChanges`, `useAutoSaveField`, `useExplicitSaveForm`) — auditar e absorver no BC certo.
- Slice 15 (edge functions reorg): `cron-health-check`, `check-api-health`, `process-webhook-deliveries`, `process-scheduled-user-messages`, `retry-dead-letter-jobs`, `reprocess-job`, `onboarding-advance`, `webhook-validate-url`, etc.
- Slice 16 (_shared cleanup): mover utilities de `supabase/functions/_shared/` para `_shared/core/`.

## Áreas frágeis

- Service worker update — UX deve avisar usuário sem perder estado
- Onboarding state machine — múltiplos paths convergentes
- Dead letter retry — não pode loop infinito
- Push notifications — permission flow varia por browser

## Origem (pastas atuais que migrarão pra cá)

Frontend — slice 14 ✅ (já migrado):
- `src/components/onboarding/`, `settings/`, `system-alerts/`, `notifications/`
- `src/components/GlobalErrorBoundary.tsx`, `ServiceWorkerUpdater.tsx`, `PushPermissionPrompt.tsx`
- `src/hooks/onboarding/` + `useOnboarding*.ts` (4 hooks)
- `src/hooks/useFeatureFlag.ts`, `useApiKeys.ts`, `useSlaConfigs.ts`, `useWebhooks.ts`
- `src/hooks/useHelpCenter.ts`, `useHealthHistory.ts`, `useConsent.ts`, `useLogger.ts`, `useTrackView.ts`, `useOnlineStatus.ts`
- `src/hooks/use-push-subscription.ts`, `use-sw-update.ts`
- `src/lib/feature-flags.ts`, `feature-registry.ts`, `logger.ts`, `optimistic-lock.ts`, `rate-limit.ts`
- `src/lib/onboarding-suggestions.ts`, `pipeline-config-from-quiz.ts`, `tv-config-from-quiz.ts`
- `src/pages/Configuracoes.tsx`, `Onboarding.tsx`, `Privacidade.tsx`, `NotFound.tsx`

Frontend — pendente (slice 17):
- `src/components/command/`, `email/`, `sms/`, `calls/`, `saved-views/`, `bulk-actions/`, `approvals/`, `branding/`, `ai/`, `layout/`, `shared/`, `team/`
- `src/hooks/useGlobalShortcuts.ts`, `useKeyboardShortcuts.ts`, `use-keyboard-offset.ts`, `useSavedViews.ts`, `useApplyViewFromUrl.ts`, `useRecentItems.ts`, `useRecentActivity.ts`
- `src/hooks/useMessageTemplates.ts`, `useMessageLimits.ts`, `useLossReasons.ts`, `useSandbox.ts`, `useEnrichment.ts`
- `src/hooks/useEmailAccounts.ts`, `useEmails.ts`, `useAiEmailDrafts.ts`, `useSms.ts`
- `src/hooks/useBulkActions.ts`, `useBulkSelection.ts`, `useBatchedLeadMetrics.ts`
- `src/hooks/usePersistedState.ts`, `useDebounce.ts`, `useOptimisticConflictHandler.ts`, `useCountUp.ts`, `use-viewport.ts`, `use-toast.ts`, `useFieldChanges.ts`, `useMilestoneAutoUnlock.ts`
- `src/hooks/useAutoSaveField.ts`, `useExplicitSaveForm.ts` (decisão CTO pendente — qual padrão?)
- `src/pages/MessageTemplates.tsx`

Backend:
- `supabase/functions/cron-health-check/`
- `supabase/functions/check-api-health/`
- `supabase/functions/process-webhook-deliveries/`
- `supabase/functions/process-scheduled-user-messages/`
- `supabase/functions/retry-dead-letter-jobs/`
- `supabase/functions/reprocess-job/`
- `supabase/functions/onboarding-advance/`
- `supabase/functions/webhook-orchestrator/` (auditar)
- `supabase/functions/webhook-validate-url/`
- `supabase/functions/webhook-send-test/` (deletar)
- `supabase/functions/_shared/sentry.ts`, `logger.ts`, `rate-limit.ts` (não encontrado — verificar), `security-headers.ts`, `cors.ts`, `response.ts`, `supabase-admin.ts`, `validation.ts`, `edge-framework.ts`, `fetch-utils.ts`, `track.ts`
- `supabase/functions/_shared/job-tracker.ts`, `instance-write-guard.ts`, `webhook-utils.ts`, `url-validator.ts`, `time-variables.ts`, `embeddings.ts`, `followupSchedule.ts`, `onboarding-engine.ts`, `message-sanitizer.ts`

## Slice de migração

**Slice 14** — `feat/modularizacao/13-platform` (4h)

## Dedup pendente

- `useAutoSaveField` vs `useExplicitSaveForm` — convenção (decisão CTO pendente)
- Várias funções dev: `webhook-send-test` → deletar
- `_shared/` core utils → `_shared/core/` (slice 16)

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Runbook cron+webhooks: `Obsidian/.../06 — Features/Infra/Runbook — Cron e Webhooks.md`
- Tutorial onboarding dev: `Obsidian/.../09 — Tutorials/01-onboarding-dev.md`
