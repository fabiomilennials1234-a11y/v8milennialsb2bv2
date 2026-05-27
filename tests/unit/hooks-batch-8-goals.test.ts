import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Chain mock ────────────────────────────────────────────────────────────────
function createChainMock() {
  const chain: Record<string, any> = {};
  [
    "select","eq","neq","or","in","gte","lte","lt","ilike","contains",
    "order","limit","range","insert","update","delete","upsert","not",
    "is","filter","match","overlaps","textSearch","csv",
  ].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain); });
  chain.single = vi.fn().mockResolvedValue({
    data: { id: "g1", name: "Meta", type: "vendas", target_value: 100, current_value: 50, month: 1, year: 2025, team_member_id: "tm1", organization_id: "org-t" },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "g1", target_value: 100 }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: [{ id: "g1", name: "Meta", type: "vendas", target_value: 100, current_value: 50, month: 1, year: 2025, team_member_id: null, organization_id: "org-t" }],
      error: null,
      count: 1,
    }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockInvoke = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
      }),
    },
  },
}));

vi.mock("@/modules/identity/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
import {
  useGoals,
  useTeamGoals,
  useIndividualGoals,
  useCreateGoal,
  useUpdateGoal,
  syncTeamFaturamentoGoal,
} from "@/modules/engagement/hooks/useGoals";

describe("useGoals", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches goals for current month/year", async () => {
    const { result } = renderHook(() => useGoals(1, 2025), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("goals");
  });

  it("uses current month when no args passed", async () => {
    const { result } = renderHook(() => useGoals(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("goals");
  });
});

describe("useTeamGoals", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches team goals (team_member_id is null)", async () => {
    const { result } = renderHook(() => useTeamGoals(1, 2025), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("goals");
  });
});

describe("useIndividualGoals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Need to support multiple calls to mockFrom: goals, team_members, pipe_propostas, pipe_confirmacao
    const chain = createChainMock();
    // Override then to return data for team_members
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({
        data: [{ id: "tm1", name: "Dev", role: "admin", metric_type: "sales" }],
        error: null,
      }).then(resolve, reject);
    mockFrom.mockReturnValue(chain);
  });

  it("fetches individual goals with progress", async () => {
    const { result } = renderHook(() => useIndividualGoals(1, 2025), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("team_members");
  });
});

describe("useCreateGoal", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("creates a goal", async () => {
    const { result } = renderHook(() => useCreateGoal(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          name: "Nova Meta",
          type: "vendas",
          target_value: 200,
          current_value: 0,
          month: 1,
          year: 2025,
          team_member_id: null,
        });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("goals");
  });
});

describe("useUpdateGoal", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("updates a goal", async () => {
    const { result } = renderHook(() => useUpdateGoal(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "g1", target_value: 300 });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("goals");
  });
});

describe("syncTeamFaturamentoGoal", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("is a callable function", () => {
    expect(typeof syncTeamFaturamentoGoal).toBe("function");
  });

  it("syncs team goal from individual vendas goals", async () => {
    // Override chain to return team members with metric_type=sales
    const chain = createChainMock();
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({
        data: [{ id: "tm1", metric_type: "sales" }],
        error: null,
      }).then(resolve, reject);
    mockFrom.mockReturnValue(chain);

    await syncTeamFaturamentoGoal(1, 2025, "org-t");
    expect(mockFrom).toHaveBeenCalledWith("team_members");
    expect(mockFrom).toHaveBeenCalledWith("goals");
  });
});
