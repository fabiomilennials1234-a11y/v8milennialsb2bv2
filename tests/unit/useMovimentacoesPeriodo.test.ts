import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────
const mockRpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

let orgId: string | null = "org-1";
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: orgId }),
}));

import { useMovimentacoesPeriodo } from "@/modules/analytics/hooks/useMovimentacoesPeriodo";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const START = new Date("2026-07-01T00:00:00.000Z");
const END = new Date("2026-07-31T23:59:59.999Z");

describe("useMovimentacoesPeriodo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgId = "org-1";
  });

  it("chama get_movement_metrics com org, intervalo ISO e member null", async () => {
    mockRpc.mockResolvedValue({
      data: [{ marcadas: 8, comparecidas: 5, vendido_count: 12, vendido_receita: 48500 }],
      error: null,
    });

    const { result } = renderHook(() => useMovimentacoesPeriodo(START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith("get_movement_metrics", {
      p_org_id: "org-1",
      p_start: START.toISOString(),
      p_end: END.toISOString(),
      p_member_id: null,
    });
    expect(result.current.marcadas).toBe(8);
    expect(result.current.comparecidas).toBe(5);
    expect(result.current.vendidoCount).toBe(12);
    expect(result.current.vendidoReceita).toBe(48500);
    expect(result.current.isError).toBe(false);
  });

  it("passa p_member_id quando fornecido", async () => {
    mockRpc.mockResolvedValue({ data: [{ marcadas: 1, comparecidas: 0, vendido_count: 0, vendido_receita: 0 }], error: null });

    renderHook(() => useMovimentacoesPeriodo(START, END, "member-9"), { wrapper: createWrapper() });

    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith(
      "get_movement_metrics",
      expect.objectContaining({ p_member_id: "member-9" }),
    );
  });

  it("normaliza receita string do Postgres (numeric) para number", async () => {
    mockRpc.mockResolvedValue({
      data: [{ marcadas: 0, comparecidas: 0, vendido_count: 2, vendido_receita: "1234.50" }],
      error: null,
    });

    const { result } = renderHook(() => useMovimentacoesPeriodo(START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.vendidoReceita).toBe(1234.5);
  });

  it("desabilita a query sem organizationId", () => {
    orgId = null;
    const { result } = renderHook(() => useMovimentacoesPeriodo(START, END), {
      wrapper: createWrapper(),
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.marcadas).toBe(0);
  });

  it("desabilita a query com intervalo incompleto (start/end null)", () => {
    const { result } = renderHook(() => useMovimentacoesPeriodo(null, null), {
      wrapper: createWrapper(),
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.vendidoReceita).toBe(0);
  });

  it("propaga erro da RPC (isError)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom", code: "P0001" } });

    const { result } = renderHook(() => useMovimentacoesPeriodo(START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.marcadas).toBe(0);
  });
});
