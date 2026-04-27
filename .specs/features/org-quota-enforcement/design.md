# Design: Organization Quota Enforcement

**Feature:** org-quota-enforcement
**Created:** 2026-04-09

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend                            │
│  ┌──────────────────┐   ┌─────────────────────────┐    │
│  │ useOrgFeatures   │   │ useOrgQuotas (new)      │    │
│  │ checkLimit(key)  │   │ getQuota(key) → full obj│    │
│  │ (number only)    │   │ (breakdown + usage)     │    │
│  └────────┬─────────┘   └────────┬────────────────┘    │
│           │                      │                      │
│  ┌────────┴──────────────────────┴────────────────┐    │
│  │ Disable buttons + show "Limite atingido" msg   │    │
│  └────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────┘
                            │ RPC calls
┌───────────────────────────┴─────────────────────────────┐
│                   Supabase RPCs                         │
│  org_resolve_quota()        ← single resource           │
│  org_resolve_all_quotas()   ← batch for frontend        │
│  admin_set_quota_adjustment() ← master admin            │
│  admin_set_purchased_addons() ← checkout / admin        │
│  sync_org_quotas_from_plan()  ← plan change             │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│                  Database Layer                          │
│  ┌──────────────┐  ┌────────────────────────────────┐  │
│  │ org_quotas   │  │ Enforcement Triggers            │  │
│  │ (source of   │  │  enforce_whatsapp_instance_limit│  │
│  │  truth)      │  │  enforce_copilot_agent_limit    │  │
│  │              │  │  enforce_seat_limit (refactored)│  │
│  ├──────────────┤  └────────────────────────────────┘  │
│  │ quota_audit  │                                       │
│  │ _log         │  Triggers call org_resolve_quota()    │
│  └──────────────┘  Lock org row → check → raise/allow   │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### org_quotas

```sql
CREATE TABLE org_quotas (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_key     TEXT        NOT NULL,  -- 'max_whatsapp_instances', 'max_users', 'max_copilot_agents'
  plan_base        INTEGER     NOT NULL DEFAULT 0,
  purchased_addons INTEGER     NOT NULL DEFAULT 0,
  admin_adjustment INTEGER     NOT NULL DEFAULT 0,
  effective_limit  INTEGER     GENERATED ALWAYS AS (
    CASE
      WHEN plan_base = -1 THEN -1
      ELSE GREATEST(plan_base + purchased_addons + admin_adjustment, 0)
    END
  ) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, resource_key)
);
```

**Design decisions:**
- `effective_limit` is a generated column — always consistent, zero application logic needed
- `plan_base = -1` means unlimited, and that propagates to `effective_limit = -1` regardless of addons/adjustments
- `admin_adjustment` can be negative (to restrict) but effective_limit floors at 0 via `GREATEST`
- Three resource keys tracked: `max_whatsapp_instances`, `max_users`, `max_copilot_agents`

### quota_audit_log

```sql
CREATE TABLE quota_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_key    TEXT        NOT NULL,
  field_changed   TEXT        NOT NULL,  -- 'plan_base', 'purchased_addons', 'admin_adjustment'
  old_value       INTEGER     NOT NULL,
  new_value       INTEGER     NOT NULL,
  changed_by      UUID        REFERENCES auth.users(id),
  change_reason   TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- No UPDATE/DELETE policies — immutable log
```

## Quota Resolution Logic

```
org_resolve_quota(org_id, resource_key):
  1. Master user? → return all unlimited (-1)
  2. SELECT from org_quotas WHERE org_id + resource_key
  3. If no row → fallback to plan limits JSONB (backward compat)
  4. Count current_usage from resource table:
     - max_whatsapp_instances → COUNT(*) FROM whatsapp_instances WHERE org_id
     - max_users             → COUNT(*) FROM team_members WHERE org_id AND is_active
     - max_copilot_agents    → COUNT(*) FROM copilot_agents WHERE org_id
  5. Return { plan_base, purchased_addons, admin_adjustment, effective_limit,
              current_usage, is_unlimited, can_add, remaining }
```

## Usage Count Strategy

Each resource counts differently:

| Resource | Table | Count Query |
|----------|-------|-------------|
| `max_whatsapp_instances` | `whatsapp_instances` | `COUNT(*) WHERE organization_id = $1` (all statuses — even disconnected count) |
| `max_users` | `team_members` | `COUNT(*) WHERE organization_id = $1 AND is_active = true` (only active) |
| `max_copilot_agents` | `copilot_agents` | `COUNT(*) WHERE organization_id = $1` (all agents, active or not) |

**Rationale:**
- WhatsApp instances count all statuses because even disconnected instances consume a "slot" and can be reconnected
- Users only count active because inactive members are effectively deactivated
- Copilot agents count all because even inactive agents are configured resources

## Trigger Pattern

