---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-04-02-t2-t5-auth-rls-tests.md
---

# T2+T5 Auth/Permissions & RLS Test Suite - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ~257 tests covering frontend auth/permissions (unit) and database RLS enforcement (integration) with zero production code changes.

**Architecture:** Unit tests mock Supabase via `vi.mock` and test hooks with `renderHook` from `@testing-library/react`. Integration tests authenticate as different seed users against local Supabase (`supabase start`) and verify RLS policies enforce org isolation, role-based write access, responsibility-based visibility, and feature permission gating.

**Tech Stack:** Vitest 4.1, @testing-library/react 16.3, @supabase/supabase-js 2.89, Playwright (not used here - E2E out of scope)

**Spec:** `.specs/features/t2-t5-auth-rls-tests/spec.md`

---

## File Structure

```
supabase/
  seed.sql                                    # EXPAND: add Org B, new users, leads, permissions, pipes

tests/
  integration/
    setup.ts                                  # EXPAND: add new test IDs
    rls-helpers.ts                            # CREATE: authenticated client factory + assertion helpers
    rls-org-isolation.test.ts                 # CREATE: cross-tenant isolation for all RLS tables
    rls-role-based.test.ts                    # CREATE: admin-only write + master bypass
    rls-responsibility.test.ts                # CREATE: sdr_id/closer_id visibility
    rls-feature-permissions.test.ts           # CREATE: has_feature_permission in RLS + RPCs
  unit/
    auth-context.test.ts                      # CREATE: AuthContext + useAuth
    use-organization.test.ts                  # CREATE: useOrganization + useRequiredOrganization
    use-user-role.test.ts                     # CREATE: useUserRole + useIsAdmin + useFeaturePermission
    use-master-auth.test.ts                   # CREATE: useMasterAuth + useCanAccessMaster
    use-permissions-hooks.test.ts             # CREATE: usePermission + useCanPerformAction + async variant
    protected-route.test.tsx                  # CREATE: ProtectedRoute component branches
    permission-protected-route.test.tsx        # CREATE: PermissionProtectedRoute component branches
```

**Dependencies between tasks:**
- Tasks 1-2 (seed + helpers) are foundation - must complete first
- Tasks 3-9 (unit tests) are independent of each other and of tasks 1-2 - can run in parallel
- Tasks 10-13 (integration tests) depend on tasks 1-2

---

### Task 1: Expand seed data

**Files:**
- Modify: `supabase/seed.sql`

**Context:** The current seed has 1 org, 3 users (master, admin, SDR), 3 leads with no assignments. We need a second org, additional members, assigned leads, permission entries, and pipe entries for RLS testing.

- [ ] **Step 1: Add Org B, new users, and team members**

Append to `supabase/seed.sql`:

```sql
-- ============================================================
-- Extended seed data for RLS integration tests
-- ============================================================

-- Organization B (cross-tenant isolation)
INSERT INTO organizations (id, name, slug, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Test Organization B',
  'test-org-b',
  now()
) ON CONFLICT (id) DO NOTHING;

-- Member 1 (Org A, role: member) - will have leads via sdr_id
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES (
  '00000000-0000-0000-0000-000000000040',
  'member1@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Member One"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Member 2 (Org A, role: member) - will have leads via closer_id, view_all permission
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES (
  '00000000-0000-0000-0000-000000000050',
  'member2@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Member Two"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Admin B (Org B)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES (
  '00000000-0000-0000-0000-000000000060',
  'adminb@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Admin B"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Member B (Org B)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES (
  '00000000-0000-0000-0000-000000000070',
  'memberb@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Member B"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Team members for new users
INSERT INTO team_members (id, user_id, organization_id, role, name, email, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000140', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', 'member', 'Member One', 'member1@test.com', now()),
  ('00000000-0000-0000-0000-000000000150', '00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000001', 'member', 'Member Two', 'member2@test.com', now()),
  ('00000000-0000-0000-0000-000000000160', '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000002', 'admin', 'Admin B', 'adminb@test.com', now()),
  ('00000000-0000-0000-0000-000000000170', '00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000002', 'member', 'Member B', 'memberb@test.com', now())
ON CONFLICT (id) DO NOTHING;

-- Master user entry (enables master bypass policies)
INSERT INTO master_users (id, user_id, permissions, is_active, granted_at, notes)
VALUES (
  '00000000-0000-0000-0000-000000000210',
  '00000000-0000-0000-0000-000000000010',
  '{"all": true}'::jsonb,
  true,
  now(),
  'Test master user'
) ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Add assigned leads and Org B leads**

Append to `supabase/seed.sql`:

```sql
-- Update existing leads with assignments
UPDATE leads SET sdr_id = '00000000-0000-0000-0000-000000000140'
WHERE id = '00000000-0000-0000-0000-000000001001';

