/**
 * Carteira — venda manual entra APROVADA (regressão).
 *
 * Bug: order de "Nova Venda" nascia approval_status='pending' (default da coluna)
 * e ficava invisível pra métrica (get_portfolio_kpis / cron só contam approved).
 * Fix: hooks de criação manual setam approval_status:'approved' no insert e
 * invalidam as queries de KPI da carteira (que recomputam via trigger no insert).
 *
 * Este teste trava o payload do insert em upsell_orders + a invalidação.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

function createChainMock() {
  const chain: Record<string, any> = {};
  ["select", "eq", "update", "insert", "delete", "order", "limit"].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  // .single() resolve com um id (useNewOrder usa order.id p/ os itens)
  chain.single = vi.fn().mockResolvedValue({ data: { id: "order-1" }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: { id: "order-1" }, error: null }).then(resolve, reject);
  return chain;
}

let chains: Record<string, any>[] = [];
const mockFrom = vi.fn((table: string) => {
  const c = createChainMock();
  (c as any).__table = table;
  chains.push(c);
  return c;
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: any[]) => mockFrom(...args) },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import { useNewOrder } from "@/modules/carteira/hooks/useNewOrder";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper, invalidateSpy };
}

function insertPayloadFor(table: string) {
  const c = chains.find((x) => (x as any).__table === table);
  return c?.insert.mock.calls[0]?.[0];
}

describe("useNewOrder — auto-aprovar venda manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chains = [];
  });

  it("insere upsell_order com approval_status='approved'", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useNewOrder(), { wrapper });

    result.current.mutate({
      clientId: "client-1",
      items: [{ product_name: "Produto X", quantity: 2, unit_price: 100, unit: "un" }],
      source: "manual",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const payload = insertPayloadFor("upsell_orders");
    expect(payload).toMatchObject({
      organization_id: "org-1",
      client_id: "client-1",
      approval_status: "approved",
      sale_value: 200,
    });
    expect(payload.approved_at).toBeTruthy();
  });

  it("invalida os queryKeys de métrica da carteira no sucesso", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useNewOrder(), { wrapper });

    result.current.mutate({
      clientId: "client-2",
      items: [{ product_name: "Y", quantity: 1, unit_price: 50, unit: "un" }],
      source: "manual",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as any).queryKey[0]);
    expect(keys).toContain("portfolio-kpis");
    expect(keys).toContain("portfolio-clients");
    expect(keys).toContain("portfolio-trends");
  });
});
