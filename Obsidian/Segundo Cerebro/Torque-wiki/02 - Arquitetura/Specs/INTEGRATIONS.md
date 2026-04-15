---
tags:
  - torque-crm
  - spec
  - codebase
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/codebase/INTEGRATIONS.md
---

# External Integrations

> Comprehensive map of all external service integrations in the Torque CRM codebase.
> Last updated: 2026-04-01

---

## 1. Backend-as-a-Service (BaaS) -- Supabase

**Service:** Supabase (PostgreSQL, Auth, Edge Functions, Storage, Realtime)
**Purpose:** Core backend infrastructure -- database, authentication, serverless functions, file storage, and real-time subscriptions.
**Implementation:**
- Frontend client: `src/integrations/supabase/client.ts`
- Types: `src/integrations/supabase/types.ts`
- Edge Functions: `supabase/functions/` (60+ functions)
- Shared utilities: `supabase/functions/_shared/`
**Configuration:**
- `VITE_SUPABASE_URL` -- project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` -- anon key (frontend)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` -- server-side (edge functions)
**Authentication:** Supabase Auth with JWT; anon key for frontend, service_role key for server-side operations.
**Environments:**
- Production: `jsjsmuncfkbsbzqzqhfq`
- Development: `bcfadphgsibjzivtbjvc`

---

## 2. Error Monitoring -- Sentry

**Service:** Sentry
**Purpose:** Error tracking and performance monitoring across frontend and edge functions.

### Frontend (React)
**Implementation:** `src/main.tsx`
**SDK:** `@sentry/react`
**Features:** Browser tracing, session replay (10% sample, 100% on error), full trace sampling.
**Configuration:** `VITE_SENTRY_DSN`

### Edge Functions (Deno)
**Implementation:** `supabase/functions/_shared/sentry.ts`
**Approach:** Custom HTTP envelope API (no official Deno SDK). Every edge function is wrapped with `withSentry()` for automatic error capture.
**Configuration:** `SENTRY_DSN`, `ENVIRONMENT`
**Authentication:** Sentry DSN public key extracted from DSN URL.

---

## 3. AI / LLM -- OpenRouter

**Service:** OpenRouter (multi-model AI gateway)
**Purpose:** Powers all AI features: conversational copilot agents, conversation summarization, FAQ generation, custom instruction generation, business context generation, oraculo comercial (sales intelligence), message humanization, natural messaging, workflow AI actions, and agent evaluation.
**Implementation:**
- Client: `supabase/functions/agent-message/openrouter-client.ts`
- Used across 10+ edge functions
**API:** OpenAI-compatible Chat Completions (`https://openrouter.ai/api/v1/chat/completions`)
**Models used:** `google/gemini-2.5-flash-preview` (oraculo), configurable per-agent
**Configuration:**
- `OPENROUTER_API_KEY`
- `OPENROUTER_REFERER_URL` (defaults to `https://v8millennials.com`)
**Authentication:** Bearer token
**Key consumers:**
- `agent-message` -- conversational AI copilot
- `oraculo-comercial` -- sales intelligence chat and TV dashboard analysis
- `summarize-conversation` -- conversation summarization
- `evaluate-agent-conversation` -- LLM-as-a-judge quality evaluation
- `generate-faqs` / `generate-agent-examples` / `generate-business-context` / `generate-custom-instructions` -- content generation
- `_shared/message-humanizer.ts` -- humanize automated messages
- `_shared/natural-messaging.ts` -- smart message splitting
- `_shared/workflow-action-handler.ts` -- AI actions in workflows

---

## 4. AI / Embeddings -- OpenAI

**Service:** OpenAI Embeddings API
**Purpose:** Generates vector embeddings for RAG (FAQ search, document processing).
**Implementation:** `supabase/functions/_shared/embeddings.ts`
**Model:** `text-embedding-3-small` (dimension 1536)
**API:** `https://api.openai.com/v1/embeddings`
**Configuration:** API key passed per-organization (from DB, not global env var)
**Authentication:** Bearer token
**Key consumers:**
- `generate-faq-embeddings` -- FAQ vectorization
- `process-agent-document` -- document chunking and embedding

---

## 5. Voice / TTS -- ElevenLabs

