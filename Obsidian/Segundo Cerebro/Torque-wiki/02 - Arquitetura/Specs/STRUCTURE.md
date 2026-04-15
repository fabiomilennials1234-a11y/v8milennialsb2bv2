---
tags:
  - torque-crm
  - spec
  - codebase
created: 2026-04-14
last_updated: 2026-04-14
last_verified: 2026-04-14
status: active
source: .specs/codebase/STRUCTURE.md
source_of_truth:
  - src/
  - supabase/
  - package.json
---

# Project Structure

**Root:** repositorio (path relativo — nunca usar paths absolutos de maquina local)
**Stack:** React 18 + TypeScript + Vite + Supabase + TailwindCSS + shadcn/ui
**Product:** Multi-tenant B2B CRM (TorqueCRM) with WhatsApp integration, AI copilot, workflow automation, and sales pipeline management.

## Directory Tree

```
.
├── src/                          # Frontend React app
│   ├── App.tsx                   # Root router + providers (lazy-loaded routes)
│   ├── main.tsx                  # Entry point
│   ├── assets/                   # Static images (logos, icons)
│   ├── components/               # UI components (feature-grouped)
│   │   ├── analytics/            # Charts, filters, error boundary (tabs/, charts/)
│   │   ├── api-docs/             # API documentation UI
│   │   ├── automacoes/           # Workflow editor (WorkflowCanvas, nodes/, edges/, sidebar-panels/)
│   │   ├── badges/               # Gamification badge components
│   │   ├── branding/             # Brand identity components
│   │   ├── campanhas/            # Campaign management components
│   │   ├── chat/                 # WhatsApp chat UI (EmbeddedChatWindow, ConversationNotes, etc.)
│   │   ├── checklists/           # Checklist components
│   │   ├── checkout/             # Checkout wizard (PlanSelector, PaymentStep, PixQRCode, etc.)
│   │   ├── comissoes/            # Commission management
│   │   ├── confirmacao/          # Confirmation pipeline components
│   │   ├── copilot/              # AI copilot (wizard/, wizard-steps/, wizard-configs/, playground/)
│   │   ├── custom-pipelines/     # Custom pipeline management
│   │   ├── dashboard/            # Dashboard widgets (KPICard, charts, OraculoChat, etc.)
│   │   ├── dashboard-outbound/   # Outbound-specific dashboard
│   │   ├── followups/            # Follow-up management
│   │   ├── funis/                # Sales funnels hub
│   │   ├── gamification/         # Gamification features
│   │   ├── kanban/               # Kanban board (DraggableKanbanBoard, KanbanCard)
│   │   ├── landing/              # Public landing page sections
│   │   ├── layout/               # MainLayout, TopNavigation, Sidebar, OrgSwitcher
│   │   ├── leads/                # Lead management (LeadDetailDrawer, ImportLeads, etc.)
│   │   ├── marketing/            # Marketing origin config
│   │   ├── master/               # Super-admin/master panel components
│   │   ├── notifications/        # Notification components
│   │   ├── onboarding/           # Onboarding wizard (OnboardingGate, steps/)
│   │   ├── performance/          # Performance tracking
│   │   ├── pipelines/            # Pipeline configuration
│   │   ├── products/             # Product management
│   │   ├── proposals/            # Proposal components
│   │   ├── ranking/              # Ranking/leaderboard
│   │   ├── revisao/              # Review pipeline
│   │   ├── settings/             # Settings panels (integrations, profile, etc.)
│   │   ├── shared/               # Shared reusable components (CreateNewModal, EmptyState, etc.)
│   │   ├── subscription/         # Subscription gate (OverdueBanner, SubscriptionBlockedPage)
│   │   ├── team/                 # Team member management
│   │   ├── tv/                   # TV dashboard mode
│   │   ├── ui/                   # 52 shadcn/ui primitives (button, dialog, card, etc.)
│   │   └── upsell/               # Upsell module
│   ├── contexts/                 # React contexts
│   │   ├── AuthContext.tsx        # Auth state (signIn, signUp, signOut)
│   │   ├── OrgFeaturesContext.tsx # Plan features & limits (hasFeature, checkLimit)
│   │   └── ThemeTransitionContext.tsx
│   ├── hooks/                    # 110+ custom hooks
│   │   ├── useOrganization.ts    # Org context (org_id, role, orgType)
│   │   ├── useLeads.ts           # CRUD leads + batch operations
│   │   ├── useWorkflows.ts       # Workflow CRUD
│   │   ├── usePermissions.ts     # Permission checks
│   │   ├── useTeamMembers.ts     # Team member queries
│   │   ├── useCopilotAgents.ts   # AI agent management
│   │   ├── useWhatsApp*.ts       # WhatsApp integration hooks
│   │   ├── usePipe*.ts           # Pipeline stage hooks
│   │   ├── useAnalytics*.ts      # Analytics data hooks
│   │   └── ...                   # (useGoals, useCampanhas, useFollowUps, etc.)
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts         # Supabase client singleton
│   │       └── types.ts          # Auto-generated DB types
│   ├── lib/                      # Utility libraries
│   │   ├── utils.ts              # cn() helper (clsx + tailwind-merge)
│   │   ├── permissions.ts        # Permission engine (usePermission, useCanPerformAction)
│   │   ├── analytics.ts          # Analytics tracking
│   │   ├── feature-registry.ts   # Feature flag registry
│   │   ├── subscription.ts       # Subscription logic
│   │   ├── copilot/              # Copilot prompt utilities
│   │   ├── api-docs/             # API doc generators
│   │   └── ...                   # (logger, whatsapp, evolutionApi, template-variables, etc.)
│   ├── pages/                    # Route-level page components (45+ pages)
│   │   ├── Dashboard.tsx
│   │   ├── Leads.tsx
│   │   ├── Automacoes.tsx / AutomacoesEditor.tsx
│   │   ├── ChatWhatsApp.tsx
│   │   ├── Copilot.tsx / CopilotMetrics.tsx
│   │   ├── Campanhas.tsx / CampanhaDetail.tsx
│   │   ├── PipeWhatsapp.tsx / PipeConfirmacao.tsx / PipePropostas.tsx / PipeFollowUps.tsx
│   │   ├── Checkout.tsx / CheckoutSuccess.tsx
│   │   ├── Landing.tsx / Signup.tsx / Auth.tsx
│   │   ├── master/               # Master admin pages (7 pages)
│   │   │   ├── MasterDashboard.tsx
│   │   │   ├── MasterOrganizations.tsx
│   │   │   ├── MasterUsers.tsx
│   │   │   ├── MasterPlans.tsx
│   │   │   ├── MasterFeatures.tsx
│   │   │   ├── MasterOperations.tsx
│   │   │   └── MasterAuditLogs.tsx
│   │   └── ...                   # (Equipe, Comissoes, Marketing, Analytics, etc.)
│   ├── styles/
│   │   └── landing.css           # Landing page styles
│   ├── test/
│   │   └── setup.ts              # Test setup
│   └── types/
│       ├── copilot.ts            # Copilot type definitions
│       ├── workflow.ts           # Workflow type definitions
│       └── workflowPortability.ts
├── supabase/                     # Supabase backend
│   ├── config.toml               # Supabase local config
│   ├── seed.sql                  # Seed data
│   ├── migrations/               # 292 SQL migrations (2026-01 to 2026-09)
│   ├── functions/                # 80+ Deno edge functions
│   │   ├── _shared/              # 32 shared modules (cors, auth, logger, workflow-*, etc.)
│   │   ├── webhook-orchestrator/ # Central webhook routing
│   │   ├── agent-message/        # AI agent message handling
│   │   ├── checkout-*/           # Payment/provisioning (checkout-create-payment, checkout-provision-org)
│   │   ├── evolution-*/          # Evolution API (WhatsApp provider)
│   │   ├── meta-*/               # Meta/Facebook integration
│   │   ├── google-calendar-*/    # Google Calendar OAuth + events
│   │   ├── tinyerp-*/            # TinyERP integration (8 functions)
│   │   ├── sz-chat-*/            # SZChat integration
│   │   ├── process-*/            # Background processors (followup, workflow, outbound, etc.)
│   │   ├── oraculo-comercial/    # AI business oracle
│   │   └── ...                   # (import-leads, lead-webhook, campaign-rule-dispatch, etc.)
│   └── scripts/                  # DB utility scripts
├── orchestration/                # AI agent orchestration layer
│   ├── index.ts                  # Exports: Agent, DirectiveReader, Executor
│   ├── agent.ts                  # AI agent core
│   ├── directive-reader.ts       # Reads directive files
│   └── executor.ts               # Executes directive actions
├── directives/                   # Business logic directives (Markdown)
│   ├── business/                 # Business rules (campaign, follow-up, lead distribution)
│   ├── data_processing/          # Data ops (import, export, reports, metrics)
│   └── integrations/             # Integration specs (webhook, API sync, n8n, payment)
├── execution/                    # Execution scripts
│   ├── python/                   # Python scripts (migration, Supabase connection tests)
│   ├── typescript/               # TypeScript execution scripts
│   ├── deploy_hostinger_vps_api.sh
│   └── deploy_vps_rsync.sh
├── services/
│   └── google-calendar-service/  # Standalone Python service (Docker)
│       ├── app/
│       ├── Dockerfile
│       └── requirements.txt
├── scripts/                      # Utility scripts (deploy, migration, test, SQL)
├── tests/                        # Test suite
│   ├── e2e/                      # Playwright E2E tests (5 specs + fixtures)
│   ├── integration/              # Integration tests (6 tests)
│   └── unit/                     # Unit tests (8 tests)
├── docs/                         # Documentation & design docs
├── public/                       # Static assets (favicon, templates, robots.txt)
├── dist/                         # Build output
├── Dockerfile                    # Container build
├── docker-compose.yml            # Docker orchestration
├── vite.config.ts                # Vite configuration
├── tailwind.config.ts            # Tailwind configuration
├── tsconfig.json                 # TypeScript config
├── vitest.config.ts              # Vitest config
├── playwright.config.ts          # Playwright config
└── package.json                  # Dependencies & scripts
```

