/**
 * Regressão — incidente Riofix 2026-10-02 (loader infinito pós-login).
 *
 * Acessando por `www.torquecrm.com.br`, o CORS das edge functions devolvia a
 * origem sem `www` e o browser descartava a resposta de `get-member-permissions`
 * (servidor logava 200). A query entrava em erro; o ProtectedRoute liberava e o
 * layout montava hooks novos sobre a mesma query. Com `retryOnMount` padrão,
 * cada observer novo refazia a busca → `isLoading` voltava a true → o gate
 * desmontava a árvore → remontava → nova busca. Loop a cada ~2s, para sempre.
 *
 * Contrato: depois de falhar, a query só busca de novo quando alguém pede
 * (`refetch` / botão "tentar de novo"), nunca por montagem de componente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok" } } }),
    },
  },
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-1", role: "member" }, isLoading: false }),
}));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({ isMaster: false, isLoading: false }),
}));
vi.mock("@/modules/identity/gestor/hooks/useGestor", () => ({
  useGestor: () => ({ isGestor: false, isLoading: false }),
}));

import { useFeaturePermissions } from "@/modules/identity/permissions/hooks/useUserRole";

describe("useFeaturePermissions — falha não vira loop de remontagem", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // O que o browser entrega quando o CORS barra a resposta.
    fetchMock.mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("observer montado depois do erro não refaz a busca nem volta a carregar", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    // O gate (ProtectedRoute/useIdentity) observa a query e vê o erro.
    const gate = renderHook(() => useFeaturePermissions(), { wrapper });
    await waitFor(() => expect(gate.result.current.isError).toBe(true), { timeout: 4000 });
    const chamadasAteOErro = fetchMock.mock.calls.length;

    // O layout liberado monta componentes que observam a mesma query.
    const filho = renderHook(() => useFeaturePermissions(), { wrapper });

    expect(filho.result.current.isLoading).toBe(false);
    expect(gate.result.current.isLoading).toBe(false);
    // Dá chance de um refetch disparado pela montagem aparecer.
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(chamadasAteOErro);
    expect(gate.result.current.isLoading).toBe(false);
  });

  it("refetch explícito (tentar de novo) continua buscando", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result } = renderHook(() => useFeaturePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 });
    const antes = fetchMock.mock.calls.length;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ features: { "leads.view": true } }), { status: 200 }),
    );
    await result.current.refetch();

    await waitFor(() => expect(result.current.data).toEqual({ "leads.view": true }));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(antes);
  });
});