**Service:** ElevenLabs
**Purpose:** Text-to-speech for voice note responses and voice cloning.
**Implementation:**
- TTS: `supabase/functions/_shared/tts-elevenlabs.ts`
- Proxy: `supabase/functions/elevenlabs-proxy/index.ts`
**API endpoints:**
- `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}` -- TTS generation
- `https://api.elevenlabs.io/v1/voices` -- voice listing
- `https://api.elevenlabs.io/v1/voices/add` -- voice cloning
**Model:** `eleven_multilingual_v2`
**Configuration:**
- `ELEVENLABS_API_KEY` (fallback env var)
- Per-org key: `organizations.elevenlabs_api_key` (DB)
**Authentication:** `xi-api-key` header
**Audio storage:** Generated audio uploaded to Supabase Storage (`media` bucket, `tts-audio/` prefix)

---

## 6. WhatsApp -- Evolution API

**Service:** Evolution API (self-hosted WhatsApp integration via Baileys)
**Purpose:** WhatsApp instance management, messaging (text, media, audio), QR code connection.
**Implementation:**
- Frontend client: `src/lib/evolutionApi.ts` (calls via Supabase edge function proxy)
- Proxy: `supabase/functions/evolution-api-proxy/index.ts`
- Webhook: `supabase/functions/evolution-webhook/index.ts`
- Shared senders: `_shared/outbound-sender.ts`, `_shared/audio-sender.ts`, `_shared/followup-sender.ts`, `_shared/workflow-action-handler.ts`, `_shared/ai-action-executor.ts`
**Configuration:**
- `EVOLUTION_API_URL` -- base URL of the Evolution API server
- `EVOLUTION_API_KEY` -- API key
- `EVOLUTION_WEBHOOK_SECRET` -- webhook signature validation
**Authentication:** `apikey` header
**Key operations:**
- Instance CRUD (`/instance/create`, `/instance/delete`, `/instance/connect`)
- Send text (`/message/sendText`)
- Send media (`/message/sendMedia`)
- Send audio voice note (`/message/sendWhatsAppAudio`)
- Connection state polling (`/instance/connectionState`)

---

## 7. Chat Platform -- SZ.chat (Fortics/Alamaster)

**Service:** SZ.chat (Fortics Alamaster)
**Purpose:** Omnichannel chat platform used as WhatsApp infrastructure for message sending, session management, and team routing.
**Implementation:**
- Send: `supabase/functions/sz-chat-send/index.ts`
- Webhook: `supabase/functions/sz-chat-webhook/index.ts`
**API endpoints:**
- `{api_url}/auth/login` -- authentication
- `{api_url}/auth/refresh` -- token refresh
- `{api_url}/message/send` -- send message
- `{api_url}/attendances/transfer` -- transfer session to team
- `{api_url}/attendances/finish` -- end session
**Configuration:**
- `SZ_CHAT_AGENT_EMAIL` / `SZ_CHAT_AGENT_PASSWORD` -- agent credentials (env vars)
- Per-org config stored in `sz_chat_config` table (api_url, api_token, channel_id, team_mappings, webhook_secret)
**Authentication:** Bearer token (JWT from login, auto-refreshed)
**Webhook events handled:**
- `client_message` -- incoming contact messages
- `attendance_transfer` / `humanTransferAgent` -- session transferred to team
- `enter_queue` / `waitStart` -- session entered queue
- `attendance_finish` / `humanFinish` -- session ended

---

## 8. Payments -- Asaas

**Service:** Asaas (Brazilian payment gateway)
**Purpose:** Payment processing (PIX, credit card), subscription management, customer management for the SaaS checkout flow.
**Implementation:**
- Shared client: `supabase/functions/_shared/asaas.ts`
- Payment creation: `supabase/functions/checkout-create-payment/index.ts`
- Org provisioning: `supabase/functions/checkout-provision-org/index.ts`
- Webhook: `supabase/functions/asaas-webhook/index.ts`
**API:** `https://api.asaas.com/v3`
**Configuration:**
- `ASAAS_API_URL` -- API base URL
- `ASAAS_API_KEY` -- API key
- `ASAAS_WEBHOOK_TOKEN` -- webhook authentication token
**Authentication:** `access_token` header
**Key operations:**
- Customer management: create, find by email
- One-time PIX payments: create, get QR code
- Recurring credit card subscriptions: create
- Payment status retrieval
**Webhook events:**
- `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` -- triggers org provisioning or status update
- `PAYMENT_OVERDUE` -- marks org as overdue
- `PAYMENT_DELETED` / `PAYMENT_REFUNDED` -- suspends org
- `SUBSCRIPTION_DELETED` -- cancels subscription