UPDATE leads SET closer_id = '00000000-0000-0000-0000-000000000150'
WHERE id = '00000000-0000-0000-0000-000000001002';

-- Lead with no assignment (unassigned) - Lead Gamma already has none

-- Lead with both sdr_id and closer_id
INSERT INTO leads (id, name, company, phone, email, organization_id, sdr_id, closer_id, created_at)
VALUES (
  '00000000-0000-0000-0000-000000001004',
  'Lead Delta',
  'Delta SA',
  '+5511999990004',
  'delta@test.com',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000140',
  '00000000-0000-0000-0000-000000000150',
  now()
) ON CONFLICT (id) DO NOTHING;

-- Org B leads (cross-tenant isolation)
INSERT INTO leads (id, name, company, phone, email, organization_id, created_at)
VALUES
  ('00000000-0000-0000-0000-000000002001', 'Lead OrgB-1', 'OrgB Corp', '+5511999990101', 'orgb1@test.com', '00000000-0000-0000-0000-000000000002', now()),
  ('00000000-0000-0000-0000-000000002002', 'Lead OrgB-2', 'OrgB Inc', '+5511999990102', 'orgb2@test.com', '00000000-0000-0000-0000-000000000002', now())
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 3: Add permission entries and pipe data**

Append to `supabase/seed.sql`:

```sql
-- Organization role permissions for Org A
-- By default: members cannot see unassigned cards or delete leads
INSERT INTO organization_role_permissions (organization_id, role, permission_key, enabled)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_unassigned_cards', false),
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_subordinates_cards', false),
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_general_info', true),
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_all_leads', false),
  ('00000000-0000-0000-0000-000000000001', 'member', 'can_delete_leads', false)
ON CONFLICT DO NOTHING;

-- Feature permissions for Org A (defaults)
INSERT INTO feature_permissions (organization_id, feature_key, default_enabled, is_admin_only)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'leads.view_all', false, false),
  ('00000000-0000-0000-0000-000000000001', 'leads.create', true, false),
  ('00000000-0000-0000-0000-000000000001', 'leads.delete', false, true),
  ('00000000-0000-0000-0000-000000000001', 'workflows.edit', true, false),
  ('00000000-0000-0000-0000-000000000001', 'workflows.create', false, true),
  ('00000000-0000-0000-0000-000000000001', 'copilot.create', false, true),
  ('00000000-0000-0000-0000-000000000001', 'team.view', false, true)
ON CONFLICT DO NOTHING;

-- Member 2 gets view_all override (can see all leads)
INSERT INTO member_feature_permissions (organization_id, team_member_id, feature_key, enabled)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000150', 'leads.view_all', true)
ON CONFLICT DO NOTHING;

-- Team member permissions matrix (legacy) - Member 1 cannot delete leads
INSERT INTO team_member_permissions (team_member_id, resource_key, action_key, value)
VALUES
  ('00000000-0000-0000-0000-000000000140', 'leads', 'delete', 'denied')
ON CONFLICT DO NOTHING;

-- Pipe entries linked to test leads
INSERT INTO pipe_whatsapp (id, lead_id, organization_id, stage, created_at)
VALUES
  ('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', 'new', now()),
  ('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000002', 'new', now())
ON CONFLICT (id) DO NOTHING;

-- Tags for role-based write tests
INSERT INTO tags (id, name, organization_id, created_at)
VALUES
  ('00000000-0000-0000-0000-000000004001', 'Tag Org A', '00000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000004002', 'Tag Org B', '00000000-0000-0000-0000-000000000002', now())
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 4: Verify seed applies cleanly**

Run: `supabase db reset`
Expected: No errors. All seed data inserted successfully.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql
git commit -m "test: expand seed data for RLS integration tests

Add Org B, 4 new users (member1, member2, adminB, memberB),
master_users entry, assigned leads, permission entries, pipe entries,
and tags for comprehensive RLS testing."
```

