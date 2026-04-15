---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/t2-t5-auth-rls-tests/spec.md
---

# T2+T5: Auth/Permissions Unit Tests + RLS Policy Integration Tests

**Created:** 2026-04-02
**Scope:** Large
**Concerns addressed:** CONCERN-T2 (Critical), CONCERN-T5 (High)
**Deferred:** CONCERN-S1, CONCERN-S3 (per D003)

---

## Overview

Build a comprehensive test suite covering:
- **T2:** Frontend auth/permissions hooks and route protection components (unit tests)
- **T5:** Database RLS policy enforcement across all 73 tables (integration tests)

Zero modifications to production code. All changes are test-only and additive.

---

## Requirements

### REQ-001: AuthContext unit tests
Test `AuthProvider` and `useAuth` hook covering: signIn, signUp, signOut, session lifecycle, dedup guard for `attachToOrgByPendingInvite`, Edge Function error handling, `useAuth` outside provider throws.
**File:** `tests/unit/auth-context.test.ts`
**Estimated tests:** ~15

### REQ-002: useOrganization unit tests
Test `useOrganization` and `useRequiredOrganization` covering: `isReady` vs `isLoading` distinction, `organizationId` derivation from `teamMember`, `orgType` from secondary query, `useRequiredOrganization` throw behavior.
**File:** `tests/unit/use-organization.test.ts`
**Estimated tests:** ~10

### REQ-003: useUserRole unit tests
Test `useUserRole`, `useIsAdmin`, `useFeaturePermissions`, `useFeaturePermission`, `useCanManageCopilot`, `useHasRole` covering: dual-source role resolution (teamMember.role vs user_roles table), Edge Function `get-member-permissions` call and error handling, feature permission cascade (master > admin > features[key]).
**File:** `tests/unit/use-user-role.test.ts`
**Estimated tests:** ~12

### REQ-004: useMasterAuth unit tests
Test `useMasterAuth` and `useCanAccessMaster` covering: `isMaster` with `is_active` flag, `PGRST116` error handling, `hasPermission` with `all` flag, `isOutbounder` derivation, empty permissions object.
**File:** `tests/unit/use-master-auth.test.ts`
**Estimated tests:** ~10

### REQ-005: Permission hooks unit tests
Test `useHasPermission`, `useCanPerformAction` (sync), `useCanPerformActionAsync` (async) covering: full cascade logic for both sync and async, all `AppAction` values, admin/master bypass, feature-based gating, org permission RPC, matrix permission query, `send_message` always-allowed, fallback behavior. **Critical: document the divergence between sync (permissive fallback) and async (checks org/matrix permissions).**
**File:** `tests/unit/use-permissions-hooks.test.ts`
**Estimated tests:** ~25

### REQ-006: ProtectedRoute component tests
Test all 7+ branches: auth loading, no user redirect, `pending_payment` redirect (and allowlist bypass for `/checkout*`), team member loading, no team member redirect, no `organization_id` redirect, `is_active = false` deactivated UI, `teamMemberError` error UI, master bypass, `requireOrganization = false` skip.
**File:** `tests/unit/protected-route.test.tsx`
**Estimated tests:** ~15

### REQ-007: PermissionProtectedRoute component tests
Test all 5 branches: admin/master loading spinner, master renders children (skip feature check), admin renders children, feature permission loading, feature allowed/denied, custom fallback prop, nonexistent featureKey.
**File:** `tests/unit/permission-protected-route.test.tsx`
**Estimated tests:** ~10

### REQ-008: Seed data expansion
Expand `supabase/seed.sql` with additive INSERT statements (no modification to existing data):
- Org B with deterministic UUID
- Admin B + Member B users in Org B with auth.users + team_members
- Member 1 + Member 2 additional users in Org A (role: member)
- Leads in Org A with varying sdr_id/closer_id assignments (assigned to member 1, assigned to member 2, unassigned, both assigned)
- Leads in Org B (for cross-tenant isolation testing)
- `master_users` entry for the master user
- `organization_role_permissions` entries for Org A
- `feature_permissions` defaults for Org A (54 features)
- `member_feature_permissions` overrides (member 1 restricted, member 2 with view_all)
- `team_member_permissions` matrix entries
- Pipe entries (`pipe_whatsapp`, `pipe_confirmacao`, `pipe_propostas`) linked to test leads

### REQ-009: RLS test infrastructure (helpers)
Create `tests/integration/rls-helpers.ts` with:
- `createAuthenticatedClient(email, password)` -- Supabase client authenticated as a specific user
- `createServiceClient()` -- service_role client for setup/teardown
- Pre-built clients: `ORG_A_ADMIN_CLIENT`, `ORG_A_MEMBER_1_CLIENT`, `ORG_A_MEMBER_2_CLIENT`, `ORG_B_ADMIN_CLIENT`, `ORG_B_MEMBER_CLIENT`, `MASTER_CLIENT`
- Assertion helpers: `expectRowCount`, `expectAccessDenied`
- Lazy initialization (clients created once per suite)

