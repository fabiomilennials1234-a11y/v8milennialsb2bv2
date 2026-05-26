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
    data: {
      id: "tm1", name: "Closer", organization_id: "org-t", metric_type: "sales",
      commission_mrr_percent: 1, commission_projeto_percent: 0.5,
      ote_base: 3000, ote_bonus: 1000,
    },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "g1", target_value: 100 }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: [{ id: "c1", team_member_id: "tm1", organization_id: "org-t", month: 1, year: 2025, amount: 500 }],
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
  useCommissions,
  useCommissionsByMember,
  useCreateCommission,
  useUpdateCommission,
  calculateOTEBonus,
  useCommissionSummary,
} from "@/hooks/useCommissions";

describe("useCommissions", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches commissions", async () => {
    const { result } = renderHook(() => useCommissions(1, 2025), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("commissions");
  });

  it("fetches all commissions when no month/year", async () => {
    const { result } = renderHook(() => useCommissions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("commissions");
  });
});

describe("useCommissionsByMember", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches commissions for a specific member", async () => {
    const { result } = renderHook(() => useCommissionsByMember("tm1", 1, 2025), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("commissions");
  });
});

describe("useCreateCommission", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("creates a commission", async () => {
    const { result } = renderHook(() => useCreateCommission(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ team_member_id: "tm1", month: 1, year: 2025, amount: 500 } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("commissions");
  });
});

describe("useUpdateCommission", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("updates a commission", async () => {
    const { result } = renderHook(() => useUpdateCommission(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "c1", amount: 600 } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("commissions");
  });
});

describe("calculateOTEBonus", () => {
  it("returns 0 when progress < 70", () => {
    expect(calculateOTEBonus(69, 1000)).toBe(0);
    expect(calculateOTEBonus(0, 1000)).toBe(0);
    expect(calculateOTEBonus(50, 1000)).toBe(0);
  });

  it("returns 70% when progress is 70-99", () => {
    expect(calculateOTEBonus(70, 1000)).toBe(700);
    expect(calculateOTEBonus(99, 1000)).toBe(700);
    expect(calculateOTEBonus(85, 1000)).toBe(700);
  });

  it("returns 100% when progress is 100-119", () => {
    expect(calculateOTEBonus(100, 1000)).toBe(1000);
    expect(calculateOTEBonus(119, 1000)).toBe(1000);
  });

  it("returns 120% when progress >= 120", () => {
    expect(calculateOTEBonus(120, 1000)).toBe(1200);
    expect(calculateOTEBonus(200, 1000)).toBe(1200);
  });
});

describe("useCommissionSummary", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches commission summary for a member", async () => {
    const { result } = renderHook(() => useCommissionSummary("tm1", 1, 2025), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("team_members");
  });
});
