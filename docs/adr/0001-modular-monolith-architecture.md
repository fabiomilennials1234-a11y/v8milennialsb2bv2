# ADR-0001: Modular Monolith Architecture

- **Status**: Accepted
- **Date**: 2026-05-25
- **Decision makers**: Gabriel (CTO)

## Context

Torque CRM grew to 98 edge functions, 50+ shared modules in a flat `_shared/` directory, and 322+ migrations. The `_shared/` folder has no enforced boundaries — any module can import any other module's internals. This causes:

1. **Maintenance pain**: Changing WhatsApp logic breaks Copilot because both share `lead-service`, `pipeline-adapter`, and `copilot/cancellation` without clear contracts.
2. **Onboarding friction**: Dev junior and Claude subagents don't know which functions belong to which domain or what they can safely call.
3. **Future scalability**: No clear path to extract modules (e.g., Copilot AI) to separate runtimes if needed.

Reference: Augusto Galego — "Acabou o hype de microsserviços" (modular monolith pattern).

## Decision

Restructure the backend into **23 domain modules + 1 infra layer** following the modular monolith pattern:

### Domain Modules

| # | Module | Key responsibility |
|---|--------|--------------------|
| 1 | Lead | CRUD, scoring, qualification, tags, custom fields, duplicates, import/export |
| 2 | Pipeline | Stages, entries, movement, distribution rules, all pipe types |
| 3 | Messaging | WhatsApp send/receive, media, templates, instances, history sync, SZ.Chat, gateway |
| 4 | Copilot | AI agents, conversations, turns, RAG, knowledge, prompt building, state machine |
| 5 | Workflow | DAG engine, triggers, conditions, executor, action dispatch |
| 6 | Campaign | Campaigns, sequences, stages, enrollment, mass send |
| 7 | Agenda | Google Calendar, meetings, confirmation, CalCom webhooks |
| 8 | Team | Members, roles, assignment, commissions, goals |
| 9 | Orders | Products, deals, deal items, proposals, approvals |
| 10 | ERP | TinyERP sync: push orders, sync products, NFe, webhooks |
| 11 | Carteira | Portfolio health, post-sale clients, cohort, retention, reorder tracking |
| 12 | Follow-up | Scheduling, automation, cadence, sender |
| 13 | Analytics | Metrics, dashboards, KPIs, rankings (consumer-only) |
| 14 | Notifications | Push, webhooks outbound, dispatch queue, delivery |
| 15 | Marketing | UTM origins, Meta Ads, lead forms, external registration |
| 16 | Gamification | Badges, awards, rankings, competitions, streaks |
| 17 | Organization | Tenant config, plans, quotas, feature flags, onboarding, settings |
| 18 | Activity | Audit timeline (consumer-only, listens to all modules) |
| 19 | Checklist | Template-driven task lists for leads |
| 20 | Communication | Email, SMS, call logs (non-WhatsApp channels) |
| 21 | Deal | Monetary negotiations, value tracking |
| 22 | Billing | Subscription plans, Asaas gateway, quotas |
| 23 | Onboarding | Wizard engine, steps, templates, gate |

### Infra Layer (cross-cutting, free import)

`auth` · `permissions` · `logger` · `sentry` · `cors` · `security-headers` · `edge-framework` · `supabase-admin` · `validation` · `fetch-utils` · `response`

### Module contract (3 parts per module)

1. **Public API** — `index.ts` barrel file exports types, queries, and commands. Only this file can be imported externally.
2. **Events** — `events.ts` defines typed event names and payload interfaces. Each module owns its event definitions.
3. **Listeners** — `listeners.ts` registers handlers for events from other modules. Imports only event types (not functions) from other modules.

### Event mechanism: Hybrid

- **Synchronous** for critical paths where user is waiting (e.g., `message.received` → `Copilot.processTurn()` → `Gateway.sendMessage()`). Direct function call via module's public API.
- **Asynchronous** for side effects (analytics, notifications, score recalculation). Events written to `domain_events` table, consumed by pg_cron or pg_notify.

### Dead letter protection

Events with no registered handler, failed handlers, or timed-out handlers are written to `dead_letter_events` table with reason code (`no_handler_registered` | `handler_failed` | `timeout`). Workflow action dispatch additionally marks the execution step as `failed`.

### File structure enforcement

- Modules live under `_shared/modules/<name>/`
- Only `index.ts` can be imported from outside the module
- Lint rule prohibits importing from `modules/<name>/internal/*`
- Infra modules remain at `_shared/` root level

### Multi-tenancy

Unchanged. `organization_id` filtering via RLS + auth context continues. All event payloads must include `organizationId` (enforced by `BaseEventPayload` interface).

### Migration strategy: 4 waves

1. **Wave 0 — Foundation**: Event bus infrastructure, folder structure, lint rules, module template.
2. **Wave 1 — Critical triangle**: Lead, Messaging (+ gateway unification), Pipeline. Highest pain, most dependencies.
3. **Wave 2 — High value**: Copilot, Workflow, Follow-up, Team. Depend on Wave 1 modules.
4. **Wave 3 — Isolated domains**: Campaign, Agenda, Orders, ERP, Carteira, Deal.
5. **Wave 4 — Support**: Analytics, Activity, Notifications, Communication, Marketing, Gamification, Billing, Onboarding, Checklist, Organization.

### WhatsApp Gateway unification (Wave 1)

Existing `message-gateway.ts` is 80% complete. Remaining work: migrate 5-6 legacy consumers (process-scheduled-user-messages, outbound-sender, dispatch-router, sz-chat-send, send-meta-message) to use the gateway. WhatsApp is the focus; SMS/Email gateway expansion deferred.

## Alternatives considered

### Microservices

Rejected. Team is CTO + 1 junior dev + 3 Claude subagents. Microservices overhead (DevOps, distributed logging, network latency, version management) outweighs benefits at this team size and scale (~30 orgs).

### Keep flat _shared/ with better naming

Rejected. Naming conventions without enforcement erode over time. The problem isn't discoverability — it's that any file can call any other file's internals. Only structural boundaries prevent this.

### Deno workspaces per module

Rejected. Strongest isolation but requires full build system refactor. Disproportionate effort for current needs. Can be adopted later if a module needs extraction — barrel files already define the contract boundary.

## Consequences

**Positive**:
- Clear ownership per module, easier to reason about changes
- New code paths forced through public API, preventing accidental coupling
- Events provide natural audit trail and extensibility
- Gateway unification eliminates duplicate send paths
- Structured preparation for future microservice extraction if needed

**Negative**:
- Upfront migration effort across 4 waves
- Event payloads need careful versioning as system evolves
- Hybrid sync/async model adds complexity vs. pure sync or pure async
- Lint rules need CI enforcement to prevent regression

**Risks**:
- Wave 1 (Lead/Messaging/Pipeline) touches the most fragile areas — needs careful testing
- Existing tests may break during migration if they import internal module paths
- Dead letter table needs monitoring/alerting to avoid silent event loss accumulation
