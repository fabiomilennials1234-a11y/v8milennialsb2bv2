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
| leads DELETE (RLS) | `can_delete_leads` | `leads_delete_admin_or_permission` policy | 2026-05-20 |

## Permission Tab (Pitstop) — REMOVIDA (2026-07-02)

> **Histórico:** a aba Pitstop > Permissões (12 toggles org-wide para `role='member'`,
> ADR-2026-05-20-permission-tab-storage-split) foi **removida em 2026-07-02**. A
> consolidação de permissões (PRD #408, migration `20261032000002`) DROPOU as
> tabelas `organization_role_permissions` e `team_member_org_permissions` — a aba
> quebrava em runtime desde então (query em tabela inexistente) e o conceito
> "toggle org-wide por role" deixou de existir no modelo.
>
> **Modelo consolidado (atual):** `feature_permissions` (catálogo GLOBAL: key,
> `is_admin_only`, `default_value`) + `member_feature_permissions` (override POR
> MEMBRO). Resolução server-side: `has_feature_permission(key, org)` — master →
> true; admin da org → true; admin_only → false; senão override individual ??
> default global. **Superfície de UI viva:** Equipe > `MemberPermissions`.
>
> Removidos junto: `PermissionsTab`, `useOrgRolePermissions`, `useUpdateRolePermission`,
> `useResetOrgRolePermissions`, `useOrganizationRolePermissions`,
> `useTeamMemberOrgPermissions`, `useSaveTeamMemberOrgPermissions`,
> `src/lib/permission-catalog.ts`.

### Fase 1 server-side enforcement (delivered 2026-05-20)

Only **`can_delete_leads`** has RLS enforcement. DELETE on `leads` requires `is_user_admin() OR is_master_user() OR user_has_org_permission('can_delete_leads')`.

### Fase 2 server-side enforcement (backlog)

The other 7 keys are frontend-only. Tracked in [`server-side-enforcement-phase2`](../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/08%20—%20Backlog/backlog/server-side-enforcement-phase2.md).

### Audit log

Every toggle is captured in `permission_audit_log` via SECURITY DEFINER trigger `tg_permission_audit_org_role_permissions` / `tg_permission_audit_feature_permissions`. RLS allows admin/master of the org to SELECT. INSERT only via trigger (no policy = effective deny for client).

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

## Plan Gating Server-Side (2026-07-02 — plan-tiers-cleanup)

Camada ORTOGONAL às permissões de usuário: gateia por **plano da org** (Base /
Automation / Copilot), não por role. Resolução via RPC
`org_get_features_and_limits(p_org_id)` — mesma fonte do frontend
(`OrgFeaturesContext`); addon `turbo` entra via `organization_features`.
Helper: `_shared/plan-gate.ts` → `assertPlanFeature(client, orgId, key)`
(**fail-closed**: erro na resolução = negado) + `planDeniedResponse()` (403
JSON `{error, feature, plan}`). `plan_name === "master"` bypassa.

| Edge function | Feature key | Comportamento na negação |
|---|---|---|
| `agent-message` | `copilot` | 200 `{skipped, reason: "plan_denied"}` — hop interno; 4xx viraria retry/DLQ storm |
| `oraculo-comercial` | `oraculo` | 403 `{error, feature, plan}` (todos os modos: chat, tv_analysis, legacy) |
| `process-workflow-executions` | `automations` | por execução → `workflow_executions.status = "skipped_plan"`; cache por org no batch; **fail-open em erro de resolução** (erro transiente não pode marcar execução como skipped — seria perda permanente) |
| `mass-send-create` | `whatsapp_bulk` | 403, após `assertPermission("mass_send")`, antes de qualquer side-effect |
| `whatsapp-api-proxy` | `chat` | 403; master bypassa (opera qualquer org) |

Não gateado de propósito: `copilot-v2-worker` (sistema live-but-inert, só Milennials).

**Seat limit** (relacionado): `create-org-user` usa `_shared/seat-quota.ts`
(`evaluateSeatQuota`) sobre a RPC `org_resolve_quota(p_org_id, 'max_users')` —
pre-check com 403 claro; o trigger `trg_enforce_seat_limit` no DB continua
autoritativo. (O bloco antigo lia `limits.users`, key inexistente — no-op.)

Frontend correspondente: guards de rota derivados de `ROUTE_FEATURE_MAP`
(`feature-registry.ts`), consistência nav↔rota enforced por
`tests/unit/route-feature-map.test.ts`. Referência completa da matriz:
vault `03 — Reference/Planos e Feature Gating.md`.

## Utility Reference

| File | Export | Purpose |
|------|--------|---------|
| `_shared/assert-permission.ts` | `assertPermission` | Positional-args wrapper around `canUserPerformAction` |
| `_shared/assert-permission.ts` | `permissionDeniedResponse` | Builds standardized 403 JSON response |
| `_shared/permission_engine.ts` | `canUserPerformAction` | Full cascading engine (object params) |
| `_shared/permission_engine.ts` | `canUserAccessFeature` | Feature-key check (simpler boolean) |
| `_shared/plan-gate.ts` | `assertPlanFeature` / `planDeniedResponse` | Plan-feature gate (fail-closed) + 403 padrão |
| `_shared/seat-quota.ts` | `evaluateSeatQuota` | Decisão pura do pre-check de seats (create-org-user) |
| `src/lib/permissions.ts` | `useCanPerformAction` | Frontend hook (optimistic gate) |
