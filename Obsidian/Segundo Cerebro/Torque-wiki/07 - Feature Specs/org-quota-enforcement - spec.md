---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/org-quota-enforcement/spec.md
---

# Feature: Organization Quota Enforcement

**Status:** Draft
**Scope:** Large
**Created:** 2026-04-09

## Problem

Today, resource limits (WhatsApp instances, copilot agents) are defined in plan JSONB but enforced **only on the frontend** via `checkLimit()`. There is zero backend enforcement - anyone with direct API or SQL access can bypass limits. Additionally, the current `limit_overrides` JSONB on `organizations` works as an **absolute replacement** of the plan limit, not as an additive delta. There is no structured way to track purchased addons separately from admin overrides, and no audit trail for quota changes.

The seat enforcement trigger (`enforce_seat_limit`) is the only resource with proper backend enforcement, and even that uses `org_subscriptions.user_count` as source of truth - not a unified quota model.

## Context (User Decisions)

- **Q1: Self-service + manual.** Orgs can purchase additional WhatsApp instances and seats via checkout (self-service addons), AND master admins can adjust quotas manually.
- **Q2: Delta model.** Effective limit = plan base + purchased addons + admin adjustment. NOT absolute override.
- **Q3: Master-only manual adjustments.** Only master admins can set quota overrides. Org admins cannot.
- **Q4: Soft enforcement for existing resources.** If a limit is reduced below current usage, block new creation but keep existing resources operational. No automatic disconnection.
- **Q5: Three resources in scope.** WhatsApp instances, users (seats), and copilot agents. Leads, campaigns, funnels are out of scope for now.

## Requirements

### Data Model

**REQ-Q01:** Create `org_quotas` table that stores per-org, per-resource quota adjustments with the following columns:
- `id` (UUID PK)
- `organization_id` (FK to organizations, NOT NULL)
- `resource_key` (TEXT NOT NULL) - e.g. `max_whatsapp_instances`, `max_users`, `max_copilot_agents`
- `plan_base` (INTEGER NOT NULL DEFAULT 0) - snapshot of the plan limit at last sync
- `purchased_addons` (INTEGER NOT NULL DEFAULT 0) - self-service purchased extra units
- `admin_adjustment` (INTEGER NOT NULL DEFAULT 0) - master admin manual delta (can be negative)
- `effective_limit` (INTEGER GENERATED ALWAYS AS) - computed: `plan_base + purchased_addons + admin_adjustment`. Value -1 means unlimited.
- `created_at`, `updated_at` timestamps
- UNIQUE constraint on `(organization_id, resource_key)`

**REQ-Q02:** Create `quota_audit_log` table to track all quota changes:
- `id` (UUID PK)
- `organization_id` (FK)
- `resource_key` (TEXT)
- `field_changed` (TEXT) - `plan_base`, `purchased_addons`, or `admin_adjustment`
- `old_value` (INTEGER)
- `new_value` (INTEGER)
- `changed_by` (UUID FK to auth.users)
- `change_reason` (TEXT) - e.g. `plan_upgrade`, `addon_purchase`, `admin_override`
- `created_at` timestamp

**REQ-Q03:** Migrate existing `limit_overrides` JSONB data on organizations to `org_quotas` rows. The JSONB field remains for backward compatibility (read by `org_get_features_and_limits`) but `org_quotas` becomes the authoritative source.

### Quota Resolution

**REQ-Q04:** Create RPC `org_resolve_quota(p_org_id UUID, p_resource_key TEXT)` that returns:
```json
{
  "plan_base": 3,
  "purchased_addons": 2,
  "admin_adjustment": 0,
  "effective_limit": 5,
  "current_usage": 3,
  "is_unlimited": false,
  "can_add": true,
  "remaining": 2
}
```
Resolution logic:
1. If master user → return unlimited (-1)
2. Read from `org_quotas` for the resource key
3. If no row exists, fall back to plan limits JSONB (backward compat)
4. Count current usage from the relevant table
5. `can_add = is_unlimited OR current_usage < effective_limit`

**REQ-Q05:** Create RPC `org_resolve_all_quotas(p_org_id UUID)` that returns all three resource quotas in one call (optimized for frontend).

**REQ-Q06:** Update `org_get_features_and_limits()` to read limits from `org_quotas.effective_limit` when rows exist, falling back to plan JSONB + limit_overrides for resources not yet in `org_quotas`.

