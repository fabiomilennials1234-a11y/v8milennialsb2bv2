---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/org-quota-enforcement/tasks.md
---

# Tasks: Organization Quota Enforcement

**Feature:** org-quota-enforcement
**Created:** 2026-04-09
**Executed:** 2026-04-09 - All 12 tasks complete

## Dependency Graph

```
T01 ─────────────┐
                  ├──→ T03 ──→ T04 [P]
T02 (data migration)    │      T05 [P]
  depends on T01  │      │      T06 [P]
                  ├──→ T07
                  ├──→ T08
                  └──→ T09 ──→ T10 [P]
                              T11 [P]
                              T12 [P]

[P] = parallelizable within group
```

---

## T01: Create org_quotas + quota_audit_log tables with RLS

**Traces:** REQ-Q01, REQ-Q02, REQ-Q14, REQ-Q15
**Status:** done
**Depends on:** none

**What:** Single migration file that creates both tables, indexes, RLS policies, and the updated_at trigger.

**Where:**
- `supabase/migrations/YYYYMMDD000000_create_org_quotas.sql` (new)

**Done when:**
- `org_quotas` table exists with: id, organization_id, resource_key, plan_base, purchased_addons, admin_adjustment, effective_limit (GENERATED), created_at, updated_at
- UNIQUE constraint on (organization_id, resource_key)
- `quota_audit_log` table exists with: id, organization_id, resource_key, field_changed, old_value, new_value, changed_by, change_reason, created_at
- RLS on org_quotas: SELECT for org members, ALL for master/service_role
- RLS on quota_audit_log: SELECT for master only, INSERT for master/service_role, no UPDATE/DELETE
- Indexes on org_quotas(organization_id), quota_audit_log(organization_id, created_at DESC)

**Tests:**
- Generated column computes correctly: plan_base=3, addons=2, adj=0 → effective_limit=5
- Generated column handles unlimited: plan_base=-1 → effective_limit=-1
- Generated column floors at zero: plan_base=2, adj=-5 → effective_limit=0
- RLS blocks non-master from INSERT/UPDATE on org_quotas
- RLS blocks non-master from SELECT on quota_audit_log
- RLS blocks all UPDATE/DELETE on quota_audit_log

**Gate:** Migration applies cleanly; generated column values are correct.

---

## T02: Migrate existing org data to org_quotas

**Traces:** REQ-Q03
**Status:** done
**Depends on:** T01

**What:** Migration that populates `org_quotas` rows for all existing orgs based on their current plan limits and any `limit_overrides`.

**Where:**
- `supabase/migrations/YYYYMMDD000001_seed_org_quotas.sql` (new)

**Done when:**
- Every org with a subscription plan has 3 rows in org_quotas (max_whatsapp_instances, max_users, max_copilot_agents)
- `plan_base` reflects the org's current plan limits JSONB
- For orgs with `limit_overrides`, `admin_adjustment = override_value - plan_base` (only when plan_base != -1 and override differs from plan)
- Orgs without a plan get plan_base from 'free' plan defaults or 0

**Tests:**
- Org on torque-2.0 with no overrides → plan_base matches torque-2.0 limits, addons=0, adj=0
- Org with limit_overrides `{"max_whatsapp_instances": 5}` on pro plan (base=3) → admin_adjustment=2
- Org on enterprise (base=-1) with limit_overrides → admin_adjustment stays 0 (skip unlimited)

**Gate:** All existing orgs have quota rows; no data loss in override semantics.

---

## T03: Create org_resolve_quota and org_resolve_all_quotas RPCs

**Traces:** REQ-Q04, REQ-Q05
**Status:** done
**Depends on:** T01

**What:** Two RPC functions - one for single resource resolution, one batch for frontend.

**Where:**
- `supabase/migrations/YYYYMMDD000002_quota_resolution_rpcs.sql` (new)

**Reuses:**
- `is_master_user()` for bypass check
- Usage counting pattern from `org_get_seat_usage`

**Done when:**
- `org_resolve_quota(p_org_id, p_resource_key)` returns JSONB with: plan_base, purchased_addons, admin_adjustment, effective_limit, current_usage, is_unlimited, can_add, remaining
- Falls back to plan limits JSONB when no org_quotas row exists
- Master user always gets unlimited
- `org_resolve_all_quotas(p_org_id)` returns JSONB with all 3 resources keyed by resource_key
- Both granted to authenticated + service_role

**Tests:**
- Org with quotas: returns correct breakdown
- Org without quotas (no row): falls back to plan limits
- Master user: all unlimited
- Usage counting: correct COUNT for each resource table
- can_add=false when current_usage >= effective_limit
- remaining=-1 when unlimited

**Gate:** RPCs return correct data for all scenarios.

---

## T04: Create enforce_whatsapp_instance_limit trigger [P]

**Traces:** REQ-Q07
**Status:** done
**Depends on:** T03

