import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ org: vi.fn(), from: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: mocks.org }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));
import { useClientPortfolioPurchases } from "./useClientPortfolioPurchases";
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function builder(result: unknown) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  for (const key of ["select", "eq", "in", "order", "range", "limit"] as const)
    q[key].mockReturnValue(q);
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.org.mockReturnValue({ organizationId: "org-a", isReady: true });
});
describe("consulta do histórico 360", () => {
  it("escopa CRM, clientes e pedidos pelo tenant autenticado", async () => {
    const sales = builder({ data: [], error: null });
    const clients = builder({ data: [{ id: "upsell-client" }], error: null });
    const orders = builder({
      data: [{ id: "order", sold_at: "2026-09-14", sale_value: 250 }],
      error: null,
    });
    const tables: Record<string, ReturnType<typeof builder>> = {
      sale_events: sales,
      upsell_clients: clients,
      upsell_orders: orders,
    };
    mocks.from.mockImplementation((table: string) => tables[table]);
    const { result } = renderHook(() => useClientPortfolioPurchases("lead-a"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const query of [sales, clients, orders])
      expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(sales.eq).toHaveBeenCalledWith("lead_id", "lead-a");
    expect(clients.eq).toHaveBeenCalledWith("lead_id", "lead-a");
    expect(orders.in).toHaveBeenCalledWith("client_id", ["upsell-client"]);
    expect(orders.eq).toHaveBeenCalledWith("approval_status", "approved");
    expect(result.current.data?.[0].source).toBe("Carteira");
  });
  it("não consulta sem organização pronta", () => {
    mocks.org.mockReturnValue({ organizationId: null, isReady: false });
    renderHook(() => useClientPortfolioPurchases("lead-a"), { wrapper });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("não converte erro de banco em histórico vazio", async () => {
    mocks.from.mockReturnValue(
      builder({ data: null, error: new Error("denied") }),
    );
    const { result } = renderHook(() => useClientPortfolioPurchases("lead-a"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("não soma pedido quando venda CRM já representa a compra", async () => {
    mocks.from.mockReturnValue(
      builder({
        data: [
          {
            id: "sale",
            lead_id: "lead-a",
            sold_at: "2026-09-14",
            sale_value: 250,
            event_type: "sale",
            reversed_event_id: null,
          },
        ],
        error: null,
      }),
    );
    const { result } = renderHook(() => useClientPortfolioPurchases("lead-a"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
it("resolve estorno após o limite de página e entrega histórico completo", async () => {
  const rows = Array.from({ length: 500 }, (_, n) => ({ id: `sale-${n}`, lead_id: "lead-a", sold_at: "2026-09-14", sale_value: n, event_type: "sale", reversed_event_id: null }));
  const first = builder({ data: rows, error: null });
  const second = builder({ data: [{ id: "reversal", lead_id: "lead-a", event_type: "sale_reversed", reversed_event_id: "sale-0", sold_at: "2026-09-15", sale_value: 0 }], error: null });
  mocks.from.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const { result } = renderHook(() => useClientPortfolioPurchases("lead-a"), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toHaveLength(499);
  expect(result.current.data?.some(p => p.id === "sale-0")).toBe(false);
  expect(second.range).toHaveBeenCalledWith(500, 999);
});