Expand `tests/integration/setup.ts` with new test constants: `TEST_ORG_B_ID`, `TEST_MEMBER_1_ID`, `TEST_MEMBER_2_ID`, `TEST_ADMIN_B_ID`, `TEST_MEMBER_B_ID`.

### REQ-010: Cross-tenant isolation tests
Test all 73 RLS-enabled tables for org isolation. For each table:
- Org A admin can read own org data
- Org A admin CANNOT read Org B data
- Org B admin can read own org data
- Org B admin CANNOT read Org A data

Grouped by module: Core CRM (~12), Pipelines (~10), WhatsApp/Chat (~8), Campanhas (~7), Copilot/AI (~6), Org/Team (~8), Products/Upsell (~6), Workflows (~4), Integracoes (~8), Misc (~4).

Tables without seed data: verify SELECT returns 0 rows (not error), confirming RLS is enabled.
Tables with FK dependencies: use seed data chain (leads → pipe entries → history).
**Note:** "73 tables" is the count from migration analysis. The actual test will query the local DB for tables with RLS enabled and generate test cases dynamically, so the exact count may vary.
**File:** `tests/integration/rls-org-isolation.test.ts`

### REQ-011: Role-based access tests
Test Pattern C (admin-only write) and Pattern D (master bypass):
- Admin can INSERT/UPDATE/DELETE on config tables; member CANNOT
- Member CAN SELECT on config tables
- Master can read/write across both orgs
- Tables tested: tags, organization_role_permissions, feature_permissions, awards, goals, webhooks, custom_pipelines
**File:** `tests/integration/rls-role-based.test.ts`
**Estimated tests:** ~30

### REQ-012: Responsibility-based visibility tests
Test Pattern B on leads, pipe_whatsapp, pipe_confirmacao, pipe_propostas:
- Admin sees all org leads
- Member sees only leads where `sdr_id = self` OR `closer_id = self`
- Member does NOT see leads assigned to another member
- Member with `leads.view_all` feature permission sees ALL org leads
- Member with `see_unassigned_cards` org permission sees unassigned leads
- Member responsible in a pipe table sees the linked lead
- Cross-table consistency (lead visible in `leads` → also visible in corresponding pipe)
**File:** `tests/integration/rls-responsibility.test.ts`
**Estimated tests:** ~35

### REQ-013: Feature permission RLS tests
Test `has_feature_permission()` function behavior within RLS policies:
- Default feature permission applies when no member override
- Member override = true grants access even when default = false
- Member override = false denies access even when default = true
- Admin bypasses feature permissions
- `admin_only` feature blocks member even with override = true
- RPCs tested directly: `user_has_org_permission`, `has_feature_permission`, `is_user_admin`, `is_master_user`, `get_user_organization_id`
**File:** `tests/integration/rls-feature-permissions.test.ts`
**Estimated tests:** ~20

---

## Role Model in Tests

| Seed User | Role | Org | Purpose |
|---|---|---|---|
| Master | master_user + admin | Org A | Global access, master bypass |
| Admin A | admin | Org A | Full org access, write permissions |
| Member 1 | member | Org A | Leads assigned via `sdr_id`, restricted permissions |
| Member 2 | member | Org A | Leads assigned via `closer_id`, `leads.view_all = true` |
| Admin B | admin | Org B | Cross-tenant isolation counterpart |
| Member B | member | Org B | Cross-tenant isolation counterpart |

---

## Execution

**Unit tests (T2):** `npm run test:unit`
**Integration tests (T5):** `supabase start && supabase db reset && npm run test:integration`
**All:** `npm run test:all`

---

## Out of Scope

- Production code modifications
- RLS policy changes or new migrations
- Fix for sync/async permission divergence (documented by test, fixed separately)
- CONCERN-S1 / CONCERN-S3 (deferred per D003)
- Test coverage for non-auth hooks (useLeads, useCampanhas, etc.)

---

## Summary

| Layer | New Files | Expanded Files | Tests | Modifies Production? |
|-------|-----------|---------------|-------|---------------------|
| Unit (T2) | 7 | 0 | ~97 | No |
| Integration (T5) | 4 + 1 helper | 2 (setup.ts, seed.sql) | ~160 | No |
| **Total** | **12** | **2** | **~257** | **No** |


## Links relacionados

- [[MOC - Arquitetura]]

- [[Produtos]]

- [[Pipelines Customizados]]

- [[Checkout e Planos]]

- [[Premiacoes]]

- [[Metas]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Upsell]]

- [[Campanhas]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
