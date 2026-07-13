/**
 * Issue #999 (SP-3): useTVKPIs lê ticket e conversão do caderno canônico
 * get_sales_metrics (#995) — SEM recompute client-side sobre array truncado.
 *  - ticket_mrr / ticket_proj = revenue/sale_count por stream (derive de
 *    agregados do servidor, não re-agregação de entries).
 *  - conversao = won / (won + lost).
 *  - reunioes = meeting_events (useSDRPerformance) — mesma fonte do funil (R6).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const SALES_METRICS_JSON = {
  period: { name: "range", start: "2026-07-01T00:00:00Z", end: "2026-07-31T00:00:00Z" },
  pipeline_id: null,
  filter_member_id: null,
  revenue_total: 30000,
  revenue_by_stream: {
    novo_negocio: { revenue: 20000, sale_count: 2 }, // ticket 10000
    carteira: { revenue: 9000, sale_count: 3 },      // ticket 3000
  },
  won_count: 3,
  lost_count: 1, // won/(won+lost) = 3/4 = 75%
  ticket_medio: 10000,
  by_closer: [{ member_id: "tm1", revenue: 30000, sale_count: 3 }],
  unattributed: { revenue: 0, sale_count: 0 },
};

const rpcMock = vi.fn().mockImplementation((fn: string) =>
  fn === "get_sales_metrics"
    ? Promise.resolve({ data: SALES_METRICS_JSON, error: null })
    : Promise.resolve({ data: null, error: null })
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
    }),
    rpc: (...args: unknown[]) => rpcMock(...(args as [string])),
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
}));

// canonical_metrics dark-launch flag (U3). Default ON so the overlay assertions
// above keep exercising the canonical path; the OFF gate test flips it.
let canonicalFlag = { enabled: true, isLoading: false };
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => canonicalFlag,
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipeWhatsapp", () => ({
  usePipeWhatsapp: () => ({ data: [{ id: "w1", status: "novo" }, { id: "w2", status: "abordado" }] }),
  useCreatePipeWhatsapp: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useUpdatePipeWhatsapp: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipePropostas", () => ({
  usePipePropostas: () => ({ data: [] }),
  useCreatePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useUpdatePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useDeletePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({
  usePipeConfirmacao: () => ({ data: [] }),
  useCreatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useUpdatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useDeletePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/engagement/hooks/useSDRPerformance", () => ({
  useSDRPerformance: () => ({
    totals: { marcadas: 5, comparecidas: 4, noShow: 1, noShowRate: 20 },
    bySDR: [],
  }),
}));
vi.mock("@/modules/engagement/hooks/useCloserPerformance", () => ({
  useCloserPerformance: () => ({
    totals: { reunioesRealizadas: 0, propostas: 7, vendas: 3, vendasValor: 30000, ticketMedio: 10000, conversao: 999 },
    byCloser: [],
    topCloserId: null,
  }),
}));
vi.mock("@/modules/leads/hooks/useNewLeads", () => ({ useNewLeads: () => ({ total: 12 }) }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

import { useTVKPIs } from "@/modules/analytics/hooks/useTVKPIs";
import { getPeriodRange } from "@/lib/tv-periods";

describe("useTVKPIs — leitura canônica (get_sales_metrics)", () => {
  it("ticket_mrr / ticket_proj vêm do stream do caderno (revenue / sale_count)", async () => {
    const { result } = renderHook(() => useTVKPIs(getPeriodRange("mes")), { wrapper: createWrapper() });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_sales_metrics", expect.any(Object)));
    await waitFor(() => expect(result.current.ticket_mrr).toBe(10000));
    expect(result.current.ticket_proj).toBe(3000);
  });

  it("conversao = won / (won + lost) do caderno, não do pipe (closerPerf.conversao=999 ignorado)", async () => {
    const { result } = renderHook(() => useTVKPIs(getPeriodRange("mes")), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.conversao).toBe(75));
  });

  it("reunioes vem de meeting_events (useSDRPerformance.comparecidas), não do pipe", async () => {
    const { result } = renderHook(() => useTVKPIs(getPeriodRange("mes")), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.reunioes).toBe(4));
    expect(result.current.noshow).toBe(20);
  });

  it("chama get_sales_metrics com período NOMEADO 'range' + datas (não tz client)", async () => {
    renderHook(() => useTVKPIs(getPeriodRange("mes")), { wrapper: createWrapper() });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const call = rpcMock.mock.calls.find((c) => c[0] === "get_sales_metrics");
    expect(call?.[1]).toMatchObject({ p_org_id: "org-t", p_period: "range" });
    expect(typeof call?.[1].p_start).toBe("string");
    expect(typeof call?.[1].p_end).toBe("string");
  });
});

// Regressão do incidente 2026-07-13: o gate dark-launch U3 (canonical_metrics)
// shipou OFF para 100% das orgs e zerou todo o dinheiro da TV. O gate foi REMOVIDO
// — o caderno canônico é sempre-on. Este bloco trava a ausência do gate: mesmo com
// a flag OFF, a RPC canônica é chamada e o dinheiro NÃO zera.
describe("useTVKPIs — canônico sempre-on (gate U3 removido)", () => {
  afterEach(() => {
    canonicalFlag = { enabled: true, isLoading: false };
  });

  it("flag OFF é ignorada → get_sales_metrics ainda roda, dinheiro NÃO zera", async () => {
    canonicalFlag = { enabled: false, isLoading: false };
    rpcMock.mockClear();
    const { result } = renderHook(() => useTVKPIs(getPeriodRange("mes")), { wrapper: createWrapper() });
    await waitFor(() => expect(rpcMock.mock.calls.some((c) => c[0] === "get_sales_metrics")).toBe(true));
    await waitFor(() => expect(result.current.conversao).toBe(75));
    expect(result.current.ticket_mrr).toBe(10000);
    expect(result.current.ticket_proj).toBe(3000);
    expect(result.current.reunioes).toBe(4);
  });
});
