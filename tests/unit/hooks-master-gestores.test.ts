/**
 * Unit tests — useMasterGestores (ADR-0021 §8, S4 #1140).
 *
 * Cobre os hooks do Master para gerenciar Gestores de Portfólio:
 *  - useMasterGestores  → lista + junta bindings + profiles
 *  - useToggleGestorActive → update direto em `gestores`
 *  - useCreateGestor    → edge fn create-gestor (fetch)
 *  - useSetGestorOrgs   → edge fn manage-gestor-orgs (fetch)
 *
 * Mock do client Supabase (from + auth) e do fetch (edge fns). import.meta.env
 * via vi.stubEnv.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Chain mock helper (espelha hooks-sprint2-master-users) ----
function createChainMock(data: unknown[] = []) {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains", "order", "limit", "range", "insert", "update", "delete", "upsert", "not", "is", "filter", "match"].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "master-1" } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok" } } }),
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockFetch = vi.fn();

beforeAll(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

import {
  useMasterGestores,
  useCreateGestor,
  useToggleGestorActive,
  useSetGestorOrgs,
} from "@/modules/identity/master/hooks/useMasterGestores";

describe("useMasterGestores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista gestores juntando bindings e nome do perfil", async () => {
    const gestores = [
      { id: "g1", user_id: "u1", is_active: true, notes: "Agência X", created_at: "2026-01-01" },
      { id: "g2", user_id: "u2", is_active: false, notes: null, created_at: "2026-01-02" },
    ];
    const bindings = [
      { id: "b1", gestor_id: "g1", organization_id: "org-a", created_at: "2026-01-01" },
      { id: "b2", gestor_id: "g1", organization_id: "org-b", created_at: "2026-01-01" },
    ];
    const profiles = [{ id: "u1", full_name: "Fulano" }];

    let call = 0;
    mockFrom.mockImplementation((table: string) => {
      call++;
      if (table === "gestores") return createChainMock(gestores);
      if (table === "gestor_organizations") return createChainMock(bindings);
      if (table === "profiles") return createChainMock(profiles);
      return createChainMock([]);
    });

    const { result } = renderHook(() => useMasterGestores(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith("gestores");
    expect(mockFrom).toHaveBeenCalledWith("gestor_organizations");
    expect(mockFrom).toHaveBeenCalledWith("profiles");

    expect(result.current.data).toBeDefined();
    const rows = result.current.data!;
    expect(rows).toHaveLength(2);
    const g1 = rows.find((r) => r.id === "g1")!;
    expect(g1.full_name).toBe("Fulano");
    expect(g1.organization_ids.sort()).toEqual(["org-a", "org-b"]);
    const g2 = rows.find((r) => r.id === "g2")!;
    expect(g2.full_name).toBeNull();
    expect(g2.organization_ids).toEqual([]);
  });

  it("retorna vazio quando não há gestores (sem consultar bindings)", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "gestores") return createChainMock([]);
      return createChainMock([]);
    });
    const { result } = renderHook(() => useMasterGestores(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalledWith("gestor_organizations");
  });
});

describe("useToggleGestorActive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("atualiza is_active em gestores", async () => {
    const { result } = renderHook(() => useToggleGestorActive(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ gestorId: "g1", isActive: false });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("gestores");
  });
});

describe("useCreateGestor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, gestor_id: "g9", user_id: "u9" }),
    });
  });

  it("chama a edge fn create-gestor com email normalizado", async () => {
    const { result } = renderHook(() => useCreateGestor(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ email: "  GESTOR@X.com ", password: "secret1", organization_ids: ["org-a"] });
    });
    expect(mockFetch).toHaveBeenCalled();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/functions/v1/create-gestor");
    const sent = JSON.parse((opts as any).body);
    expect(sent.email).toBe("gestor@x.com");
    expect(sent.organization_ids).toEqual(["org-a"]);
    expect((opts as any).headers["X-User-JWT"]).toBe("tok");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("propaga erro quando a edge fn responde success:false", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, message: "Email inválido" }),
    });
    const { result } = renderHook(() => useCreateGestor(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ email: "bad" });
      } catch {}
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useSetGestorOrgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, bound: ["org-a", "org-b"] }),
    });
  });

  it("chama manage-gestor-orgs com o conjunto desejado", async () => {
    const { result } = renderHook(() => useSetGestorOrgs(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ gestorId: "g1", organizationIds: ["org-a", "org-b"] });
    });
    expect(mockFetch).toHaveBeenCalled();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/functions/v1/manage-gestor-orgs");
    const sent = JSON.parse((opts as any).body);
    expect(sent.gestor_id).toBe("g1");
    expect(sent.organization_ids).toEqual(["org-a", "org-b"]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
