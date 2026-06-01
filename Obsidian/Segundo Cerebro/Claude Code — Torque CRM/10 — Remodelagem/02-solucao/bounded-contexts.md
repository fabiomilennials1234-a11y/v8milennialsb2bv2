---
type: reference
title: Solução — Bounded Contexts
status: active
created: 2026-05-26
tags: [remodelagem, solucao, ddd, bounded-context]
related: ["[[monolito-modular]]", "[[estrutura-final]]"]
---

# Solução — Bounded Contexts

14 BCs derivados do CONTEXT.md raiz. Cada um vira módulo físico.

## Tabela canônica

| BC | Entidade primária | Source CONTEXT.md | Pastas atuais origem |
|----|-------------------|-------------------|----------------------|
| **identity** | Org + Team Member + Role + Permission | "Team & Organization" | `components/master`, `settings/equipe`, `hooks/auth`, `lib/permissions.ts`, `contexts/AuthContext` |
| **leads** | Lead | "Lead", "Lead Form", "UTM" | `components/lead`, `lead-detail`, `leads`, `pages/Leads.tsx`, `Duplicates.tsx`, `Trash.tsx` |
| **pipelines** | Pipeline + Stage + Pipeline Entry | "Pipeline", "Stage" | `components/pipelines`, `pipe-propostas`, `confirmacao`, `kanban`, `custom-pipelines`, `funis`, pages `PipeX.tsx` |
| **communication** | Conversation + Message + Instance + Message Gateway | "Conversation", "Message", "Instance", "Message Gateway" | `components/chat`, `chat-meta`, `hooks/chat`, `hooks/chat-meta`, pages `ChatWhatsApp.tsx`, `AtendimentoMeta.tsx` |
| **copilot** | Copilot Agent + Human Pause + Oraculo | "Copilot Agent", "Human Pause", "Oraculo Comercial" | `components/copilot`, page `Copilot.tsx`, `CopilotMetrics.tsx`, `_shared/copilot/` |
| **workflows** | Workflow DAG + Triggers + Conditions + Action Handlers | "Workflow", "Action Handler" | `components/automacoes`, pages `Automacoes*.tsx`, `_shared/workflow-*`, `_shared/action-handlers/`, `_shared/actions/` |
| **campaigns** | Campaign + Mass Send | "Campaign" | `components/campanhas`, `pages/campaigns/`, `CampanhaDetail.tsx`, `Campanhas.tsx` |
| **carteira** | Carteira Client + Order + Upsell + ERP sync | "Carteira", "Order" | `components/carteira`, `upsell`, `proposals`, `deals`, page `Upsell.tsx`, edge `tinyerp-*` |
| **engagement** | Checklist + Activity + Follow-up + Agenda + Gamification | "Checklist", "Activity", "Follow-up", "Gamification" | `components/agenda`, `activities`, `followups`, `checklists`, `calls`, pages `Agenda.tsx`, `ChecklistPage.tsx`, `Premiacoes.tsx`, `Ranking.tsx` |
| **analytics** | Dashboard + Metric + Cohort + TV | "Engagement" (parcial) | `components/analytics`, `dashboard`, `dashboard-outbound`, `tv`, `performance`, `revisao`, pages `Dashboard.tsx`, `TVDashboard.tsx`, `Performance.tsx`, `Metas.tsx`, `GestaoMetas.tsx` |
| **billing** | Subscription + Asaas | "Subscription Plan" | edge functions Asaas, `lib/subscription.ts`, page `Configuracoes.tsx` (parcial) |
| **marketing** | Lead Form + Landing + UTM | "Lead Form", "UTM" | `components/landing`, page `Landing.tsx`, `lead-webhook`, `meta-webhook`, `list-lead-forms` |
| **integrations** | Provider adapters (Google Calendar, Meta, TinyERP, Asaas, SZ.Chat, Cal.com) | (cross-cutting) | edge `google-calendar-*`, `meta-oauth-*`, `meta-api`, `tinyerp-*`, `sz-chat-*`, `webhook-calcom` |
| **platform** | Onboarding + Settings + Observability + Health + Dead Letter | "Dead Letter Event" | `components/onboarding`, `command`, `settings`, pages `Onboarding.tsx`, `Configuracoes.tsx`, `Privacidade.tsx`, `MessageTemplates.tsx`, `cron-health-check`, `_shared/sentry.ts`, `logger.ts`, `rate-limit.ts`, `security-headers.ts` |

## Cross-cutting (não-módulo)

- `ui/` — primitivos shadcn (mantém intacto)
- `shared/` — utils puros sem dependência de domínio (`cn`, `format`, `normalizePhone`, `optimistic-lock`)
- `core/` — supabase client, types globais, env, sentry init

## Critério de classificação

**É módulo se** todos 4 verdadeiros:
1. É bounded context do CONTEXT.md
2. Tem entidade primária com lifecycle
3. Pode ser entregue/removido sem quebrar outros módulos
4. Tem owner mental claro (vendas, comunicação, ops, finance)

**NÃO é módulo se**:
- Utilitário puro sem dependência de domínio → `shared/`
- Primitivo de UI sem semântica de produto → `ui/`
- Init/config global → `core/`
- Helper compartilhado entre 2+ módulos sem identidade própria → `shared/` ou `_shared/core/`

## Refs

- CONTEXT.md raiz (14 BCs canônicos)
- [[monolito-modular]]
- [[estrutura-final]] — layout físico final
