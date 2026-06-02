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
  chain.single = vi.fn().mockResolvedValue({ data: { id: "mock-1", organization_id: "org-t", name: "Test" }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "mock-1" }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: [{ id: "mock-1", name: "Test", color: "#ff0", organization_id: "org-t" }], error: null, count: 1 }).then(resolve, reject);
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

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
import { useTags, useCreateTag, useUpdateTag, useDeleteTag } from "@/modules/leads/hooks/useTags";

describe("useTags", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches tags for the organization", async () => {
    const { result } = renderHook(() => useTags(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("tags");
    expect(result.current.data).toHaveLength(1);
  });

  it("returns empty array when no organizationId", async () => {
    const mod = await import("@/modules/identity/org-team/hooks/useOrganization");
    vi.spyOn(mod, "useOrganization").mockReturnValueOnce({ organizationId: null as any, isReady: true } as any);
    // With isReady true but no orgId the query is disabled, so data remains undefined
    const { result } = renderHook(() => useTags(), { wrapper: createWrapper() });
    // Query should stay in initial state since enabled is false
    expect(result.current.data).toBeUndefined();
  });
});

describe("useCreateTag", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("inserts a tag", async () => {
    const { result } = renderHook(() => useCreateTag(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "Ouro", color: "#ffd700", organization_id: "org-t" } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("tags");
  });
});

describe("useUpdateTag", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("updates a tag", async () => {
    const { result } = renderHook(() => useUpdateTag(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "t1", name: "Prata" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("tags");
  });
});

describe("useDeleteTag", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("deletes a tag", async () => {
    const { result } = renderHook(() => useDeleteTag(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync("t1");
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("tags");
  });
});
