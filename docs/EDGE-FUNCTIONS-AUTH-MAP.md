# Edge Functions Auth Map

All 61 functions with `verify_jwt = false` in config.toml.
Generated 2026-05-15 during security audit.

## Legend

| Auth Method | Description |
|-------------|-------------|
| CRON | `x-cron-secret` header validated via `timingSafeCompare` or `requireCronAuth` |
| JWT | User JWT validated via `requireAuth()` / `auth.getUser()` / `x-user-jwt` |
| WEBHOOK | Cryptographic signature or secret validation (HMAC, webhook key, etc.) |
| SVC_ROLE | Service role key validated via `timingSafeCompare` |
| INTERNAL | `X-Internal-Api-Key` header for inter-function calls |
| API_KEY | Custom `x-api-key` header validation |
| OAUTH | OAuth callback — public by design, validates state/code |
| NONE | No auth found — NEEDS REVIEW |

## Auth Matrix

### Cron Jobs (called by pg_cron via pg_net)

| Function | Auth | Status |
|----------|------|--------|
| calculate-portfolio-health | CRON | OK |
| campaign-rule-dispatch | CRON + JWT | OK |
| cron-health-check | CRON + SVC_ROLE | OK |
| history-sync-worker | CRON | OK |
| mass-send-status | CRON + JWT | OK |
| pipe-rule-dispatch | CRON + JWT | OK |
| process-ai-actions | CRON | OK |
| process-copilot-followups | CRON | OK |
| process-followup-automations | CRON | OK |
| process-outbound-dispatches | CRON | OK |
| process-pipe-distribution | CRON | OK |
| process-webhook-deliveries | CRON | OK |
| refresh-meta-tokens | CRON | OK |
| retry-dead-letter-jobs | CRON + JWT | OK |
| whatsapp-dlq-replay | CRON + SVC_ROLE | OK |
| whatsapp-health-monitor | CRON + SVC_ROLE | OK |
| whatsapp-rebind-webhook | CRON + SVC_ROLE + WEBHOOK | OK |
| whatsapp-session-watchdog | CRON + SVC_ROLE | OK |

### Frontend-called (user JWT)

| Function | Auth | Status |
|----------|------|--------|
| analyze-copilot-prompt | JWT | OK |
| calculate-lead-score | JWT | OK |
| elevenlabs-proxy | JWT | OK |
| google-calendar-connect | JWT | OK |
| google-calendar-disconnect | JWT | OK |
| google-calendar-events | JWT | OK |
| google-calendar-sharing | JWT | OK |
| import-leads | JWT | OK |
| mass-send-control | JWT | OK |
| mass-send-create | JWT | OK |
| oraculo-comercial | JWT | OK |
| process-workflow-executions | CRON + JWT | OK |
| send-meta-message | JWT | OK |
| stream-media | JWT | OK |
| summarize-conversation | JWT | OK |
| tinyerp-connect | JWT | OK |
| tinyerp-disconnect | JWT | OK |
| tinyerp-proxy | JWT | OK |
| tinyerp-push-order | JWT | OK |
| tinyerp-push-upsell-order | JWT | OK |
| tinyerp-sync-products | JWT | OK |

### Inter-function calls

| Function | Auth | Status |
|----------|------|--------|
| checkout-create-payment | JWT + INTERNAL | OK |
| checkout-provision-org | JWT + INTERNAL + SVC_ROLE | OK |

### External webhooks

| Function | Auth | Status |
|----------|------|--------|
| asaas-webhook | WEBHOOK (token) | OK |
| lead-webhook | WEBHOOK (x-webhook-key) | OK |
| meta-webhook | WEBHOOK (HMAC-SHA256) | OK |
| whatsapp-api-proxy | JWT + WEBHOOK | OK |
| whatsapp-webhook | WEBHOOK (URL path secret) | OK |

### OAuth callbacks (public by design)

| Function | Auth | Justification |
|----------|------|---------------|
| google-calendar-callback | OAUTH | OAuth2 callback — validates state param |
| meta-oauth-callback | OAUTH | OAuth2 callback — validates state param |

### Previously reviewed — now secured

| Function | Auth | Status | Fix Applied |
|----------|------|--------|-------------|
| list-lead-forms | JWT | OK | Added requireAuth + org-scoped meta_pages query (Wave 5) |
| sz-chat-send | JWT + SVC_ROLE | OK | Added requireAuth for frontend, timingSafeCompare for service_role (Wave 5) |
| sz-chat-webhook | WEBHOOK (timing-safe) | OK | Already had webhook_secret validation; upgraded to timingSafeCompare (Wave 5) |
| tinyerp-webhook | WEBHOOK (env secret) | OK | Added TINYERP_WEBHOOK_SECRET validation via header/query param (Wave 5) |
| tinyerp-fetch-nfe | JWT + SVC_ROLE | OK | Added requireAuth for frontend, timingSafeCompare for service_role (Wave 5) |
| webhook-send-test | JWT + org check | OK | Already had JWT validation + org membership check |
| ~~webhook-validate-url~~ | — | REMOVED | Deletada 2026-07-02 (plan-tiers-cleanup) — zero call-sites |
| webhook-confirmacao | API_KEY (grace) | OK | Has validateApiKey — grace period ends 2026-07-09 |
| webhook-new-lead | API_KEY (grace) | OK | Has validateApiKey — grace period ends 2026-07-09 |
| webhook-orchestrator | API_KEY | OK | Has x-api-key validation |

### Remaining — low risk, acceptable

| Function | Current Auth | Risk | Notes |
|----------|-------------|------|-------|
| agent-message | SVC_ROLE (internal) | LOW | Called by other edge functions with service_role. Internal only. |
| meeting-webhook | SVC_ROLE (internal) | LOW | Called internally with service_role. |
| google-calendar-webhook | X-Goog-Channel-ID | LOW | Validates channel ID against DB. Google-provided auth. |