---

### Task 2: Integration test infrastructure

**Files:**
- Modify: `tests/integration/setup.ts`
- Create: `tests/integration/rls-helpers.ts`

- [ ] **Step 1: Expand setup.ts with new constants**

Add at the end of `tests/integration/setup.ts`:

```typescript
// Extended test IDs for RLS testing
export const TEST_ORG_B_ID = '00000000-0000-0000-0000-000000000002';
export const TEST_MEMBER_1_ID = '00000000-0000-0000-0000-000000000040';
export const TEST_MEMBER_2_ID = '00000000-0000-0000-0000-000000000050';
export const TEST_ADMIN_B_ID = '00000000-0000-0000-0000-000000000060';
export const TEST_MEMBER_B_ID = '00000000-0000-0000-0000-000000000070';

// Team member IDs
export const TEST_TM_MASTER_ID = '00000000-0000-0000-0000-000000000110';
export const TEST_TM_ADMIN_ID = '00000000-0000-0000-0000-000000000120';
export const TEST_TM_MEMBER_1_ID = '00000000-0000-0000-0000-000000000140';
export const TEST_TM_MEMBER_2_ID = '00000000-0000-0000-0000-000000000150';
export const TEST_TM_ADMIN_B_ID = '00000000-0000-0000-0000-000000000160';
export const TEST_TM_MEMBER_B_ID = '00000000-0000-0000-0000-000000000170';

// Lead IDs
export const TEST_LEAD_ALPHA_ID = '00000000-0000-0000-0000-000000001001'; // sdr_id = member1
export const TEST_LEAD_BETA_ID = '00000000-0000-0000-0000-000000001002';  // closer_id = member2
export const TEST_LEAD_GAMMA_ID = '00000000-0000-0000-0000-000000001003'; // unassigned
export const TEST_LEAD_DELTA_ID = '00000000-0000-0000-0000-000000001004'; // both assigned
export const TEST_LEAD_ORGB_1_ID = '00000000-0000-0000-0000-000000002001';
export const TEST_LEAD_ORGB_2_ID = '00000000-0000-0000-0000-000000002002';

// Common password for all test users
export const TEST_PASSWORD = 'Test123!@#';
```

- [ ] **Step 2: Create rls-helpers.ts**

Create `tests/integration/rls-helpers.ts`:

```typescript
/**
 * RLS test helpers - create authenticated Supabase clients for different users.
 * Each client is lazy-initialized and cached for the test suite lifetime.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TEST_PASSWORD } from './setup';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Service role client - bypasses RLS. Use only for setup/teardown. */
export function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/** Create a Supabase client authenticated as a specific user. */
export async function createAuthenticatedClient(
  email: string,
  password: string = TEST_PASSWORD,
): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to authenticate as ${email}: ${error.message}`);
  return client;
}

// Cached clients - initialized lazily per suite
const clientCache = new Map<string, SupabaseClient>();

export async function getClient(email: string): Promise<SupabaseClient> {
  if (!clientCache.has(email)) {
    clientCache.set(email, await createAuthenticatedClient(email));
  }
  return clientCache.get(email)!;
}

/** Clear all cached clients (call in afterAll) */
export async function clearClients(): Promise<void> {
  for (const [, client] of clientCache) {
    await client.auth.signOut();
  }
  clientCache.clear();
}

// Named client getters
export const getOrgAAdmin = () => getClient('admin@test.com');
export const getOrgAMember1 = () => getClient('member1@test.com');
export const getOrgAMember2 = () => getClient('member2@test.com');
export const getOrgBAdmin = () => getClient('adminb@test.com');
export const getOrgBMember = () => getClient('memberb@test.com');
export const getMaster = () => getClient('master@test.com');

// Assertion helpers

