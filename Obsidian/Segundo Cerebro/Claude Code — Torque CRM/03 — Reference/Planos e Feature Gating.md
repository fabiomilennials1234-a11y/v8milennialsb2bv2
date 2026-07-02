---
type: reference
title: Planos e Feature Gating
status: active
created: 2026-07-02
updated: 2026-07-02
tags: [reference, billing, plans, feature-gating]
related: ["[[Schema]]", "[[RPCs]]", "[[Edge Functions]]"]
owner: claude-agent
---

# Planos e Feature Gating

Fonte de verdade da matriz plano→feature (spec CTO, projeto **plan-tiers-cleanup**, 2026-07-02) e mapa de ONDE cada camada de enforcement vive.

## Planos ativos

| Plano (name) | Label | Posição |
|---|---|---|
| `torque-1.0` | Torque Base | CRM completo, sem automações/chat/IA |
| `torque-2.0` | Torque Automation | CRM + automações + chat |
| `torque-v8` | Torque Copilot | Tudo |

Legados `free/starter/pro/enterprise`: `is_active=false`. **Addon `turbo`** (`plan_addons`, slug `turbo`): desbloqueia `copilot`+`oraculo` pra 1.0/2.0 — materializa via rows em `organization_features` (a RPC de resolução aplica overrides).

## Matriz plano → feature

| Feature key | Base | Automation | Copilot | Nota |
|---|---|---|---|---|
| leads, funnels, deals, review | ✅ | ✅ | ✅ | CRM core |
| performance, commissions, tv_dashboard, analytics | ✅ | ✅ | ✅ | CRM core |
| products, marketing | ✅ | ✅ | ✅ | CRM core |
| carteira, customer_portfolio | ✅ | ✅ | ✅ | Base = CRM completo (mudou em 2026-07-02; era ❌ no Base) |
| chat, message_templates | ❌ | ✅ | ✅ | |
| automations, whatsapp_bulk, scheduled_messages | ❌ | ✅ | ✅ | |
| campaigns_* (legadas) | ❌ | ✅ | ✅ | Keys mantidas por compat com rows vivas |
| copilot, copilot_advanced, oraculo | ❌ | ❌ (turbo ✅) | ✅ | |
| merged_opportunity_funnel | — | — | — | Rollout flag per-org, fora da matriz |
| api_access, white_label, external_cadastro | — | — | — | Fora dos 3 planos (default flags) |

**Limits:** `max_users: 5` nos 3 (era -1 — mudou em 2026-07-02). `max_copilot_agents`: 0/0/-1. `max_whatsapp_instances`: 0/-1/-1.

**Grandfathering:** org com >5 membros ativos não quebra — o trigger só bloqueia ATIVAR/adicionar; ninguém é desativado. Ajustes por org via `org_quotas.admin_adjustment` (delta, preservado em re-sync de plano).

⚠️ **Resolução de key ausente:** key fora do JSONB do plano cai em `feature_flags.default_enabled`; key sem flag row NEM seed = `false` universal (classe do bug `deals`, corrigido em `20270105000001`). Ao criar feature key nova: seedar nos planos OU criar flag row.

## Onde vive cada camada

| Camada | Artefato |
|---|---|
| Dados (matriz) | `subscription_plans.features/limits` — seeds `20260830000000`, `20270103000000`, `20270105000000/1` |
| Resolução | RPC `org_get_features_and_limits(p_org_id)` — plano + `organization_features` (addon/overrides, `expires_at`) + `feature_flags.default_enabled`; master → tudo true |
| Quota | `org_quotas` (delta model, `effective_limit` GENERATED) + RPC `org_resolve_quota(p_org_id, p_resource_key)`; re-sync `sync_org_quotas_from_plan` |
| Seats (DB, autoritativo) | Trigger `trg_enforce_seat_limit` em `team_members` (via `org_resolve_quota`) |
| Seats (pre-check) | `create-org-user` → `_shared/seat-quota.ts` (`evaluateSeatQuota`) — 403 claro antes de criar auth user |
| Server-side (edges) | `_shared/plan-gate.ts` (`assertPlanFeature`, fail-closed) — mapa função→key em `docs/PERMISSION-ENFORCEMENT.md` |
| Frontend contexto | `OrgFeaturesContext.hasFeature()` — fail-open no loading (anti-flash) |
| Frontend rota | `FeatureRoute` (feature-lock) — ESTRITO (espera `isReady`); fonte `ROUTE_FEATURE_MAP` |
| Frontend nav (4 superfícies) | `SIDEBAR_FEATURE_MAP` → cadeado em TopNavigation (top + mobile sheet), MobileBottomNav, CommandGroupNavigation; clique → `UpgradeModal` |
| Consistência nav↔rota | `tests/unit/route-feature-map.test.ts` (lê App.tsx; cadeado sem guard = fail) |

## Enforcement server-side (edges premium)

| Edge function | Feature key | Denial |
|---|---|---|
| `agent-message` | `copilot` | 200 `{skipped, reason: plan_denied}` (hop interno — 4xx viraria retry/DLQ storm) |
| `oraculo-comercial` | `oraculo` | 403 `{error, feature, plan}` |
| `process-workflow-executions` | `automations` | por execução → `status=skipped_plan` (fail-open em erro de resolução — cron não pode perder execução por erro transiente) |
| `mass-send-create` | `whatsapp_bulk` | 403 |
| `whatsapp-api-proxy` | `chat` | 403 (master bypassa) |

`copilot-v2-worker` NÃO é gateado (inert de propósito, só Milennials).

## Débitos conhecidos

- `organizations.subscription_plan` (TEXT) vs `org_subscriptions.plan_id` (FK) — duas fontes de plano; unificação é projeto próprio.
- `checkout-provision-org`/`asaas-webhook` não versionados no repo — enforcement de checkout não auditável aqui.
