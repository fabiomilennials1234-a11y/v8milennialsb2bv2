# Test Helpers

## When to use `createMockSupabase`

Use for backend `_shared` modules and direct Supabase client calls that do NOT depend on React context (hooks, QueryClient, auth).

```typescript
import { createMockSupabase } from "../helpers/supabase-mock";

const { sb, mockTable } = createMockSupabase();
mockTable("leads", [{ id: "1", name: "Test", organization_id: "org-1" }]);

const result = await mySharedFunction(sb, "org-1");
expect(result).toEqual(...);
```

Supports: eq, neq, ilike, contains, in, gte, lte, gt, lt, is, or, textSearch, count queries, insert, update, upsert, delete, rpc, single, maybeSingle.

## When to use `createTestDB`

Use for frontend hooks that depend on React context: `useOrganization`, `useUserRole`, `useMasterAuth`, QueryClient, and the Supabase client mock with realtime channels.

### Setup pattern

Because `vi.mock` is hoisted, you need module-level mock declarations that delegate to mutable state. Import the shared refs from `test-db-mocks.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  mockSupabaseState,
  mockOrgState,
  mockUserRoleState,
  mockMasterAuthState,
  getAllMockRefs,
} from "../helpers/test-db-mocks";

// ── Hoisted mocks ──
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseState.from(...args),
    channel: (...args: unknown[]) => mockSupabaseState.channel(...args),
    removeChannel: (...args: unknown[]) => mockSupabaseState.removeChannel(...args),
  },
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => mockOrgState,
}));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => mockUserRoleState,
  useIsAdmin: () => ({ isAdmin: (mockUserRoleState.data as any)?.role === "admin", isLoading: false }),
}));
vi.mock("@/hooks/useMasterAuth", () => ({
  useMasterAuth: () => mockMasterAuthState,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: null, loading: false }),
}));
vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { id: "tm-1", organization_id: mockOrgState.organizationId, role: (mockUserRoleState.data as any)?.role ?? "admin" },
    isLoading: false,
  }),
}));

import { createTestDB } from "../helpers/test-db";
```

### Usage

```typescript
describe("useMyHook", () => {
  it("fetches leads for the org", async () => {
    const leads = [{ id: "1", name: "Alice", organization_id: "org-1" }];
    const { wrapper } = createTestDB(
      { leads, organizations: [{ id: "org-1" }] },
      { userRole: "admin", ...getAllMockRefs() },
    );

    const { result } = renderHook(() => useMyHook(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(leads));
  });

  it("respects master auth", () => {
    createTestDB({}, { isMaster: true, ...getAllMockRefs() });
    // mockMasterAuthState.isMaster is now true
  });

  it("emits realtime events", () => {
    const { emitRealtime, supabase, wrapper } = createTestDB(
      { leads: [] },
      { ...getAllMockRefs() },
    );

    const handler = vi.fn();
    const channel = supabase.channel("test");
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, handler);
    channel.subscribe();

    emitRealtime("leads", "INSERT", { id: "new-1", name: "New Lead" });
    expect(handler).toHaveBeenCalled();
  });
});
```

## Migration example: brittle-mock to createTestDB

### Before (brittle)

```typescript
const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));

function mockSelectChain(data: unknown[]) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  });
}

it("fetches data", async () => {
  mockSelectChain([{ id: "1" }]);
  const { result } = renderHook(() => useMyHook(), { wrapper: createWrapper() });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
});
```

### After (createTestDB)

```typescript
import { getAllMockRefs } from "../helpers/test-db-mocks";
// ... vi.mock declarations as above ...
import { createTestDB } from "../helpers/test-db";

it("fetches data", async () => {
  const { wrapper } = createTestDB(
    { my_table: [{ id: "1", organization_id: "org-1" }] },
    { ...getAllMockRefs() },
  );
  const { result } = renderHook(() => useMyHook(), { wrapper });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
});
```

Key benefits:
- No manual chain mocking (select/eq/order/etc.)
- Filters actually work (eq, ilike, in, contains, etc.)
- Realtime events testable via `emitRealtime`
- Context hooks (org, role, master) configured declaratively
- Single source of truth for test data