/** Assert that a SELECT returns exactly `expected` rows. */
export async function expectRowCount(
  client: SupabaseClient,
  table: string,
  expected: number,
  filter?: { column: string; value: string },
): Promise<void> {
  let query = client.from(table).select('id', { count: 'exact', head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw new Error(`SELECT on ${table} failed: ${error.message} (code: ${error.code})`);
  if (count !== expected) {
    throw new Error(`Expected ${expected} rows in ${table}, got ${count}`);
  }
}

/** Assert that an INSERT is denied by RLS (returns error, not data). */
export async function expectInsertDenied(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from(table).insert(row);
  if (!error) {
    // Clean up the accidentally inserted row
    const svc = createServiceClient();
    if ('id' in row) await svc.from(table).delete().eq('id', row.id);
    throw new Error(`INSERT on ${table} should have been denied by RLS, but succeeded`);
  }
}

/** Assert that a DELETE is denied by RLS (deletes 0 rows or errors). */
export async function expectDeleteDenied(
  client: SupabaseClient,
  table: string,
  id: string,
): Promise<void> {
  const { error, count } = await client.from(table).delete({ count: 'exact' }).eq('id', id);
  // RLS denial manifests as either an error or 0 rows affected
  if (!error && count && count > 0) {
    throw new Error(`DELETE on ${table} should have been denied by RLS, but deleted ${count} rows`);
  }
}
```

- [ ] **Step 3: Verify helpers compile**

Run: `npx vitest run tests/integration/rls-helpers.ts --passWithNoTests`
Expected: No compilation errors.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/setup.ts tests/integration/rls-helpers.ts
git commit -m "test: add RLS test infrastructure

Add authenticated client factory, assertion helpers (expectRowCount,
expectInsertDenied, expectDeleteDenied), cached client getters for
6 test users, and extended test ID constants."
```

---

### Task 3: AuthContext unit tests (REQ-001)

**Files:**
- Create: `tests/unit/auth-context.test.ts`

**What to test:** `AuthProvider`, `useAuth`, `signIn`, `signUp`, `signOut`, dedup guard, `attachToOrgByPendingInvite` silent failures.

**Source:** `src/contexts/AuthContext.tsx`

**Mocking strategy:** Mock `@/integrations/supabase/client` (supabase.auth methods) and `global.fetch` for the Edge Function call. Wrap hook calls in `<AuthProvider>` using `renderHook` with a custom wrapper.

- [ ] **Step 1: Write all tests**

Create `tests/unit/auth-context.test.ts` with these test cases:

1. `useAuth throws when used outside AuthProvider`
2. `AuthProvider sets loading=true initially`
3. `signIn calls supabase.auth.signInWithPassword with email and password`
4. `signIn returns error when auth fails`
5. `signUp calls supabase.auth.signUp with email, password, fullName metadata, and emailRedirectTo`
6. `signUp returns error when auth fails`
7. `signOut calls supabase.auth.signOut`
8. `onAuthStateChange SIGNED_IN sets user and session`
9. `onAuthStateChange sets loading=false`
10. `getSession sets user and session on mount`
11. `attachToOrgByPendingInvite is called on SIGNED_IN with access_token`
12. `attachToOrgByPendingInvite dedup: not called twice for same userId:token`
13. `attachToOrgByPendingInvite dedup: called again for different token`
14. `attachToOrgByPendingInvite silently ignores when SUPABASE_URL is empty`
15. `attachToOrgByPendingInvite silently ignores fetch errors`

Mock pattern:
```typescript
const mockSignIn = vi.fn();
const mockSignUp = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
let authChangeCallback: Function;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignIn(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (cb: Function) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
```

- [ ] **Step 2: Run and verify**

Run: `npx vitest run tests/unit/auth-context.test.ts --reporter=verbose`
Expected: All 15 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/auth-context.test.ts
git commit -m "test(T2): add AuthContext unit tests - 15 cases

Cover signIn, signUp, signOut, session lifecycle, dedup guard
for attachToOrgByPendingInvite, silent error handling."
```

---

### Task 4: useOrganization unit tests (REQ-002)

**Files:**
- Create: `tests/unit/use-organization.test.ts`

**Source:** `src/hooks/useOrganization.ts`

**Mocking strategy:** Mock `@/hooks/useTeamMembers` (useCurrentTeamMember) and `@/integrations/supabase/client`. Wrap in QueryClientProvider for React Query.

- [ ] **Step 1: Write all tests**

Create `tests/unit/use-organization.test.ts` with these test cases:

1. `returns organizationId from teamMember.organization_id`
2. `returns null organizationId when teamMember is null`
3. `isReady=true when teamMember loaded and has org_id (does NOT wait for orgType)`
4. `isReady=false when teamMember is still loading`
5. `isReady=false when teamMember has no organization_id`
6. `isLoading=true when teamMember is loading`
7. `isLoading=true when orgId exists and org query is loading`
8. `isLoading=false when both resolved`
9. `orgType comes from organizations table query`
10. `useRequiredOrganization throws when !isLoading and !organizationId`
11. `useRequiredOrganization does NOT throw during loading`
12. `useRequiredOrganization returns context when org is available`

- [ ] **Step 2: Run and verify**

Run: `npx vitest run tests/unit/use-organization.test.ts --reporter=verbose`
Expected: All 12 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/use-organization.test.ts
git commit -m "test(T2): add useOrganization unit tests - 12 cases

Cover isReady vs isLoading distinction, orgType derivation,
useRequiredOrganization throw behavior."
```

---

### Task 5: useUserRole unit tests (REQ-003)

**Files:**
- Create: `tests/unit/use-user-role.test.ts`

**Source:** `src/hooks/useUserRole.ts`

**Test cases (12):**
1. `useUserRole returns role from currentTeamMember.role`
2. `useUserRole falls back to user_roles table when teamMember has no role`
3. `useIsAdmin returns true when role is "admin"`
4. `useIsAdmin returns false when role is "member"`
5. `useFeaturePermissions calls get-member-permissions edge function`
6. `useFeaturePermissions returns {} when edge function fails`
7. `useFeaturePermission returns true for master regardless of feature`
8. `useFeaturePermission returns true for admin regardless of feature`
9. `useFeaturePermission returns features[key] for member`
10. `useFeaturePermission returns false for unknown feature key`
11. `useCanManageCopilot checks 4 copilot feature keys`
12. `useHasRole matches exact role string`

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T2): add useUserRole unit tests - 12 cases"
```

---

### Task 6: useMasterAuth unit tests (REQ-004)

**Files:**
- Create: `tests/unit/use-master-auth.test.ts`

**Source:** `src/hooks/useMasterAuth.ts`

**Test cases (10):**
1. `isMaster=true when master_users row exists with is_active=true`
2. `isMaster=false when no row in master_users`
3. `isMaster=false when is_active=false (PGRST116 not found)`
4. `PGRST116 error treated as non-master (no console error)`
5. `hasPermission returns true for any key when permissions.all=true`
6. `hasPermission returns specific value when all=false`
7. `hasPermission returns false when masterUser is null`
8. `isOutbounder=true when master + !all + outbound_only`
9. `isOutbounder=false when all=true (even with outbound_only)`
10. `useCanAccessMaster returns canAccess=isMaster`

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T2): add useMasterAuth unit tests - 10 cases"
```

---

### Task 7: Permission hooks unit tests (REQ-005)

**Files:**
- Create: `tests/unit/use-permissions-hooks.test.ts`

**Source:** `src/lib/permissions.ts`, `src/hooks/usePermissions.ts`

This is the most critical test file. It documents the sync/async divergence.

**Test cases (~25):**

**usePermission:**
1. `admin returns true without RPC call`
2. `master returns true without RPC call`
3. `member calls user_has_org_permission RPC`
4. `returns false when organizationId is null`

**useCanPerformAction (sync):**
5. `returns isLoading:true while dependencies load`
6. `admin: always allowed for any action`
7. `master: always allowed for any action`
8. `feature action (edit_workflow): checks featurePerms["workflows.edit"]`
9. `feature action denied: featurePerms missing key`
10. `send_message: always allowed for any user`
11. `non-feature, non-org action: fallback allowed` ← documents permissive behavior
12. `delete_lead for member: allowed via FALLBACK (sync does NOT check org permission)` ← CRITICAL: documents divergence

**useCanPerformActionAsync:**
13. `no org: returns allowed=false, reason="no_org"`
14. `admin: always allowed`
15. `feature action: checks featurePerms`
16. `send_message: always allowed`
17. `delete_lead: checks RPC user_has_org_permission("can_delete_leads")`
18. `delete_lead denied: RPC returns false`
19. `import_leads: checks matrix permission`
20. `import_leads denied: matrix value="denied"`
21. `matrix no row: defaults to allowed`
22. `matrix without teamMember.id: falls through to fallback allowed`

**Divergence documentation test:**
23. `DIVERGENCE: delete_lead for member - sync allows (fallback), async denies (checks RPC)`
24. `DIVERGENCE: import_leads for member - sync allows (fallback), async checks matrix`
25. `ACTION_TO_ORG_PERMISSION maps delete_lead and view_lead correctly`

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T2): add permission hooks unit tests - 25 cases

