/**
 * Hover do card aquece a ficha nas MESMAS chaves que ela lê: depois do
 * prefetch, montar `useLeadDetail` + `useLeadsDeals` não vai à rede de novo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));
vi.mock("@/modules/platform/hooks/useTrackView", () => ({ useTrackView: () => {} }));

import { prefetchFicha, usePrefetchFicha } from "@/modules/leads/lib/prefetchFicha";
import { useLeadDetail } from "@/modules/leads/components/lead-detail/hooks/useLeadDetail";
import { useLeadsDeals } from "@/modules/leads/hooks/useLeadsDeals";

function encadeado(data: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "is", "limit", "not"]) c[m] = () => c;
  c.single = () => Promise.resolve({ data, error: null });
  (c as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
  return c;
}

const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe("prefetch da ficha", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
    rpc.mockReset().mockResolvedValue({ data: { status: "exists", metadata: {} }, error: null });
    from.mockReset().mockImplementation(() => encadeado({ id: "lead-1", name: "Ana" }));
  });

  it("chave igual à da ficha: montar depois do prefetch não busca de novo", async () => {
    // Idas que o prefetch cobre: visibilidade (rpc), linha do lead e negócios.
    const AQUECIDAS = new Set(["leads", "pipeline_entries", "pipelines", "pipeline_stages"]);
    const idas = () => rpc.mock.calls.length + from.mock.calls.filter(([t]) => AQUECIDAS.has(t as string)).length;
    await prefetchFicha(qc, { leadId: "lead-1", organizationId: "org-1" });
    const idasAntes = idas();
    expect(idasAntes).toBe(5);

    const { result } = renderHook(
      () => ({ ficha: useLeadDetail("lead-1", true), negocios: useLeadsDeals(["lead-1"]) }),
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(result.current.ficha.lead).toEqual({ id: "lead-1", name: "Ana" }));
    expect(result.current.negocios.data).toBeDefined();
    expect(idas()).toBe(idasAntes);
  });

  it("lead que a pessoa não pode ver: só a checagem, a linha não é buscada", async () => {
    rpc.mockResolvedValue({ data: { status: "permission_denied", metadata: {} }, error: null });
    await prefetchFicha(qc, { leadId: "lead-1", organizationId: "org-1" });
    expect(from).not.toHaveBeenCalled();
    expect(qc.getQueryData(["lead-detail", "lead-1"])).toBeUndefined();
  });

  it("usePrefetchFicha: um aquecimento em voo por vez", async () => {
    let soltar!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((r) => (soltar = r)));
    const { result } = renderHook(() => usePrefetchFicha(), { wrapper: wrap(qc) });
    act(() => {
      result.current("lead-1");
      result.current("lead-2");
      result.current(null);
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => soltar({ data: { status: "not_found", metadata: {} }, error: null }));
  });
});
