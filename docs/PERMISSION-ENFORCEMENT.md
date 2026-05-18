# Permission Enforcement Map

Server-side permission enforcement for Torque CRM edge functions.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (optimistic UI gate)                          │
│  useCanPerformAction(action) → hide/disable controls    │
│  Fail-closed: loading state blocks action               │
│  Unmapped actions: denied by default                    │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP request
┌──────────────────────────▼───────────────────────���──────┐
│  Backend (authoritative)                                │
│  assertPermission(supabase, userId, orgId, action)      │
│  → permissionDeniedResponse(reason, headers) on deny    │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Permission Engine (_shared/permission_engine.ts)        │
│                                                         │
│  Cascade:                                               │
│  1. master_users → allow                                │
│  2. team_members.role = admin → allow                   │
│  3. feature_permissions (is_admin_only check)           │
│  4. member_feature_permissions (per-member override)    │
│  5. org_permission (team_member_org_permissions)        │
│  6. Matrix (team_member_permissions table)              │
│  7. Fallback: deny (unmapped action)                    │
└─────────────────────────────────────────────────────────┘
```

Frontend is **optimistic** — hides UI but does not prevent bypass via direct API call. Backend is **authoritative** — returns 403 regardless of client state.

## Functions WITH Server-Side Enforcement

| Function | Action | Gate location | Added in |
|----------|--------|---------------|----------|
| move-card (move-pipe-record) | `move_pipe_record` | `_shared/actions/move-card.ts` | #188 |
| mass-send-create | `mass_send` | `mass-send-create/index.ts` | #189 |

### move-card

- Enforces when `options.userId` is provided (user-initiated calls).
- Skips enforcement when `userId` is omitted (AI/automation/cron callers).
- Returns `ActionResult { success: false, error: "Permission denied: move_pipe_record" }`.

### mass-send-create

- Enforces after auth extraction + org resolution.
- Returns `403` via `permissionDeniedResponse(reason, corsHeaders)`.
- Role check (`admin`/`master`) still runs before permission gate as an independent guard.

## Functions WITHOUT Enforcement (and why)

| Category | Examples | Auth mechanism | Why no assertPermission |
|----------|----------|----------------|------------------------|
| Cron functions | `webhook-deliveries`, `workflow-executions`, `outbound-dispatches`, `ai-actions`, `campaign-rule-dispatch` | `x-cron-secret` header | Not user-initiated. System automation authenticated via shared secret. |
| Webhook receivers | `whatsapp-webhook`, `lead-webhook` | Webhook secret (path or header) | External system callback. No user identity to check against. |
| Read-only functions | Various data fetchers | JWT + RLS | RLS provides row-level isolation. No write action to gate. |
| Admin-only functions | `create-org-user`, `checkout-provision-org` | Explicit master/admin role check | Already restricted to highest privilege. assertPermission would be redundant. |
| AI action executor | `agent-message` → `ai-action-executor.ts` | Service role (copilot system) | AI actions call move-card WITHOUT userId, bypassing the gate by design. |

## How to Add Enforcement

1. Import the utility:

```typescript
import { assertPermission, permissionDeniedResponse } from "../_shared/assert-permission.ts";
```

2. After resolving `userId` and `organizationId`, call:

```typescript
const permission = await assertPermission(supabase, userId, orgId, "your_action");
if (!permission.allowed) {
  return permissionDeniedResponse(permission.reason, corsHeaders);
}
```

3. Register the action in `_shared/permission_engine.ts`:
   - Add to `PermissionAction` type union.
   - Add mapping in `ACTION_TO_MATRIX` or `ACTION_TO_FEATURE` (or handle in the cascade switch).

4. Add corresponding frontend action in `src/lib/permissions.ts` → `AppAction` type.

5. Write unit tests covering: deny (membro without permission), allow (membro with permission), admin bypass, master bypass.

## Matrix Default Behavior

When `team_member_permissions` has **no row** for a given `(team_member_id, resource_key, action_key)` tuple, the engine returns `"allowed"`.

**Why:** Backwards compatibility. Most orgs (~30 active) never configured the permission matrix. A fail-closed default would lock out every existing member on deploy. The matrix defaults to open; admins explicitly restrict by creating rows with `value = "denied"`.

**Future:** Backlog item [`permissions-fallback-fail-closed`](../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/08%20—%20Backlog/backlog/permissions-fallback-fail-closed.md) tracks migrating to fail-closed after all orgs have been provisioned with explicit allow rows.

## Utility Reference

| File | Export | Purpose |
|------|--------|---------|
| `_shared/assert-permission.ts` | `assertPermission` | Positional-args wrapper around `canUserPerformAction` |
| `_shared/assert-permission.ts` | `permissionDeniedResponse` | Builds standardized 403 JSON response |
| `_shared/permission_engine.ts` | `canUserPerformAction` | Full cascading engine (object params) |
| `_shared/permission_engine.ts` | `canUserAccessFeature` | Feature-key check (simpler boolean) |
| `src/lib/permissions.ts` | `useCanPerformAction` | Frontend hook (optimistic gate) |