## Module Organization

### Authentication & Authorization
**Purpose:** User auth, org context, role-based permissions, multi-tenant isolation
**Location:** `src/contexts/AuthContext.tsx`, `src/hooks/useOrganization.ts`, `src/lib/permissions.ts`, `src/hooks/usePermissions.ts`, `src/hooks/useUserRole.ts`
**Key files:** `AuthContext.tsx` (session management), `useOrganization.ts` (org isolation gate), `permissions.ts` (cascading permission engine: master > admin > feature_permissions > member_feature_permissions)

### Sales Pipelines (Funis)
**Purpose:** Multi-stage kanban boards for lead progression (WhatsApp, Confirmacao, Propostas, Follow-ups, Custom)
**Location:** `src/pages/Pipe*.tsx`, `src/components/kanban/`, `src/hooks/usePipe*.ts`
**Key files:** `KanbanBoard.tsx`, `DraggableKanbanBoard.tsx` (dnd-kit), `usePipeWhatsapp.ts`, `usePipeConfirmacao.ts`, `usePipePropostas.ts`, `useCustomPipelines.ts`

### Lead Management
**Purpose:** CRUD, scoring, tagging, import/export, custom fields, timeline
**Location:** `src/pages/Leads.tsx`, `src/components/leads/`, `src/hooks/useLeads.ts`
**Key files:** `useLeads.ts` (paginated queries + batch delete + AI toggle), `LeadDetailDrawer.tsx`, `ImportLeadsFunnelModal.tsx`, `useLeadScore.ts`