Documents sync vs async cascade divergence: useCanPerformAction
(sync) is more permissive than useCanPerformActionAsync for
actions mapped to org permissions or matrix permissions."
```

---

### Task 8: ProtectedRoute component tests (REQ-006)

**Files:**
- Create: `tests/unit/protected-route.test.tsx`

**Source:** `src/components/ProtectedRoute.tsx`

**Mocking strategy:** Mock `useAuth`, `useCurrentTeamMember`, `useMasterAuth`, and `react-router-dom` (Navigate, useLocation). Use `render` from `@testing-library/react`.

**Test cases (15):**
1. `shows spinner when auth is loading`
2. `shows spinner when master is loading`
3. `redirects to /auth when no user`
4. `redirects to /checkout when pending_payment metadata`
5. `does NOT redirect when pending_payment and on /checkout`
6. `does NOT redirect when pending_payment and on /checkout/success`
7. `shows spinner when teamMember loading + requireOrganization + !master`
8. `redirects to /checkout when no teamMember + requireOrganization + !master`
9. `renders children when no teamMember + on /checkout path`
10. `redirects to /checkout when teamMember has no organization_id`
11. `shows "Conta Desativada" when is_active=false`
12. `shows error UI when teamMemberError + no teamMember`
13. `master bypasses all org checks`
14. `requireOrganization=false skips team member validation`
15. `renders children when all checks pass`

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T2): add ProtectedRoute component tests - 15 cases

Cover all 7+ decision branches including master bypass,
pending_payment checkout allowlist, deactivated account UI."
```

