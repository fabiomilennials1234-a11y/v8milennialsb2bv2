---
tags:
  - torque-crm
  - spec
  - codebase
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/codebase/ARCHITECTURE.md
---

# Architecture

**Pattern:** Multi-tenant SaaS CRM - React SPA + Supabase BaaS + Edge Functions + External Microservices

## High-Level Structure

The system is a B2B CRM/Sales platform ("Torque CRM") built as a Vite-powered React SPA communicating with Supabase (Postgres + Auth + Realtime + Edge Functions). All data is tenant-isolated via `organization_id` filtering enforced at both the frontend hook layer and database RLS. A secondary orchestration layer (TypeScript agent system) reads markdown directives and executes tasks. External microservices (Python/FastAPI) handle integrations like Google Calendar.

**Stack:** React 18, TypeScript, Vite, TanStack React Query, Supabase JS SDK, Tailwind CSS, shadcn/ui (Radix primitives), next-themes, react-router-dom v6.

## Identified Patterns

### Multi-Tenant Organization Isolation
**Location:** `src/hooks/useOrganization.ts`, every data hook
**Purpose:** Ensure all queries are scoped to the current user's organization
**Implementation:** `useOrganization()` resolves `organizationId` from `team_members` table via the authenticated user. Every data-fetching hook (e.g., `useLeads`, `useWorkflows`, `useWhatsAppInstances`) calls `useOrganization()` and filters `.eq("organization_id", organizationId)`. Hooks are disabled (`enabled: false`) until `isReady` is true.
**Example:** `src/hooks/useLeads.ts` - lines 20-61 show the pattern: get orgId, guard with `enabled: isReady`, filter all queries by orgId.

### Server State via TanStack Query
**Location:** `src/hooks/` (110+ custom hooks)
**Purpose:** All server state management, caching, and mutation
**Implementation:** Every data operation uses `useQuery` for reads and `useMutation` for writes. QueryClient configured with 5min staleTime, 10min gcTime, no refetch-on-focus. Cache invalidation is handled via `queryClient.invalidateQueries` in mutation `onSuccess` callbacks. No Redux or Zustand - React Query is the sole server-state layer.
**Example:** `src/hooks/useWorkflows.ts` - standard CRUD pattern with `useQuery`/`useMutation`.

### Realtime Subscriptions with Debounced Invalidation
**Location:** `src/hooks/useRealtimeSubscription.ts`
**Purpose:** Live data updates via Supabase Realtime (Postgres Changes)
**Implementation:** Subscribes to `postgres_changes` on a table, filtered by `organization_id` where possible. On change, debounces 2s then invalidates React Query cache keys. Secondary keys are staggered by an additional 2s to avoid DB overload.
**Example:** `useLeads` subscribes to the `leads` table and invalidates `["leads", "pipe_whatsapp", "pipe_confirmacao", ...]`.

### Layered Permission Cascade
**Location:** `src/lib/permissions.ts`, `src/hooks/usePermissions.ts`, `src/hooks/useMasterAuth.ts`
**Purpose:** Four-tier authorization: Master > Admin > Org Role Permissions > Member Feature Permissions
**Implementation:** `useCanPerformAction(action)` checks: (1) master_users table, (2) admin role, (3) feature_permissions via `useFeaturePermissions()`, (4) org_permissions via RPC `user_has_org_permission`, (5) legacy team_member_permissions matrix. Route-level gating uses `PermissionProtectedRoute` with `featureKey` props (e.g., `"pipeline.view"`).
**Example:** `src/lib/permissions.ts` - the `ACTION_TO_FEATURE` / `ACTION_TO_MATRIX` mappings and cascade logic.

### Feature Gating by Plan
**Location:** `src/contexts/OrgFeaturesContext.tsx`, `src/lib/feature-registry.ts`
**Purpose:** Control module access and limits based on the organization's subscription plan
**Implementation:** `OrgFeaturesProvider` calls RPC `org_get_features_and_limits` returning a features map and limits map. `useOrgFeatures()` exposes `hasFeature(key)` and `checkLimit(key)`. Feature keys are typed via `FeatureKey` union (~30 keys) and `LimitKey`.
**Example:** `src/lib/feature-registry.ts` defines the canonical feature/limit keys.

### Lazy-Loaded Routes with Retry
**Location:** `src/App.tsx`
**Purpose:** Code-split every page into separate chunks; auto-retry on chunk load failure (common post-deploy)
**Implementation:** All ~40 page components use `lazy(() => lazyRetry(() => import(...)))` with a 2-retry mechanism and 1s delay. Routes are wrapped in `<Suspense>` with a spinner fallback.
**Example:** `src/App.tsx` - `lazyRetry` helper, lines 21-33.