### AI Copilot
**Purpose:** AI-powered sales agent with WhatsApp integration, prompt builder, TTS, document processing
**Location:** `src/pages/Copilot.tsx`, `src/components/copilot/`, `src/hooks/useCopilotAgents.ts`, `src/lib/copilot/`
**Key files:** `CopilotWizard.tsx`, `wizard-steps/`, `useCopilotPromptBuilder.ts`, `supabase/functions/agent-message/`

### Workflow Automation (Automacoes)
**Purpose:** Visual workflow builder with trigger-based automation (lead events, cron, tags, scores)
**Location:** `src/pages/Automacoes.tsx`, `src/pages/AutomacoesEditor.tsx`, `src/components/automacoes/`, `src/hooks/useWorkflows.ts`
**Key files:** `WorkflowCanvas.tsx` (react-flow based), `nodes/`, `edges/`, `supabase/functions/_shared/workflow-executor.ts`

### WhatsApp Integration
**Purpose:** Multi-instance WhatsApp chat, message templates, Evolution API, Meta Business, SZChat
**Location:** `src/pages/ChatWhatsApp.tsx`, `src/components/chat/`, `src/hooks/useWhatsApp*.ts`
**Key files:** `WhatsAppChat.tsx`, `useWhatsAppInstances.ts`, `useWhatsAppConversations.ts`, `supabase/functions/evolution-*/`, `supabase/functions/sz-chat-*/`