### Backend Enforcement (Triggers)

**REQ-Q07:** Create trigger `enforce_whatsapp_instance_limit()` on `whatsapp_instances` table:
- Fires BEFORE INSERT
- Locks org row to prevent race conditions (same pattern as `enforce_seat_limit`)
- Calls `org_resolve_quota(org_id, 'max_whatsapp_instances')`
- If `can_add = false`, raises exception with ERRCODE P0001
- Error message includes current usage and effective limit

**REQ-Q08:** Create trigger `enforce_copilot_agent_limit()` on `copilot_agents` table:
- Fires BEFORE INSERT
- Same locking and resolution pattern as REQ-Q07
- Calls `org_resolve_quota(org_id, 'max_copilot_agents')`
- If `can_add = false`, raises exception

**REQ-Q09:** Refactor `enforce_seat_limit()` to use `org_resolve_quota(org_id, 'max_users')` instead of reading directly from `org_subscriptions.user_count`. This unifies all enforcement through the same quota resolution path.

### Quota Management (Master Admin)

**REQ-Q10:** Create RPC `admin_set_quota_adjustment(p_org_id UUID, p_resource_key TEXT, p_admin_adjustment INTEGER, p_reason TEXT)`:
- Only callable by master users (check `is_master_user()`)
- Updates `org_quotas.admin_adjustment` for the given org and resource
- Inserts audit log entry in `quota_audit_log`
- If no `org_quotas` row exists, creates one with current plan base + zero purchased addons + the adjustment

**REQ-Q11:** Create RPC `admin_set_purchased_addons(p_org_id UUID, p_resource_key TEXT, p_purchased INTEGER, p_reason TEXT)`:
- Only callable by master users or service_role (for checkout flow)
- Updates `org_quotas.purchased_addons`
- Inserts audit log entry

**REQ-Q12:** Create RPC `admin_get_org_quota_summary(p_org_id UUID)` that returns all quota rows + current usage for an org, designed for the master admin panel.

### Plan Sync

**REQ-Q13:** When an org changes plan (via checkout or admin), sync `org_quotas.plan_base` values from the new plan's `limits` JSONB. This happens:
- In `checkout-provision-org` edge function (new orgs)
- In any plan change flow (upgrade/downgrade)
- Via a utility RPC `sync_org_quotas_from_plan(p_org_id UUID)` for manual re-sync

### RLS & Security

**REQ-Q14:** `org_quotas` RLS:
- SELECT: org members can read their own org's quotas
- INSERT/UPDATE/DELETE: master users and service_role only

**REQ-Q15:** `quota_audit_log` RLS:
- SELECT: master users only
- INSERT: master users and service_role (via triggers/RPCs)
- No UPDATE/DELETE (immutable audit log)

**REQ-Q16:** All enforcement triggers run as SECURITY DEFINER to bypass RLS for cross-table lookups.

### Frontend Integration

**REQ-Q17:** Update `useOrgFeatures` context (or create new `useOrgQuotas` hook) to expose quota data per resource:
- `getQuota(resource_key)` → returns `{ effective_limit, current_usage, can_add, remaining }`
- Used by WhatsApp settings, Copilot page, and team member management

**REQ-Q18:** Frontend must show clear feedback when a limit is reached:
- Disable "create" buttons
- Show message: "Limite atingido (X/Y). Entre em contato para contratar mais."

## Out of Scope

- Self-service addon purchase checkout flow (future feature - requires Asaas integration)
- Enforcement for leads, campaigns, funnels (can reuse same pattern later)
- Automatic disconnection or degradation of existing resources when limit drops
- Billing reconciliation between quotas and payment

## Success Criteria

1. A WhatsApp instance INSERT beyond the effective limit is rejected at the database level
2. A copilot agent INSERT beyond the effective limit is rejected at the database level
3. A team member activation beyond the effective limit is rejected (unified path)
4. Master admin can adjust any org's quota via RPC and see audit trail
5. Frontend shows accurate quota usage and blocks creation when limit reached
6. Existing orgs with `limit_overrides` continue working during migration


## Links relacionados

- [[Configuracoes]]

- [[MOC - Arquitetura]]

- [[Checkout e Planos]]

- [[Master Admin]]

- [[Permissoes Sistema]]

- [[Asaas Pagamentos]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
