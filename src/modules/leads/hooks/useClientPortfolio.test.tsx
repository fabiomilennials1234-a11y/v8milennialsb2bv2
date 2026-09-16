import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ org: vi.fn(), rpc: vi.fn(), realtime: vi.fn(), abort: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: mocks.org }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: mocks.realtime }));
import { useClientPortfolio } from "./useClientPortfolio";
import { portfolioFilters } from "../lib/client-portfolio-contract";
const data = { asOf: "2026-09-16T12:00:00+00:00", total: 123, summary: { monthlyRevenue: 45000, expectedCount: 12, overdueCount: 8 }, clients: [] };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.org.mockReturnValue({ organizationId: "org-a", isReady: true });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
  mocks.abort.mockResolvedValue({ data, error: null });
});
describe("carteira global", () => {
  it("envia tenant autenticado, filtros e offset e preserva agregados globais", async () => {
    const { result } = renderHook(() => useClientPortfolio({ searchQuery: " Aurora " }, "ouro", "late", 2), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith("client_portfolio_page", expect.objectContaining({ p_organization_id: "org-a", p_limit: 50, p_offset: 100, p_filters: expect.objectContaining({ search: "Aurora", segment: "ouro", reorder: "late" }) }));
    expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result.current.data?.total).toBe(123);
    expect(result.current.data?.summary.monthlyRevenue).toBe(45000);
  });
  it("troca de organização não reutiliza dados de outra conta", async () => {
    const { result, rerender } = renderHook(() => useClientPortfolio({}, "all", "all", 0), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    mocks.org.mockReturnValue({ organizationId: "org-b", isReady: true });
    rerender();
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith("client_portfolio_page", expect.objectContaining({ p_organization_id: "org-b" })));
  });
  it("não consulta sem organização", () => {
    mocks.org.mockReturnValue({ organizationId: null, isReady: false });
    renderHook(() => useClientPortfolio({}, "all", "all", 0), setup());
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: new Error("denied") }, { data: { ...data, total: -1 }, error: null }])("erro ou contrato inválido não vira carteira vazia", async (response) => {
    mocks.abort.mockResolvedValue(response);
    const { result } = renderHook(() => useClientPortfolio({}, "all", "all", 0), setup());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
  it("normaliza preferência persistida e preserva precedência Café/ERP", () => {
    expect(portfolioFilters({ usaCadastroErpCafeJurere: true, usaLeiDoErp: true, filterResponsible: "broken", searchQuery: "x".repeat(300) }, "all", "soon")).toMatchObject({ source: "cafe", responsible: "all", search: "x".repeat(250) });
  });
});