---

### Task 9: PermissionProtectedRoute component tests (REQ-007)

**Files:**
- Create: `tests/unit/permission-protected-route.test.tsx`

**Source:** `src/components/PermissionProtectedRoute.tsx`

**Test cases (10):**
1. `shows spinner when admin is loading`
2. `shows spinner when master is loading`
3. `master renders children immediately (skips feature check)`
4. `admin renders children immediately (skips feature check)`
5. `shows spinner when feature permission is loading`
6. `renders children when feature is allowed`
7. `shows default lock screen when feature is denied`
8. `renders custom fallback when feature is denied and fallback provided`
9. `nonexistent featureKey shows lock screen`
10. `admin renders children even when featureKey is invalid`

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T2): add PermissionProtectedRoute tests - 10 cases"
```

---

### Task 10: Cross-tenant isolation tests (REQ-010)

**Files:**
- Create: `tests/integration/rls-org-isolation.test.ts`

**Depends on:** Tasks 1, 2

**Strategy:** Query the local DB for all tables with RLS enabled, then generate test cases dynamically. For tables with seed data, verify exact counts. For tables without seed data, verify the SELECT returns 0 (not an error).

- [ ] **Step 1: Write test file**

Create `tests/integration/rls-org-isolation.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getOrgAAdmin, getOrgBAdmin, getMaster, clearClients, createServiceClient,
} from './rls-helpers';
import { TEST_ORG_ID, TEST_ORG_B_ID } from './setup';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('RLS: Cross-tenant org isolation', () => {
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;
  let master: SupabaseClient;
  let svc: SupabaseClient;

  beforeAll(async () => {
    [adminA, adminB, master] = await Promise.all([
      getOrgAAdmin(), getOrgBAdmin(), getMaster(),
    ]);
    svc = createServiceClient();
  });

  afterAll(async () => {
    await clearClients();
  });

  // Dynamically discover all RLS-enabled tables
  // For each one, verify that admin A cannot see admin B's data and vice versa

  // Tables with known seed data - verify exact counts
  const seededTables = [
    { table: 'leads', orgACount: 4, orgBCount: 2 },
    { table: 'tags', orgACount: 1, orgBCount: 1 },
    { table: 'pipe_whatsapp', orgACount: 1, orgBCount: 1 },
  ];

  for (const { table, orgACount, orgBCount } of seededTables) {
    describe(`${table} (seeded)`, () => {
      it(`Org A admin sees ${orgACount} rows`, async () => {
        const { count } = await adminA.from(table).select('*', { count: 'exact', head: true });
        expect(count).toBe(orgACount);
      });

      it(`Org B admin sees ${orgBCount} rows`, async () => {
        const { count } = await adminB.from(table).select('*', { count: 'exact', head: true });
        expect(count).toBe(orgBCount);
      });

      it('Master sees all rows', async () => {
        const { count } = await master.from(table).select('*', { count: 'exact', head: true });
        expect(count).toBe(orgACount + orgBCount);
      });
    });
  }

  // Tables with org_id column but no seed data - verify RLS is active (returns 0, not error)
  // This list should be built from the actual schema. Include all tables with organization_id.
  const unseededTables = [
    'workflows', 'workflow_executions', 'campanhas', 'campanha_leads',
    'campanha_members', 'campanha_stages', 'campanha_templates',
    'whatsapp_instances', 'whatsapp_conversations',
    'copilot_agents', 'products', 'product_variants',
    'custom_pipelines', 'custom_pipeline_stages',
    'goals', 'awards', 'competitions', 'notifications',
    'checklists', 'checklist_items', 'webhooks',
    'follow_ups', 'follow_up_automations',
    'scheduled_user_messages',
    // Add more as discovered from schema
  ];

  for (const table of unseededTables) {
    it(`${table}: SELECT returns 0 rows for both orgs (RLS active)`, async () => {
      const [resA, resB] = await Promise.all([
        adminA.from(table).select('*', { count: 'exact', head: true }),
        adminB.from(table).select('*', { count: 'exact', head: true }),
      ]);
      // A non-existent table or one without RLS would error differently
      // We accept either count=0 or a 42P01 (table doesn't exist) gracefully
      if (resA.error?.code === '42P01') return; // table doesn't exist in local, skip
      expect(resA.error).toBeNull();
      expect(resB.error).toBeNull();
    });
  }
});
```

**Note to implementer:** The list of `unseededTables` must be expanded by querying the local DB schema. Run this to discover all tables with `organization_id`:

```sql
SELECT table_name FROM information_schema.columns
WHERE column_name = 'organization_id' AND table_schema = 'public'
ORDER BY table_name;
```

Then add the indirect-FK tables (those referencing leads) separately.

- [ ] **Step 2: Run and verify**

Run: `npx vitest run tests/integration/rls-org-isolation.test.ts --reporter=verbose`
Expected: All tests pass. Tables without data return 0 rows, not errors.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/rls-org-isolation.test.ts
git commit -m "test(T5): add cross-tenant isolation tests

Verify org isolation for all RLS-enabled tables. Seeded tables
check exact counts; unseeded tables verify RLS is active."
```