---

## 9. Meta Platform (Facebook/Instagram)

**Service:** Meta Graph API (v21.0)
**Purpose:** Messenger/Instagram Direct messaging, Lead Ads form ingestion, OAuth for page connections, ad insights analytics.
**Implementation:**
- Shared API: `supabase/functions/_shared/meta-api.ts`
- Webhook receiver: `supabase/functions/meta-webhook/index.ts`
- OAuth callback: `supabase/functions/meta-oauth-callback/index.ts`
- Message sending: `supabase/functions/send-meta-message/index.ts`
- Token refresh: `supabase/functions/refresh-meta-tokens/index.ts`
- Lead forms: `supabase/functions/list-lead-forms/index.ts`
- Ads insights: `supabase/functions/meta-ads-insights/index.ts`
**API base:** `https://graph.facebook.com/v21.0`
**Configuration:**
- `META_APP_ID` / `META_APP_SECRET` -- Facebook app credentials
- `META_REDIRECT_URI` -- OAuth redirect
- `META_WEBHOOK_VERIFY_TOKEN` -- webhook verification token
- `META_ADS_ACCESS_TOKEN` / `META_ADS_ACCOUNT_ID` -- Ads API access
**Authentication:** OAuth 2.0 (short-lived -> long-lived token exchange), HMAC-SHA256 webhook signature verification
**OAuth scopes:** `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `pages_manage_ads`, `instagram_manage_messages`, `instagram_basic`, `leads_retrieval`
**Webhook events:**
- `messages` / `messaging_postbacks` -- Messenger/Instagram messaging
- `leadgen` -- Lead Ads form submissions
- `feed` -- Page feed events

---

## 10. Google Calendar

**Service:** Google Calendar API
**Purpose:** Calendar integration for scheduling, event sync, and push notifications.
**Implementation:**
- Shared utils: `supabase/functions/_shared/google-calendar-utils.ts`
- Edge functions: `google-calendar-connect`, `google-calendar-callback`, `google-calendar-disconnect`, `google-calendar-events`, `google-calendar-sharing`, `google-calendar-webhook`
**API endpoints:**
- `https://oauth2.googleapis.com/token` -- token refresh
- `https://www.googleapis.com/calendar/v3/calendars/primary/events/watch` -- push notification registration
- `https://www.googleapis.com/calendar/v3/channels/stop` -- cancel watch
- Calendar events CRUD
**Configuration:**
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_CALENDAR_ENCRYPTION_KEY` -- AES-256-GCM key for encrypting refresh tokens at rest
**Authentication:** OAuth 2.0 with refresh token; tokens encrypted with AES-256-GCM and stored in `google_calendar_tokens` table.
**Frontend service:** `VITE_CALENDAR_SERVICE_URL` -- points to a separate calendar microservice (localhost:8000 in dev)

---

## 11. Cal.com (Scheduling)

**Service:** Cal.com
**Purpose:** External scheduling platform -- receives webhook events when meetings are booked, creates/updates leads, assigns closers.
**Implementation:** `supabase/functions/webhook-calcom/index.ts`
**Configuration:** `CALCOM_WEBHOOK_SECRET` -- HMAC signature validation
**Authentication:** Webhook signature verification
**Events handled:** `BOOKING_CREATED` -- new meeting scheduled (creates lead or merges with existing, assigns closer, creates pipe_confirmacao entry)

---

## 12. TinyERP

**Service:** TinyERP (Brazilian ERP)
**Purpose:** Product catalog sync, order/invoice push (NFe), upsell order creation.
**Implementation:**
- Shared utils: `supabase/functions/_shared/tinyerp-utils.ts`
- Edge functions: `tinyerp-connect`, `tinyerp-disconnect`, `tinyerp-proxy`, `tinyerp-sync-products`, `tinyerp-push-order`, `tinyerp-push-upsell-order`, `tinyerp-fetch-nfe`, `tinyerp-webhook`
**API base:** `https://api.tiny.com.br/api2`
**Configuration:**
- `TINYERP_ENCRYPTION_KEY` -- AES-256-GCM key for encrypting API tokens at rest
- Per-org API token stored encrypted in `tinyerp_connections` table
**Authentication:** Token passed via form-encoded body
**Key operations:**
- Product sync (list/sync products from Tiny to local DB)
- Push order / upsell order to Tiny
- Fetch NFe (Nota Fiscal)
- Webhook receives status updates from Tiny