All three triggers follow the same pattern (modeled after existing `enforce_seat_limit`):

```sql
CREATE FUNCTION enforce_<resource>_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_quota JSONB;
BEGIN
  -- Lock org row to serialize concurrent inserts
  PERFORM 1 FROM organizations WHERE id = NEW.organization_id FOR UPDATE;

  -- Resolve quota (includes current usage count)
  v_quota := org_resolve_quota(NEW.organization_id, '<resource_key>');

  -- If not unlimited AND at or over limit
  IF NOT (v_quota->>'is_unlimited')::BOOLEAN
     AND NOT (v_quota->>'can_add')::BOOLEAN
  THEN
    RAISE EXCEPTION 'Limite de <resource> atingido. Uso: %/%. Contrate mais ou contate o administrador.',
      (v_quota->>'current_usage')::INTEGER,
      (v_quota->>'effective_limit')::INTEGER
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Key:** Lock on `organizations` row (not the resource table) — same serialization point for all triggers.

## Plan Sync Flow

When org changes plan (checkout or admin):

```
sync_org_quotas_from_plan(org_id):
  1. Get new plan limits JSONB
  2. For each resource_key in ('max_whatsapp_instances', 'max_users', 'max_copilot_agents'):
     a. UPSERT org_quotas SET plan_base = plan.limits[key]
        (preserves purchased_addons and admin_adjustment)
     b. INSERT audit log: field='plan_base', reason='plan_sync'
```

This means upgrading/downgrading a plan automatically adjusts the base without touching addons or admin adjustments.

## Migration Strategy (Existing Data)

1. For all orgs with a subscription plan → create `org_quotas` rows with `plan_base` from plan limits
2. For orgs with `limit_overrides` JSONB → calculate `admin_adjustment = override_value - plan_base`
   - Skip if plan_base is -1 (unlimited can't be meaningfully overridden in delta model)
   - Skip if override_value equals plan_base (no effective change)
3. `limit_overrides` JSONB column remains (read by `org_get_features_and_limits` for non-quota limits like `max_funnels`, `max_leads`, etc.)

## Frontend Integration

### New hook: useOrgQuotas

```typescript
// Calls org_resolve_all_quotas(org_id) — one RPC, all 3 resources
const { getQuota, isLoading } = useOrgQuotas();

const whatsapp = getQuota('max_whatsapp_instances');
// → { effective_limit: 5, current_usage: 3, can_add: true, remaining: 2,
//     plan_base: 3, purchased_addons: 2, admin_adjustment: 0 }
```

### Integration points

| Component | Current | After |
|-----------|---------|-------|
| `WhatsAppSettings.tsx` | No limit check | `getQuota('max_whatsapp_instances').can_add` → disable "Nova Instância" button |
| `Copilot.tsx` | `checkLimit("max_copilot_agents")` frontend only | Keep + add `getQuota('max_copilot_agents').can_add` for richer message |
| Team member management | `enforce_seat_limit` trigger | Trigger refactored to use `org_resolve_quota` |
| `BillingOverrideModal.tsx` | Feature toggles only | Add "Quotas" tab with adjustment controls per resource |

### Existing checkLimit compatibility

`org_get_features_and_limits()` will be updated to read `effective_limit` from `org_quotas` when rows exist. This means `checkLimit()` in `useOrgFeatures` continues to work unchanged — it just gets the resolved effective limit. The new `useOrgQuotas` hook is for the richer breakdown (showing "3/5 instâncias" etc).

## Master Admin Quota UI

New tab in `BillingOverrideModal` or new section in org detail:

```
┌─────────────────────────────────────────────┐
│ Quotas da Organização: Acme Corp            │
├─────────────────────────────────────────────┤
│ Recurso            │ Base │ Extra │ Adj │ = │ Uso │
│ WhatsApp Instances │   3  │  +2   │  0  │ 5 │ 3/5 │
│ Usuários (Seats)   │  -1  │   0   │  0  │ ∞ │ 7   │
│ Copilot Agents     │  10  │  +0   │ +5  │ 15│ 8/15│
├─────────────────────────────────────────────┤
│ [Ajustar Quota]  [Ver Histórico]            │
└─────────────────────────────────────────────┘
```

## Edge Cases

1. **Plan downgrade reduces plan_base below current usage** → existing resources preserved, new creation blocked (REQ-Q04 soft enforcement)
2. **Admin sets negative adjustment making effective_limit < current_usage** → same: block new, keep existing
3. **No org_quotas row exists** → `org_resolve_quota` falls back to plan JSONB limits (backward compat for orgs that haven't been migrated or new resources added later)
4. **Master user creating resources** → triggers skip enforcement (check `is_master_user()`)
5. **Race condition on concurrent inserts** → handled by `FOR UPDATE` lock on `organizations` row
