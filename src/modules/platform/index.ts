/**
 * Module platform — API pública.
 *
 * Public surface do bounded context (infraestrutura cross-cutting do produto).
 * Tudo cross-module passa por aqui. Internals (components/, hooks/, pages/, lib/)
 * são privados — ESLint `boundaries` impede import direto fora da API pública.
 *
 * Status: Active (populado em slice 14 — feat/modularizacao/13-platform).
 *
 * Domínios cobertos:
 * - Onboarding (wizard + state machine + checklist + templates)
 * - Settings (org settings, integrations catalog, API keys, SLA, webhooks, help)
 * - System alerts + notifications dropdown
 * - PWA boot (push subscription, service worker update)
 * - Feature flags + feature registry (planos/cotas)
 * - Observability primitives (logger, health history, track view, online status)
 * - Resilience primitives (optimistic lock, rate limit, consent)
 * - Privacidade (LGPD export/delete)
 * - Global error boundary
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy:
 *   @/modules/platform/pages/Configuracoes
 *   @/modules/platform/pages/Onboarding (page legada, sem rota ativa)
 *   @/modules/platform/pages/Privacidade
 *   @/modules/platform/pages/NotFound
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — top-level
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/use-push-subscription";
export * from "./hooks/use-sw-update";
export * from "./hooks/useConsent";
export * from "./hooks/useFeatureFlag";
export * from "./hooks/useHealthHistory";
export * from "./hooks/useHelpCenter";
export * from "./hooks/useSupportTickets";
export * from "./hooks/useSupportContext";
export * from "./hooks/useSupportUnread";
export * from "./hooks/useLogger";
export * from "./hooks/useOnlineStatus";
export * from "./hooks/useTrackView";
export * from "./hooks/useApiKeys";
export * from "./hooks/useSlaConfigs";
export * from "./hooks/useWebhooks";
export * from "./hooks/useOnboarding";
export * from "./hooks/useOnboardingAdvance";
export * from "./hooks/useOnboardingState";
export * from "./hooks/useOnboardingTemplates";

// Hooks — onboarding subdir
export * from "./hooks/onboarding/useDemoData";
export * from "./hooks/onboarding/useOnboardingChecklist";
export * from "./hooks/onboarding/usePrimeOnboardingProgress";

// ────────────────────────────────────────────────────────────────────────
// Lib — utilities + feature registry + observability
// ────────────────────────────────────────────────────────────────────────

export * from "./lib/feature-flags";
export * from "./lib/feature-registry";
export * from "./lib/logger";
export * from "./lib/optimistic-lock";
export * from "./lib/rate-limit";
export * from "./lib/onboarding-suggestions";
export * from "./lib/pipeline-config-from-quiz";
export * from "./lib/tv-config-from-quiz";

// ────────────────────────────────────────────────────────────────────────
// Components — boundary / PWA / global UX
// ────────────────────────────────────────────────────────────────────────

export { GlobalErrorBoundary } from "./components/GlobalErrorBoundary";
export { PushPermissionPrompt } from "./components/PushPermissionPrompt";
export { ServiceWorkerUpdater } from "./components/ServiceWorkerUpdater";

// Components — Onboarding
export { OnboardingChecklist } from "./components/onboarding/OnboardingChecklist";
export { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
export { OnboardingGate } from "./components/onboarding/OnboardingGate";
export { OnboardingQuestion } from "./components/onboarding/OnboardingQuestion";
export { OnboardingWizard } from "./components/onboarding/OnboardingWizard";

// Components — Notifications + System alerts
export { AlertsDropdown } from "./components/notifications/AlertsDropdown";
export { AlertsBanner } from "./components/system-alerts/AlertsBanner";

// Components — Settings panels NÃO são re-exportados aqui. Consumidores
// internos (Configuracoes.tsx) fazem lazy via deep-import — chunking por aba.
// Re-exportar `export *` desses panels infla o bundle.

// Chamado (ADR-0018) — o painel e o provider sao deep-imported pelo App.tsx,
// como o command palette. Apenas hooks e logica pura ficam no barrel.
export * from "./lib/support-ticket-draft";
export * from "./lib/ticket-author";
export * from "./lib/support-unread";
export * from "./lib/support-rate-limit";
export * from "./lib/ticket-lifecycle";
export * from "./lib/first-response-clock";
export * from "./lib/help-suggestions";