---

## 13. External Client Registration API (Cadastro Externo)

**Service:** Sistema Millennials (internal product management system)
**Purpose:** Pushes new client data from CRM to the external Millennials platform for automatic client registration.
**Implementation:** `supabase/functions/cadastro-externo-push/index.ts`
**Configuration:**
- `CADASTRO_EXTERNO_API_KEY` -- Bearer token
- `CADASTRO_EXTERNO_URL` -- API base URL
**Authentication:** Bearer token

---

## Edge Functions Summary

| Function | External Service | Purpose |
|---|---|---|
| `agent-message` | OpenRouter | AI copilot message processing |
| `asaas-webhook` | Asaas | Payment event handler |
| `cadastro-externo-push` | Millennials API | Push client registrations |
| `checkout-create-payment` | Asaas | Create PIX/card payments |
| `checkout-provision-org` | Asaas (internal) | Provision org after payment |
| `elevenlabs-proxy` | ElevenLabs | Voice listing and cloning |
| `evaluate-agent-conversation` | OpenRouter | AI quality evaluation |
| `evolution-api-proxy` | Evolution API | WhatsApp proxy |
| `evolution-webhook` | Evolution API | WhatsApp event handler |
| `generate-agent-examples` | OpenRouter | AI content generation |
| `generate-business-context` | OpenRouter | AI content generation |
| `generate-custom-instructions` | OpenRouter | AI content generation |
| `generate-faq-embeddings` | OpenAI | Vector embeddings |
| `generate-faqs` | OpenRouter | AI FAQ generation |
| `google-calendar-callback` | Google | OAuth callback |
| `google-calendar-connect` | Google | OAuth initiation |
| `google-calendar-disconnect` | Google | Revoke access |
| `google-calendar-events` | Google Calendar | Event CRUD |
| `google-calendar-sharing` | Google Calendar | Calendar sharing |
| `google-calendar-webhook` | Google Calendar | Push notification handler |
| `lead-webhook` | -- | Inbound lead receiver (generic) |
| `list-lead-forms` | Meta Graph API | List Facebook lead forms |
| `meta-ads-insights` | Meta Graph API | Ad campaign analytics |
| `meta-oauth-callback` | Meta | OAuth callback |
| `meta-webhook` | Meta | Messenger/IG/leadgen events |
| `oraculo-comercial` | OpenRouter | Sales intelligence AI |
| `outbound-trigger` | Evolution API (via sender) | Outbound message dispatch |
| `process-agent-document` | OpenAI | Document embedding |
| `process-ai-actions` | OpenRouter | Execute AI workflow actions |
| `process-copilot-followups` | OpenRouter, Evolution | AI follow-up processing |
| `process-followup-automations` | Evolution API (via sender) | Scheduled follow-up messages |
| `process-outbound-dispatches` | Evolution API (via sender) | Outbound campaign dispatch |
| `process-scheduled-user-messages` | Evolution API (via sender) | Scheduled message delivery |
| `process-webhook-deliveries` | External URLs | Outbound webhook delivery worker |
| `process-workflow-executions` | OpenRouter, Evolution | Workflow engine execution |
| `refresh-meta-tokens` | Meta Graph API | Token refresh cron |
| `send-meta-message` | Meta Graph API | Send Messenger/IG messages |
| `semi-automatic-dispatch` | Evolution API (via sender) | Semi-auto outbound |
| `stream-media` | Supabase Storage | Media proxy for CORS |
| `summarize-conversation` | OpenRouter | AI conversation summary |
| `sz-chat-send` | SZ.chat API | Send messages via SZ.chat |
| `sz-chat-webhook` | SZ.chat | Incoming SZ.chat events |
| `tinyerp-connect` | TinyERP | API token connection |
| `tinyerp-disconnect` | TinyERP | Disconnect integration |
| `tinyerp-fetch-nfe` | TinyERP | Fetch invoices |
| `tinyerp-proxy` | TinyERP | Generic API proxy |
| `tinyerp-push-order` | TinyERP | Push sales orders |
| `tinyerp-push-upsell-order` | TinyERP | Push upsell orders |
| `tinyerp-sync-products` | TinyERP | Product catalog sync |
| `tinyerp-webhook` | TinyERP | Status update handler |
| `webhook-calcom` | Cal.com | Meeting booking handler |
| `webhook-confirmacao` | -- | Confirmation flow |
| `webhook-new-lead` | -- | New lead processing |
| `webhook-orchestrator` | -- | Fan-out webhook delivery |
| `webhook-send-test` | External URLs | Test webhook delivery |
| `webhook-validate-url` | External URLs | URL reachability check |

