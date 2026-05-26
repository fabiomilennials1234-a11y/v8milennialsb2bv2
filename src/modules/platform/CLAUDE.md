# Module — platform

**Status:** 🟡 Skeleton (slice 14 popula)
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

## API pública (`index.ts`) — TBD slice 14

Provável superfície:
- Hooks: `useOnboarding`, `useOnboardingAdvance`, `useOnboardingState`, `useOnboardingTemplates`, `useFeatureFlag`, `useApiKeys`, `useMessageTemplates`, `useMessageLimits`, `useNotifications`, `useGlobalShortcuts`, `useKeyboardShortcuts`, `useSavedViews`, `useApplyViewFromUrl`, `useRecentItems`, `useRecentActivity`, `useHelpCenter`, `useHealthHistory`, `useConsent`, `useLogger`, `useTrackView`, `useFieldChangelog` (?), `useLossReasons`, `useSlaConfigs`, `useSandbox`, `useEnrichment`, `useEmailAccounts`, `useEmails`, `useAiEmailDrafts`, `useSms`, `useBulkActions`, `useBulkSelection`, `useBatchedLeadMetrics`, `usePersistedState`, `useDebounce`, `useOptimisticConflictHandler`, `useCountUp`, `useViewport`, `useOnlineStatus`
- Components: `<Onboarding>`, `<Settings>`, `<CommandPalette>`, `<HelpCenter>`, `<SystemAlerts>`, `<PushPermissionPrompt>`, `<ServiceWorkerUpdater>`, `<GlobalErrorBoundary>`
- Types: `OnboardingStep`, `FeatureFlag`, `SystemAlert`, `DeadLetterJob`
- Eventos (post slice 19): `onboarding.step_completed`, `feature_flag.toggled`, `system.health_degraded`

## Áreas frágeis

- Service worker update — UX deve avisar usuário sem perder estado
- Onboarding state machine — múltiplos paths convergentes
- Dead letter retry — não pode loop infinito
- Push notifications — permission flow varia por browser

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/onboarding/`, `command/`, `settings/`, `system-alerts/`, `notifications/`, `email/`, `sms/`, `saved-views/`, `bulk-actions/`, `approvals/` (cross-cut com `carteira`?)
- `src/components/GlobalErrorBoundary.tsx`, `ServiceWorkerUpdater.tsx`, `PushPermissionPrompt.tsx`, `NavLink.tsx`, `layout/`, `shared/`
- `src/hooks/useOnboarding*.ts` (4 hooks) + `useMilestoneAutoUnlock.ts`
- `src/hooks/useFeatureFlag.ts`, `useApiKeys.ts`, `useMessageTemplates.ts`, `useMessageLimits.ts`
- `src/hooks/useGlobalShortcuts.ts`, `useKeyboardShortcuts.ts`, `use-keyboard-offset.ts`
- `src/hooks/useSavedViews.ts`, `useApplyViewFromUrl.ts`, `useTrackView.ts`, `useRecentItems.ts`, `useRecentActivity.ts`
- `src/hooks/useHelpCenter.ts`, `useHealthHistory.ts`, `useConsent.ts`, `useLogger.ts`
- `src/hooks/useLossReasons.ts`, `useSlaConfigs.ts`, `useSandbox.ts`, `useEnrichment.ts`
- `src/hooks/useEmailAccounts.ts`, `useEmails.ts`, `useAiEmailDrafts.ts`, `useSms.ts`
- `src/hooks/useBulkActions.ts`, `useBulkSelection.ts`, `useBatchedLeadMetrics.ts`
- `src/hooks/usePersistedState.ts`, `useDebounce.ts`, `useOptimisticConflictHandler.ts`, `useCountUp.ts`, `use-viewport.ts`, `useOnlineStatus.ts`, `use-toast.ts`, `useFieldChanges.ts`
- `src/hooks/use-push-subscription.ts`, `use-sw-update.ts`
- `src/hooks/useAutoSaveField.ts`, `useExplicitSaveForm.ts` (decisão CTO pendente — qual padrão?)
- `src/pages/Onboarding.tsx`, `Configuracoes.tsx`, `Privacidade.tsx`, `MessageTemplates.tsx`, `NotFound.tsx`

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