### Campaigns (Campanhas)
**Purpose:** Manual, semi-automatic, and automatic campaign dispatching
**Location:** `src/pages/Campanhas.tsx`, `src/components/campanhas/`, `src/hooks/useCampanhas.ts`
**Key files:** `supabase/functions/campaign-rule-dispatch/`, `supabase/functions/semi-automatic-dispatch/`

### Analytics & Dashboard
**Purpose:** KPIs, conversion charts, performance tracking, segment benchmarking, AI oracle
**Location:** `src/pages/Dashboard.tsx`, `src/pages/Analytics.tsx`, `src/components/dashboard/`, `src/components/analytics/`
**Key files:** `KPICard.tsx`, `TabVisaoGeral.tsx`, `useAnalytics*.ts` (5 hooks), `OraculoChat.tsx`

### Master Admin (Super-admin)
**Purpose:** Multi-org management, plan management, user operations, audit logs
**Location:** `src/pages/master/`, `src/components/master/`, `src/hooks/useMaster*.ts`
**Key files:** `MasterOrganizations.tsx`, `MasterPlans.tsx`, `useMasterAuth.ts`

### Checkout & Subscription
**Purpose:** Plan selection, payment (Asaas/Pix), org provisioning, subscription gating
**Location:** `src/pages/Checkout.tsx`, `src/components/checkout/`, `src/components/subscription/`
**Key files:** `CheckoutWizard.tsx`, `supabase/functions/checkout-create-payment/`, `supabase/functions/checkout-provision-org/`, `supabase/functions/asaas-webhook/`

### Orchestration Layer
**Purpose:** AI agent framework with directive-driven execution (reads Markdown directives, executes via AI)
**Location:** `orchestration/`, `directives/`, `execution/`
**Key files:** `orchestration/agent.ts`, `orchestration/executor.ts`, `directives/business/`, `directives/integrations/`

## Where Things Live

**Authentication:**
- UI: `src/pages/Auth.tsx`, `src/pages/Signup.tsx`, `src/pages/ResetPassword.tsx`
- Logic: `src/contexts/AuthContext.tsx`
- Data: Supabase Auth + `team_members` table

**Lead Management:**
- UI: `src/pages/Leads.tsx`, `src/components/leads/`
- Logic: `src/hooks/useLeads.ts`, `src/lib/permissions.ts`
- Data: `leads`, `lead_tags`, `lead_history`, `lead_scores` tables

**Pipeline/Kanban:**
- UI: `src/components/kanban/`, `src/pages/Pipe*.tsx`, `src/pages/FunisHub.tsx`
- Logic: `src/hooks/usePipe*.ts`, `src/hooks/useCustomPipelines.ts`
- Data: `pipe_whatsapp`, `pipe_confirmacao`, `pipe_propostas`, `custom_pipeline_items` tables

**WhatsApp Chat:**
- UI: `src/pages/ChatWhatsApp.tsx`, `src/components/chat/`
- Logic: `src/hooks/useWhatsApp*.ts`, `src/hooks/useChannelChat.ts`
- Data: `whatsapp_messages`, `whatsapp_instances`, `conversation_summaries` tables
- Backend: `supabase/functions/evolution-*`, `supabase/functions/sz-chat-*`, `supabase/functions/send-meta-message/`