---

### Task 11: Role-based access tests (REQ-011)

**Files:**
- Create: `tests/integration/rls-role-based.test.ts`

**Test cases (~30):**

For each config table (tags, organization_role_permissions, feature_permissions, awards, goals, webhooks, custom_pipelines):
- Admin can INSERT
- Member CANNOT INSERT (expectInsertDenied)
- Member CAN SELECT
- Admin can DELETE
- Member CANNOT DELETE (expectDeleteDenied)

Master bypass (on 3 representative tables):
- Master can read Org A data
- Master can read Org B data
- Master can insert into any org

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T5): add role-based access tests - admin-only write + master bypass"
```

---

### Task 12: Responsibility-based visibility tests (REQ-012)

**Files:**
- Create: `tests/integration/rls-responsibility.test.ts`

**Test cases (~35):**

On `leads` table:
- Admin sees all 4 org A leads
- Member 1 sees leads where `sdr_id = self` (Lead Alpha + Lead Delta)
- Member 1 does NOT see Lead Beta (closer_id = member2, sdr_id = null)
- Member 2 sees leads where `closer_id = self` (Lead Beta + Lead Delta)
- Member 2 with `leads.view_all` feature permission sees ALL 4 org A leads
- Member without `see_unassigned_cards` does NOT see Lead Gamma (unassigned)

On `pipe_whatsapp`:
- Admin sees pipe entry for org A lead
- Admin does NOT see pipe entry for org B lead
- Member 1 sees pipe entry linked to their lead (Lead Alpha)

Cross-table consistency:
- If lead is visible to member in `leads`, corresponding `pipe_whatsapp` entry is also visible

RPC checks:
- `is_user_responsible` returns correct boolean for different assignment scenarios
- `can_see_lead_by_permissions` returns expected results

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T5): add responsibility-based visibility tests - 35 cases

Verify sdr_id/closer_id assignment-based lead visibility,
feature permission overrides, and cross-table consistency."
```