---

## Webhooks (Inbound)

### Asaas Payment Webhooks
**Handler:** `supabase/functions/asaas-webhook/index.ts`
**Authentication:** `asaas-access-token` header vs `ASAAS_WEBHOOK_TOKEN`
**Events:** `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_REFUNDED`, `SUBSCRIPTION_DELETED`

### Meta (Facebook/Instagram) Webhooks
**Handler:** `supabase/functions/meta-webhook/index.ts`
**Authentication:** `X-Hub-Signature-256` HMAC-SHA256 verification
**Events:** Messages (Messenger/Instagram), leadgen (Lead Ads), feed

### Evolution API Webhooks
**Handler:** `supabase/functions/evolution-webhook/index.ts`
**Authentication:** `EVOLUTION_WEBHOOK_SECRET` header validation
**Events:** WhatsApp message events, connection state changes

### SZ.chat Webhooks
**Handler:** `supabase/functions/sz-chat-webhook/index.ts`
**Authentication:** `x-webhook-secret` / `x-sz-webhook-key` header vs per-org `webhook_secret`
**Events:** `client_message`, `attendance_transfer`, `humanTransferAgent`, `enter_queue`, `waitStart`, `attendance_finish`, `humanFinish`

### Cal.com Webhooks
**Handler:** `supabase/functions/webhook-calcom/index.ts`
**Authentication:** `CALCOM_WEBHOOK_SECRET` HMAC signature
**Events:** `BOOKING_CREATED`

### TinyERP Webhooks
**Handler:** `supabase/functions/tinyerp-webhook/index.ts`
**Events:** Order/NFe status updates

### Google Calendar Push Notifications
**Handler:** `supabase/functions/google-calendar-webhook/index.ts`
**Authentication:** Channel ID + resource ID verification
**Events:** Calendar event changes

### Generic Lead Webhook
**Handler:** `supabase/functions/lead-webhook/index.ts`
**Authentication:** `x-webhook-key` header vs `WEBHOOK_API_KEY`
**Purpose:** Receives leads from any source (Meta Ads, Google Ads, landing pages, n8n, etc.)

### Webhook Orchestrator (API Gateway)
**Handler:** `supabase/functions/webhook-orchestrator/index.ts`
**Purpose:** Multi-tenant API for external lead processing with validation and deduplication

---

## Webhooks (Outbound)

### Custom Webhook Deliveries
**Implementation:** `supabase/functions/process-webhook-deliveries/index.ts`, `supabase/functions/_shared/webhook-utils.ts`
**Purpose:** User-configured outbound webhooks that fire on CRM events (lead created, status changed, etc.)
**Features:** Configurable URL/method/headers, HMAC signing, exponential backoff retry, dead letter queue
**Trigger:** pg_cron (every minute) via `CRON_SECRET` header

---

## Background Jobs / Cron