**Workflow Automation:**
- UI: `src/components/automacoes/WorkflowCanvas.tsx` (react-flow)
- Logic: `src/hooks/useWorkflows.ts`, `src/types/workflow.ts`
- Data: `workflows`, `workflow_executions`, `workflow_execution_steps` tables
- Backend: `supabase/functions/_shared/workflow-executor.ts`, `supabase/functions/process-workflow-executions/`

**AI Copilot:**
- UI: `src/components/copilot/CopilotWizard.tsx`, `src/components/copilot/playground/`
- Logic: `src/hooks/useCopilotAgents.ts`, `src/lib/copilot/`
- Data: `copilot_agents`, `copilot_conversations`, `agent_documents` tables
- Backend: `supabase/functions/agent-message/`, `supabase/functions/process-copilot-followups/`

**Permissions:**
- UI: `src/components/PermissionProtectedRoute.tsx`, `src/components/team/MemberPermissions.tsx`
- Logic: `src/lib/permissions.ts`, `src/hooks/usePermissions.ts`, `src/hooks/useUserRole.ts`
- Data: `feature_permissions`, `member_feature_permissions` tables, `user_has_org_permission` RPC

**Subscription/Billing:**
- UI: `src/pages/Checkout.tsx`, `src/components/subscription/SubscriptionBlockedPage.tsx`
- Logic: `src/lib/subscription.ts`, `src/hooks/useCheckout.ts`
- Data: `subscriptions`, `subscription_plans`, `checkout_sessions` tables
- Backend: `supabase/functions/asaas-webhook/`, `supabase/functions/checkout-*/`

## Special Directories

**`orchestration/`** - AI agent orchestration framework (TypeScript). Reads Markdown-based `directives/` and executes them via the `Executor`. Decoupled from the frontend -- used for backend AI agent workflows.

**`directives/`** - Markdown files describing business rules, data processing steps, and integration specs. Consumed by the orchestration layer's `DirectiveReader`. Organized by domain: `business/`, `data_processing/`, `integrations/`.

**`execution/`** - Standalone scripts for deployment (`deploy_hostinger_vps_api.sh`, `deploy_vps_rsync.sh`), database migration execution (Python + TypeScript), and Supabase connection testing.

**`services/google-calendar-service/`** - Standalone Python microservice for Google Calendar OAuth and event management. Runs in Docker, independent from the main Supabase backend.

**`supabase/functions/_shared/`** - 32 shared modules used across all edge functions. Includes: `cors.ts` (CORS headers), `auth.ts` (JWT verification), `logger.ts` (structured logging), `workflow-executor.ts` (workflow engine), `permission_engine.ts`, `job-tracker.ts` (async job queue), `sentry.ts`, `validation.ts`.

**`src/components/ui/`** - 52 shadcn/ui primitive components (auto-generated via CLI). These are the design system foundation. Not modified directly -- customization happens via `tailwind.config.ts` and CSS variables.

**Root `.sql` files** - Diagnostic and fix scripts for common Supabase issues (org linking, RLS policies, copilot columns). Used as operational runbooks, not migrations.

**Root `.md` files** - Operational documentation and guides (deploy, setup, troubleshooting). Not part of the app.


## Links relacionados

- [[MOC - Arquitetura]]

- [[Produtos]]

- [[Analise Logging SaaS]]

- [[TV Dashboard]]

- [[Pipelines Customizados]]

- [[Checkout e Planos]]

- [[Master Admin]]

- [[Metas]]

- [[Gestao de Time]]

- [[Comissoes]]

- [[Onboarding]]

- [[Webhooks]]

- [[n8n Orquestracao]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Ranking]]

- [[Upsell]]

- [[Campanhas]]

- [[Workflow Builder]]

- [[Lead Score]]

- [[Oraculo Comercial]]

- [[Asaas Pagamentos]]

- [[Google Calendar]]

- [[TinyERP]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
