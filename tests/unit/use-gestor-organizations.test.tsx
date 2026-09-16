import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  gestor: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: mocks.auth,
}));
vi.mock("@/modules/identity/gestor/hooks/useGestor", () => ({
  useGestor: mocks.gestor,
}));
import { useGestorOrganizations } from "@/modules/identity/gestor/hooks/useGestorOrganizations";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useGestorOrganizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue({ user: { id: "gestor-a" } });
    mocks.gestor.mockReturnValue({ isGestor: true });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  it("consulta API exclusiva do gestor sem argumentos de usuário ou organização", async () => {
    const { result } = renderHook(useGestorOrganizations, {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "gestor_organization_overview",
    );
  });

  it("não consulta sem identidade gestor", () => {
    mocks.gestor.mockReturnValue({ isGestor: false });
    renderHook(useGestorOrganizations, { wrapper: wrapper() });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("não consulta sem login", () => {
    mocks.auth.mockReturnValue({ user: null });
    renderHook(useGestorOrganizations, { wrapper: wrapper() });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("propaga acesso negado sem fallback para APIs master ou resultados vazios", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "access_denied" },
    });
    const { result } = renderHook(useGestorOrganizations, {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("não reutiliza organizações de outro login", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ organization_id: "org-a" }],
      error: null,
    });
    const { result, rerender } = renderHook(useGestorOrganizations, {
      wrapper: wrapper(),
    });
    await waitFor(() =>
      expect(result.current.data?.[0].organization_id).toBe("org-a"),
    );
    mocks.auth.mockReturnValue({ user: { id: "gestor-b" } });
    rerender();
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
