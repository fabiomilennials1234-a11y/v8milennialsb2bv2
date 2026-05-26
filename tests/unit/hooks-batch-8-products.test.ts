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
  chain.single = vi.fn().mockResolvedValue({ data: { id: "p1", name: "Produto A", organization_id: "org-t", type: "mrr", is_active: true }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "p1" }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: [{ id: "p1", name: "Produto A", type: "mrr", is_active: true, organization_id: "org-t" }], error: null, count: 1 }).then(resolve, reject);
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
  useProducts,
  useProductsWithVariants,
  useActiveProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from "@/hooks/useProducts";

describe("useProducts", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches products for the organization", async () => {
    const { result } = renderHook(() => useProducts(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("products");
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useProductsWithVariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = createChainMock();
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({
        data: [{ id: "p1", name: "Produto A", type: "mrr", is_active: true, organization_id: "org-t", product_variants: [{ id: "v1", name: "Var A" }] }],
        error: null,
      }).then(resolve, reject);
    mockFrom.mockReturnValue(chain);
  });

  it("fetches products with variants", async () => {
    const { result } = renderHook(() => useProductsWithVariants(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("products");
    expect(result.current.data![0].variants).toHaveLength(1);
  });
});

describe("useActiveProducts", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches only active products", async () => {
    const { result } = renderHook(() => useActiveProducts(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("products");
  });
});

describe("useCreateProduct", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("creates a product", async () => {
    const { result } = renderHook(() => useCreateProduct(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "Novo Produto", type: "mrr", is_active: true, organization_id: "org-t" } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("products");
  });
});

describe("useUpdateProduct", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("updates a product", async () => {
    const { result } = renderHook(() => useUpdateProduct(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "p1", name: "Atualizado" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("products");
  });
});

describe("useDeleteProduct", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("deletes a product", async () => {
    const { result } = renderHook(() => useDeleteProduct(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("p1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("products");
  });
});