**What:** BEFORE INSERT trigger on whatsapp_instances that enforces the quota.

**Where:**
- `supabase/migrations/YYYYMMDD000003_enforce_whatsapp_limit.sql` (new)

**Reuses:**
- `org_resolve_quota()` from T03
- Lock pattern from `enforce_seat_limit()`

**Done when:**
- Trigger fires on INSERT to whatsapp_instances
- Locks org row via `FOR UPDATE`
- Calls `org_resolve_quota(org_id, 'max_whatsapp_instances')`
- Raises exception P0001 with clear message when limit exceeded
- Allows INSERT when under limit or unlimited
- Master users bypass (via org_resolve_quota returning unlimited)

**Tests:**
- INSERT when under limit → succeeds
- INSERT when at limit → raises exception with usage/limit in message
- INSERT when unlimited → succeeds
- Concurrent inserts → serialized via lock, second one blocked if at limit
- Master user → always succeeds

**Gate:** Direct SQL INSERT beyond limit is rejected.

---

## T05: Create enforce_copilot_agent_limit trigger [P]

**Traces:** REQ-Q08
**Status:** done
**Depends on:** T03

**What:** BEFORE INSERT trigger on copilot_agents that enforces the quota.

**Where:**
- `supabase/migrations/YYYYMMDD000004_enforce_copilot_limit.sql` (new)

**Reuses:**
- Same pattern as T04

**Done when:**
- Trigger fires on INSERT to copilot_agents
- Same lock + resolve + raise pattern as T04 but for 'max_copilot_agents'

**Tests:**
- Same test matrix as T04 but for copilot_agents table

**Gate:** Direct SQL INSERT beyond limit is rejected.

---

## T06: Refactor enforce_seat_limit to use org_resolve_quota [P]

**Traces:** REQ-Q09
**Status:** done
**Depends on:** T03

**What:** Replace the existing `enforce_seat_limit()` and `org_get_seat_usage()` to use the unified `org_resolve_quota` path.

**Where:**
- `supabase/migrations/YYYYMMDD000005_refactor_seat_enforcement.sql` (new)

**Done when:**
- `enforce_seat_limit()` calls `org_resolve_quota(org_id, 'max_users')` instead of `org_get_seat_usage()`
- `org_get_seat_usage()` is updated to read from org_quotas (preserving its return shape for existing callers)
- Existing trigger on team_members continues to work
- Same error messages and ERRCODE

**Tests:**
- Activate member when under limit → succeeds
- Activate member when at limit → raises exception
- Existing behavior preserved: INSERT active member + UPDATE is_active=true both checked
- org_get_seat_usage return shape unchanged (paid_seats, active_members, can_add, remaining, is_unlimited)

**Gate:** Seat enforcement works identically but through unified quota path.

---

## T07: Create admin quota management RPCs

**Traces:** REQ-Q10, REQ-Q11, REQ-Q12
**Status:** done
**Depends on:** T01

**What:** Three RPCs for master admin quota management.

**Where:**
- `supabase/migrations/YYYYMMDD000006_admin_quota_rpcs.sql` (new)

**Done when:**
- `admin_set_quota_adjustment(p_org_id, p_resource_key, p_adjustment, p_reason)`:
  - Checks is_master_user(), raises if not
  - Upserts org_quotas.admin_adjustment
  - Creates plan_base from plan if row doesn't exist
  - Inserts quota_audit_log entry
  - Returns updated quota row
- `admin_set_purchased_addons(p_org_id, p_resource_key, p_purchased, p_reason)`:
  - Callable by master or service_role
  - Same upsert + audit pattern
- `admin_get_org_quota_summary(p_org_id)`:
  - Returns all org_quotas rows + current usage per resource
  - Includes audit log last 10 entries
- All three granted to authenticated + service_role

**Tests:**
- Non-master calling admin_set_quota_adjustment → exception
- Master sets adjustment → row updated, audit log created
- Upsert creates row if none exists with correct plan_base
- admin_get_org_quota_summary returns all 3 resources with usage

**Gate:** Master admin RPCs work end-to-end with audit trail.

---

## T08: Create sync_org_quotas_from_plan RPC

**Traces:** REQ-Q13
**Status:** done
**Depends on:** T01

**What:** RPC that syncs plan_base values when an org changes plan.

**Where:**
- `supabase/migrations/YYYYMMDD000007_sync_quotas_from_plan.sql` (new)

**Done when:**
- `sync_org_quotas_from_plan(p_org_id)`:
  - Reads org's current plan limits JSONB
  - For each of the 3 resource keys: UPSERT org_quotas SET plan_base = plan_limit
  - Inserts audit log for each change (only when plan_base actually changed)
  - Callable by master and service_role
- Edge function `checkout-provision-org` calls this after setting the plan