| Job | Function | Schedule | External Service |
|---|---|---|---|
| Webhook delivery worker | `process-webhook-deliveries` | pg_cron (1 min) | External URLs |
| Follow-up automations | `process-followup-automations` | pg_cron | Evolution API |
| Copilot follow-ups | `process-copilot-followups` | pg_cron | OpenRouter + Evolution |
| Outbound dispatches | `process-outbound-dispatches` | pg_cron | Evolution API |
| Scheduled user messages | `process-scheduled-user-messages` | pg_cron | Evolution API |
| Workflow executions | `process-workflow-executions` | pg_cron | OpenRouter + Evolution |
| Meta token refresh | `refresh-meta-tokens` | pg_cron | Meta Graph API |
| Dead letter retry | `retry-dead-letter-jobs` | pg_cron | Various |
| Automation jobs | `get-automation-jobs` | On-demand | -- |

---

## Environment Variables -- Complete Reference

### Frontend (VITE_ prefix)
| Variable | Service |
|---|---|
| `VITE_SUPABASE_URL` | Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase |
| `VITE_SUPABASE_PROJECT_ID` | Supabase |
| `VITE_SENTRY_DSN` | Sentry |
| `VITE_CALENDAR_SERVICE_URL` | Google Calendar microservice |
| `VITE_MILENNIALS_ORG_ID` | Feature gating |
| `VITE_INTERNAL_API_KEY` | Edge function auth (optional) |
| `VITE_DISABLE_CONSOLE_LOGS` | Logging |

### Edge Functions (Supabase Secrets)
| Variable | Service |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase (auto-injected) |
| `OPENROUTER_API_KEY` | OpenRouter AI |
| `OPENROUTER_REFERER_URL` | OpenRouter |
| `SENTRY_DSN` | Sentry |
| `ENVIRONMENT` | Sentry |
| `EVOLUTION_API_URL` | Evolution API |
| `EVOLUTION_API_KEY` | Evolution API |
| `EVOLUTION_WEBHOOK_SECRET` | Evolution API webhooks |
| `SZ_CHAT_AGENT_EMAIL` | SZ.chat |
| `SZ_CHAT_AGENT_PASSWORD` | SZ.chat |
| `ASAAS_API_URL` | Asaas |
| `ASAAS_API_KEY` | Asaas |
| `ASAAS_WEBHOOK_TOKEN` | Asaas webhooks |
| `META_APP_ID` | Meta |
| `META_APP_SECRET` | Meta |
| `META_REDIRECT_URI` | Meta OAuth |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta webhooks |
| `META_ADS_ACCESS_TOKEN` | Meta Ads |
| `META_ADS_ACCOUNT_ID` | Meta Ads |
| `GOOGLE_CLIENT_ID` | Google Calendar |
| `GOOGLE_CLIENT_SECRET` | Google Calendar |
| `GOOGLE_REDIRECT_URI` | Google Calendar |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Google Calendar token encryption |
| `CALCOM_WEBHOOK_SECRET` | Cal.com |
| `TINYERP_ENCRYPTION_KEY` | TinyERP token encryption |
| `ELEVENLABS_API_KEY` | ElevenLabs |
| `CADASTRO_EXTERNO_API_KEY` | Millennials API |
| `CADASTRO_EXTERNO_URL` | Millennials API |
| `INTERNAL_API_KEY` | Internal edge function auth |
| `WEBHOOK_API_KEY` | Generic webhook auth |
| `CRON_SECRET` | pg_cron job auth |
| `ALLOWED_ORIGINS` | CORS (production: torquecrm.com.br) |

### Deploy / Infrastructure (not used in app runtime)
| Variable | Service |
|---|---|
| `HOSTINGER_API_TOKEN` | Hostinger VPS deploy |
| `HOSTINGER_VPS_ID` | Hostinger VPS |
| `VPS_HOST` / `VPS_USER` / `VPS_PATH` | VPS rsync deploy |


## Links relacionados

- [[MOC - Arquitetura]]

- [[Produtos]]

- [[Analise Logging SaaS]]

- [[TV Dashboard]]

- [[Checkout e Planos]]

- [[Webhooks]]

- [[n8n Orquestracao]]

- [[Permissoes Sistema]]

- [[SZ Chat]]

- [[Dashboard]]

- [[Upsell]]

- [[Oraculo Comercial]]

- [[OpenRouter Setup]]

- [[Asaas Pagamentos]]

- [[Meta Facebook]]

- [[Google Calendar]]

- [[TinyERP]]

- [[Pipe Confirmacao]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