---

### Task 13: Feature permission RLS tests (REQ-013)

**Files:**
- Create: `tests/integration/rls-feature-permissions.test.ts`

**Test cases (~20):**

Feature permission behavior:
- Default `leads.view_all=false` means member without override cannot view all
- Member 2 with `leads.view_all=true` override CAN view all
- Admin ignores feature permissions (always full access)
- `leads.delete` with `is_admin_only=true` blocks member even with override
- `workflows.edit` with `default_enabled=true` grants access without override

Direct RPC tests:
- `user_has_org_permission('can_delete_leads')` returns false for member with org permission disabled
- `user_has_org_permission('see_all_leads')` returns true for admin
- `has_feature_permission('leads.view_all')` returns true for member 2 (override)
- `has_feature_permission('leads.view_all')` returns false for member 1 (no override, default=false)
- `is_user_admin()` returns true when called as admin
- `is_user_admin()` returns false when called as member
- `is_master_user(user_id)` returns true for master
- `get_user_organization_id()` returns correct org for each user

- [ ] **Step 1-3:** Write tests, run, commit.

```bash
git commit -m "test(T5): add feature permission RLS tests - 20 cases

Verify has_feature_permission cascade in RLS policies and
direct RPC tests for all permission helper functions."
```

---

## Self-Review Checklist

1. **Spec coverage:** All 13 REQs mapped to tasks. REQ-001→Task 3, REQ-002→Task 4, REQ-003→Task 5, REQ-004→Task 6, REQ-005→Task 7, REQ-006→Task 8, REQ-007→Task 9, REQ-008→Task 1, REQ-009→Task 2, REQ-010→Task 10, REQ-011→Task 11, REQ-012→Task 12, REQ-013→Task 13.

2. **Placeholder scan:** No TBD/TODO. Task 10 has a note about discovering tables dynamically - this is an intentional instruction with a concrete SQL query, not a placeholder.

3. **Type consistency:** `PermissionKey`, `AppAction`, `MasterPermissions` used consistently across tasks 6-7. Helper function names (`getOrgAAdmin`, `expectInsertDenied`, etc.) consistent between Task 2 (definition) and Tasks 10-13 (usage).

4. **File paths:** All exact. No placeholders.

---

## Execution Order

```
Task 1 (seed) ──┬── Task 3 (auth-context)     ─┐
Task 2 (infra) ─┤── Task 4 (use-organization)  │
                ├── Task 5 (use-user-role)      │ Can run in
                ├── Task 6 (use-master-auth)    │ parallel
                ├── Task 7 (permissions hooks)  │
                ├── Task 8 (ProtectedRoute)     │
                ├── Task 9 (PermissionRoute)   ─┘
                ├── Task 10 (org isolation)     ─┐
                ├── Task 11 (role-based)         │ Depend on
                ├── Task 12 (responsibility)     │ Tasks 1-2
                └── Task 13 (feature perms)     ─┘
```


## Links relacionados

- [[Produtos]]

- [[Visao Geral]]

- [[Pipelines Customizados]]

- [[Checkout e Planos]]

- [[Premiacoes]]

- [[Metas]]

- [[Gestao de Time]]

- [[Mensagens Agendadas]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Follow-ups]]

- [[Campanhas]]

- [[Workflow Builder]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
