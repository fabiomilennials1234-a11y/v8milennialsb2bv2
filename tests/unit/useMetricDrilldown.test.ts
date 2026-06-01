import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMetricDrilldown } from "@/modules/carteira/hooks/useMetricDrilldown";
import React from "react";

const orgMock = vi.fn();
vi.mock("@/modules/identity", () => ({
  useOrganization: (...a: unknown[]) => orgMock(...a),
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelineEntries", () => ({
  usePipelineId: () => ({ data: "pipe-123" }),
}));

const supabaseFromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => supabaseFromMock(...a),
  },
}));

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function makeQueryChain(data: any[] | null, error: any = null) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.not.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.gte.mockReturnValue(chain);
  chain.lte.mockReturnValue(chain);
  return chain;
}

const SOLD_ENTRY = {
  id: "p1",
  lead_id: "l1",
  stage_key: "vendido",
  metadata: { sale_value: 3000, product_type: "mrr" },
  closed_at: "2026-05-10T00:00:00Z",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-10T00:00:00Z",
  lead: { name: "Acme Corp Lead", company: "Acme Corp" },
  responsible: { name: "João" },
};

const ACTIVE_ENTRY = {
  id: "p2",
  lead_id: "l2",
  stage_key: "proposta_enviada",
  metadata: { sale_value: 5000 },
  closed_at: null,
  created_at: "2026-05-03T00:00:00Z",
  updated_at: "2026-05-03T00:00:00Z",
  lead: { name: "Beta Lead", company: "Beta Inc" },
  responsible: { name: "Maria" },
};

beforeEach(() => {
  orgMock.mockReset();
  supabaseFromMock.mockReset();
  orgMock.mockReturnValue({ organizationId: "org-1", isReady: true });
});

describe("useMetricDrilldown", () => {
  it("returns active proposals for pipeline_ativo", async () => {
    const chain = makeQueryChain([ACTIVE_ENTRY]);
    supabaseFromMock.mockReturnValue(chain);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMetricDrilldown("pipeline_ativo", null), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].status).toBe("proposta_enviada");
    expect(chain.in).toHaveBeenCalledWith("stage_key", expect.arrayContaining(["proposta_enviada", "marcar_compromisso"]));
  });

  it("returns sold proposals for vendas_total with period filter", async () => {
    const chain = makeQueryChain([SOLD_ENTRY]);
    supabaseFromMock.mockReturnValue(chain);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const range = { startStr: "2026-05-01T00:00:00Z", endStr: "2026-05-31T23:59:59.999Z" };
    const { result } = renderHook(() => useMetricDrilldown("vendas_total", range), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].status).toBe("vendido");
    expect(result.current.data![0].sale_value).toBe(3000);
    expect(chain.eq).toHaveBeenCalledWith("stage_key", "vendido");
  });

  it("returns all proposals for taxa_conversao", async () => {
    const chain = makeQueryChain([SOLD_ENTRY, ACTIVE_ENTRY]);
    supabaseFromMock.mockReturnValue(chain);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMetricDrilldown("taxa_conversao", null), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);
  });

  it("skips period filter when range is null", async () => {
    const chain = makeQueryChain([SOLD_ENTRY]);
    supabaseFromMock.mockReturnValue(chain);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useMetricDrilldown("vendas_total", null), { wrapper: wrap(qc) });
    await waitFor(() => expect(chain.order).toHaveBeenCalled());
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.lte).not.toHaveBeenCalled();
  });

  it("does not fetch when organizationId is null", () => {
    orgMock.mockReturnValue({ organizationId: null, isReady: false });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMetricDrilldown("vendas_total", null), { wrapper: wrap(qc) });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("extracts sale_value and product_type from metadata", async () => {
    const chain = makeQueryChain([SOLD_ENTRY]);
    supabaseFromMock.mockReturnValue(chain);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMetricDrilldown("vendas_total", null), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data![0].sale_value).toBe(3000);
    expect(result.current.data![0].product_type).toBe("mrr");
    expect(result.current.data![0].lead?.name).toBe("Acme Corp Lead");
  });
});