**Tests:**
- Org upgrades from torque-1.0 (whatsapp=0) to torque-2.0 (whatsapp=-1) → plan_base updated, audit logged
- Addons and adjustments preserved during sync
- No audit entry when plan_base doesn't change

**Gate:** Plan change correctly updates plan_base without affecting other quota components.

---

## T09: Update org_get_features_and_limits to read from org_quotas

**Traces:** REQ-Q06
**Status:** done
**Depends on:** T03

**What:** Update the existing RPC to prefer org_quotas.effective_limit over plan JSONB + limit_overrides for the 3 quota-managed resources.

**Where:**
- `supabase/migrations/YYYYMMDD000008_update_features_limits_rpc.sql` (new)

**Done when:**
- `org_get_features_and_limits()` checks org_quotas for max_whatsapp_instances, max_users, max_copilot_agents
- If org_quotas rows exist, uses effective_limit from there
- Other limits (max_leads, max_funnels, etc.) continue using plan JSONB + limit_overrides
- Return shape unchanged
- Existing frontend `checkLimit()` gets correct values without any change

**Tests:**
- Org with org_quotas rows → limits reflect effective_limit
- Org without org_quotas rows → falls back to plan JSONB (backward compat)
- Non-quota limits (max_leads) still work via plan JSONB

**Gate:** Frontend checkLimit() returns correct values through the updated RPC.

---

## T10: Create useOrgQuotas frontend hook [P]

**Traces:** REQ-Q17
**Status:** done
**Depends on:** T09

**What:** New React hook that calls `org_resolve_all_quotas` and exposes quota breakdown per resource.

**Where:**
- `src/hooks/useOrgQuotas.ts` (new)
- `src/contexts/OrgFeaturesContext.tsx` (minor: export quota types)

**Done when:**
- `useOrgQuotas()` hook calls `org_resolve_all_quotas(org_id)`
- Returns `getQuota(resource_key)` → `{ effective_limit, current_usage, can_add, remaining, plan_base, purchased_addons, admin_adjustment, is_unlimited }`
- Caches with React Query (5 min stale time, matching OrgFeaturesContext)
- Invalidates on whatsapp_instances, copilot_agents, team_members mutations

**Tests:**
- Hook returns correct data shape
- Loading state returns can_add=true (same UX as checkLimit returning -1 while loading)

**Gate:** Hook renders correct quota data in dev tools.

---

## T11: Add WhatsApp instance limit check to frontend [P]

**Traces:** REQ-Q18
**Status:** done
**Depends on:** T09

**What:** Add limit enforcement UI to WhatsApp settings page.

**Where:**
- `src/components/settings/WhatsAppSettings.tsx`

**Done when:**
- "Nova Instância" button disabled when `getQuota('max_whatsapp_instances').can_add === false`
- Shows "Limite atingido (X/Y). Entre em contato para contratar mais." badge/alert
- Shows current usage indicator "X de Y instâncias" when limit is finite
- Uses `useOrgQuotas` hook (or checkLimit as fallback)

**Tests:**
- Button enabled when under limit
- Button disabled + message when at limit
- Unlimited shows no usage counter

**Gate:** UI correctly reflects quota state and blocks creation.

---

## T12: Update Copilot agent limit check + Master admin quota UI [P]

**Traces:** REQ-Q17, REQ-Q18
**Status:** done
**Depends on:** T09

**What:** Update Copilot page to use richer quota info, and add quota management to master admin.

**Where:**
- `src/pages/Copilot.tsx` (update existing checkLimit usage)
- `src/components/master/QuotaManagementPanel.tsx` (new)
- `src/components/master/BillingOverrideModal.tsx` (add quota tab)

**Done when:**
- Copilot.tsx uses `getQuota('max_copilot_agents')` for richer error message showing usage
- Master admin has a "Quotas" tab/section per org showing:
  - Table with resource_key, plan_base, purchased_addons, admin_adjustment, effective_limit, current_usage
  - "Ajustar" button per resource that calls `admin_set_quota_adjustment`
  - Requires reason text input
  - Shows last audit log entries
- Quota adjustments trigger invalidation of org quota cache

**Tests:**
- Copilot page shows "X de Y agentes" and blocks creation at limit
- Master admin can set adjustment and see it reflected
- Audit log entries appear after adjustment

**Gate:** Both user-facing and admin quota UIs work correctly.

---

## Execution Order

```
Phase 1 (Foundation):     T01
Phase 2 (Data + RPCs):    T02, T03, T07, T08  [parallel where possible]
Phase 3 (Triggers):       T04, T05, T06        [parallel]
Phase 4 (Integration):    T09
Phase 5 (Frontend):       T10, T11, T12        [parallel]
```

Total: 12 tasks, ~5 parallel groups


## Links relacionados

- [[Configuracoes]]

- [[MOC - Arquitetura]]

- [[Checkout e Planos]]

- [[Master Admin]]

- [[Gestao de Time]]

- [[Permissoes Sistema]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