### Supabase Edge Functions as Backend
**Location:** `supabase/functions/` (75+ functions), `supabase/functions/_shared/`
**Purpose:** Server-side logic - webhooks, AI processing, payment, integrations, workflow execution
**Implementation:** Deno-based edge functions called via `supabase.functions.invoke()` or direct fetch to `${SUPABASE_URL}/functions/v1/<name>`. Shared utilities in `_shared/` include CORS, auth, validation, workflow executor, AI queue, and integration clients (Evolution API, SZChat, Meta, TinyERP, Asaas, ElevenLabs).
**Example:** `supabase/functions/checkout-create-payment/`, `supabase/functions/process-workflow-executions/`.

### Orchestration Agent System
**Location:** `orchestration/`, `directives/`, `execution/`
**Purpose:** AI/automation agent that reads markdown directives and executes tasks
**Implementation:** TypeScript modules - `Agent` (main loop), `DirectiveReader` (parses markdown directives), `Executor` (runs actions). Directives are categorized: `business/` (campaign processing, lead distribution), `data_processing/` (imports, exports, reports), `integrations/` (webhooks, API sync). Execution scripts live in `execution/` (bash deploy scripts, Python/TS runners).
**Example:** `orchestration/index.ts` exports Agent, DirectiveReader, Executor.

## Data Flow

### Authentication
1. User submits credentials → `AuthContext.signIn()` → `supabase.auth.signInWithPassword()`
2. `onAuthStateChange` fires → sets `user`/`session` in React state
3. On sign-in, calls Edge Function `attach-to-org-by-pending-invite` to auto-link user to org if pre-invited
4. `ProtectedRoute` checks: user exists → team_member exists → org linked → member active → render children
5. If no org/team_member → redirect to `/checkout`

### CRUD Operations (e.g., Leads)
1. Component calls `useLeads(page)` hook
2. Hook calls `useOrganization()` to get `organizationId`; waits for `isReady`
3. `useQuery` fetches from Supabase: `supabase.from("leads").select(...).eq("organization_id", orgId)`
4. `useRealtimeSubscription("leads", [...])` subscribes to Postgres changes filtered by orgId
5. On remote change → debounced React Query cache invalidation → automatic refetch
6. Mutations use `useMutation` → `supabase.from("leads").insert/update/delete` → `onSuccess` invalidates cache

### Subscription & Plan Enforcement
1. `OrgFeaturesProvider` loads plan features via RPC `org_get_features_and_limits`
2. `SubscriptionProtectedRoute` wraps layout; calls `checkSubscription()` via RPC `org_get_subscription_status`
3. Routes use `PermissionProtectedRoute featureKey="X"` for module-level gating
4. Hooks use `useCanPerformAction(action)` for action-level gating

### Workflow/Automation Execution
1. User creates workflow in `AutomacoesEditor` page (visual node editor)
2. Workflow saved to `workflows` table with JSON `nodes`/`edges`
3. Triggers fire via Edge Function `process-workflow-executions`
4. Shared `_shared/workflow-executor.ts` evaluates conditions and executes actions
5. Execution logs stored in `workflow_executions` / `workflow_execution_steps`

## Code Organization

**Approach:** Hybrid - domain-grouped components with shared hooks/lib layer

**Structure:**
```
src/
  components/       # UI - domain folders (leads/, kanban/, chat/, copilot/, etc.)
    ui/             # shadcn/ui primitives (54 components)
    layout/         # MainLayout, TopNavigation
    master/         # Master admin area components
  contexts/         # React contexts (Auth, OrgFeatures, ThemeTransition)
  hooks/            # 110+ custom hooks - all server state lives here
  integrations/     # Supabase client + auto-generated types
  lib/              # Utilities (permissions, analytics, logger, feature-registry, pricing)
  pages/            # Route-level page components (~45 pages)
    master/         # Master admin pages
  types/            # TypeScript type definitions (workflow, copilot)
  styles/           # Global CSS
supabase/
  functions/        # 75+ Deno edge functions
    _shared/        # Shared server utilities (auth, CORS, workflow engine, AI, integrations)
  migrations/       # 292 SQL migrations
orchestration/      # Agent/directive system (TypeScript)
directives/         # Markdown directives for the orchestration agent
execution/          # Scripts and runners (bash, Python, TypeScript)
services/           # External microservices (google-calendar-service - Python/FastAPI)
```

**Module boundaries:**
- **Frontend hooks** are the data access layer - components never call Supabase directly
- **Edge functions** are the server logic layer - called via SDK or HTTP
- **Contexts** are minimal (3 total) - Auth, OrgFeatures, ThemeTransition; no global state bloat
- **Components** are domain-grouped (e.g., `components/leads/`, `components/kanban/`) with `components/ui/` as the shared primitive layer
- **Database** is the source of truth for permissions, features, and subscriptions - all enforced via RPCs and RLS, not just frontend checks


## Links relacionados

- [[MOC - Arquitetura]]

- [[Checkout e Planos]]

- [[Master Admin]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Workflow Builder]]

- [[Asaas Pagamentos]]

- [[Google Calendar]]

- [[TinyERP]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
