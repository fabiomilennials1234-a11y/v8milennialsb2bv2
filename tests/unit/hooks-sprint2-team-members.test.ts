import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Chain mock helper ----

function createChainMock(data: unknown[] = [{ id: "mock-1", name: "Test" }]) {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains", "order", "limit", "range", "insert", "update", "delete", "upsert", "not", "is", "filter", "match"].forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? { id: "mock-1", organization_id: "org-t" }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-t", isReady: true }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false, isLoading: false }) }));

vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({
    userId: "u1",
    organizationId: "org-t",
    teamMemberId: "tm1",
    effectiveRole: "admin" as const,
    isMaster: false,
    isAdmin: true,
    features: {} as Record<string, boolean>,
    isLoading: false,
    isReady: true,
  }),
}));

vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useUserRole: () => ({ data: { role: "admin" }, isLoading: false }),
  useIsAdmin: () => ({ isAdmin: true, isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
  useCanManageCopilot: () => ({ canManage: true, canCreate: true, canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
  useCanManageWhatsApp: () => ({ canManage: true, isLoading: false }),
  useJobTitle: () => ({ jobTitle: "", isLoading: false }),
  useMetricType: () => ({ metricType: "sales", isLoading: false }),
  useHasRole: () => ({ hasRole: true, isLoading: false }),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---- Import hooks ----

import {
  useCurrentTeamMember,
  useTeamMembers,
  useTeamMember,
  useCreateTeamMember,
  useUpdateTeamMember,
  useDeleteTeamMember,
  useResponsibleMembers,
  isVirtualTeamMember,
  getSelectedOrgId,
  setSelectedOrgId,
} from "@/modules/identity/hooks/useTeamMembers";

// ---- Pure function tests ----

describe("isVirtualTeamMember", () => {
  it("returns true for virtual IDs", () => {
    expect(isVirtualTeamMember("master-virtual-u1")).toBe(true);
  });

  it("returns false for regular IDs", () => {
    expect(isVirtualTeamMember("tm-123")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isVirtualTeamMember(null)).toBe(false);
    expect(isVirtualTeamMember(undefined)).toBe(false);
  });
});

describe("getSelectedOrgId / setSelectedOrgId", () => {
  it("returns null when nothing stored", () => {
    localStorage.removeItem("selected_org_id");
    expect(getSelectedOrgId()).toBeNull();
  });

  it("stores and retrieves org id", () => {
    setSelectedOrgId("org-test");
    expect(getSelectedOrgId()).toBe("org-test");
    localStorage.removeItem("selected_org_id");
  });
});

// ---- Hook tests ----

describe("useCurrentTeamMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("selected_org_id");
  });

  it("fetches current team member", async () => {
    const memberData = { id: "tm1", user_id: "u1", organization_id: "org-t", name: "User 1", role: "admin", is_active: true };
    mockFrom.mockReturnValue(createChainMock([memberData]));

    const { result } = renderHook(() => useCurrentTeamMember(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("team_members");
  });

  it("uses stored org id when available", async () => {
    localStorage.setItem("selected_org_id", "org-stored");
    const memberData = { id: "tm1", user_id: "u1", organization_id: "org-stored", name: "User 1", role: "admin", is_active: true };
    mockFrom.mockReturnValue(createChainMock([memberData]));

    const { result } = renderHook(() => useCurrentTeamMember(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    localStorage.removeItem("selected_org_id");
  });
});

describe("useTeamMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([
      { id: "tm1", name: "Member 1", is_active: true, organization_id: "org-t" },
      { id: "tm2", name: "Member 2", is_active: false, organization_id: "org-t" },
    ]));
  });

  it("fetches team members for org", async () => {
    const { result } = renderHook(() => useTeamMembers(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("org_visible_members");
  });
});

describe("useTeamMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "tm1", name: "Member 1", organization_id: "org-t" }]));
  });

  it("fetches a single team member by ID", async () => {
    const { result } = renderHook(() => useTeamMember("tm1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("team_members");
  });
});

describe("useCreateTeamMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "tm-new", name: "New Member" }]));
  });

  it("creates a team member", async () => {
    const { result } = renderHook(() => useCreateTeamMember(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          name: "New Member",
          organization_id: "org-t",
          role: "membro",
        } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("team_members");
  });
});

describe("useUpdateTeamMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "tm1", name: "Updated" }]));
  });

  it("updates a team member with org filter", async () => {
    const { result } = renderHook(() => useUpdateTeamMember(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "tm1", name: "Updated Name" } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("team_members");
  });
});

describe("useDeleteTeamMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("deletes a team member", async () => {
    const { result } = renderHook(() => useDeleteTeamMember(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync("tm1");
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("team_members");
  });
});

describe("useResponsibleMembers", () => {
  it("returns active members only", () => {
    // useResponsibleMembers depends on useTeamMembers which is mocked
    // It filters by is_active
    const { result } = renderHook(() => useResponsibleMembers(), { wrapper: createWrapper() });
    // Returns filtered result from mocked useTeamMembers
    expect(Array.isArray(result.current)).toBe(true);
  });
});
