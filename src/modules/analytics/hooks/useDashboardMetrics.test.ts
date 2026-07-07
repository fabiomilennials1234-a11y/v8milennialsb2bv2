/**
 * #998 · PRD #986 · ADR-0017 — canonical ledger overlay for the COMANDO money hooks.
 *
 * Asserts the adapter maps the canonical jsonb (get_sales_metrics / get_ranking)
 * onto the backward-compatible consumer contract:
 *   · net-of-reversal revenue lands in vendaTotal,
 *   · stream split (novo_negocio | carteira) sums to the total,
 *   · won_count → novosClientes,
 *   · ranking is rebuilt in rank order with canonical money + legacy enrichment,
 *   · meetingsRanking stays legacy (get_ranking is sales-only, #997),
 *   · a missing canonical migration degrades to the legacy values (rollback-safe).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../tests/helpers/hook-test-utils";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: true }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-123", id: "me-1" } }),
}));

vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: () => undefined,
}));

import { useDashboardMetrics, useRankingData } from "./useDashboardMetrics";

const LEGACY_DASHBOARD = {
  totalLeads: 120,
  reunioesMarcadas: 40,
  reunioesComparecidas: 25,
  noShow: 15,
  taxaNoShow: 37.5,
  vendaTotal: 99999, // legacy (mutable-state) — must be overridden by canonical
  vendaMRR: 3000,
  vendaProjeto: 7000,
  ticketMedio: 1234,
  ticketMedioMRR: 500,
  ticketMedioProjeto: 800,
  novosClientes: 3, // legacy — overridden by won_count
  propostasEnviadas: 18,
  tempoMedioResposta: 12,
  vendaPrimeiroPedido: 111, // legacy — overridden by stream split
  vendaBaseAtiva: 222,
  taxaConversao: 20,
  dailySales: [{ day: "2026-06-01", revenue: 100, count: 1 }],
};

const CANONICAL_SALES = {
  period: { name: "month", start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" },
  pipeline_id: null,
  filter_member_id: null,
  revenue_total: 50000,
  revenue_by_stream: {
    novo_negocio: { revenue: 30000, sale_count: 4 },
    carteira: { revenue: 20000, sale_count: 2 },
  },
  won_count: 6,
  lost_count: 2,
  ticket_medio: 8333.33,
  by_closer: [],
  unattributed: { revenue: 5000, sale_count: 1 },
};

/** Routes rpc(name) to the right fixture. */
function routeRpc(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  const table: Record<string, { data: unknown; error: unknown }> = {
    get_dashboard_metrics: { data: LEGACY_DASHBOARD, error: null },
    get_sales_metrics: { data: CANONICAL_SALES, error: null },
    ...overrides,
  };
  rpcMock.mockImplementation((name: string) =>
    Promise.resolve(table[name] ?? { data: null, error: null }),
  );
}

describe("useDashboardMetrics — canonical sales overlay", () => {
  beforeEach(() => rpcMock.mockReset());

  it("overlays net-of-reversal revenue and stream split onto the legacy base", async () => {
    routeRpc();
    const { result } = renderHook(() => useDashboardMetrics(6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const m = result.current.data!;
    // Money → canonical
    expect(m.vendaTotal).toBe(50000);
    expect(m.ticketMedio).toBeCloseTo(8333.33);
    expect(m.novosClientes).toBe(6); // won_count
    expect(m.isCanonicalRevenue).toBe(true);
    // Stream split sums to the total (invariant total = novo + carteira)
    expect(m.vendaPrimeiroPedido).toBe(30000);
    expect(m.vendaBaseAtiva).toBe(20000);
    expect(m.vendaPrimeiroPedido + m.vendaBaseAtiva).toBe(m.vendaTotal);
    expect(m.unattributedRevenue).toBe(5000);
    expect(m.lostCount).toBe(2);
    // Non-money dims stay legacy (no ledger for them in this slice)
    expect(m.totalLeads).toBe(120);
    expect(m.reunioesMarcadas).toBe(40);
    expect(m.propostasEnviadas).toBe(18);
    expect(m.dailySales).toHaveLength(1);
  });

  it("calls get_sales_metrics with a NAMED period (month + p_ref date), never raw timestamptz", async () => {
    routeRpc();
    const { result } = renderHook(() => useDashboardMetrics(6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = rpcMock.mock.calls.find((c) => c[0] === "get_sales_metrics");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({
      p_org_id: "org-123",
      p_period: "month",
      p_ref: "2026-06-01",
      p_start: null,
      p_end: null,
      p_pipeline_id: null,
    });
  });

  it("falls back to legacy revenue when the canonical migration is not applied", async () => {
    routeRpc({
      get_sales_metrics: {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      },
    });
    const { result } = renderHook(() => useDashboardMetrics(6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const m = result.current.data!;
    expect(m.vendaTotal).toBe(99999); // legacy survives
    expect(m.isCanonicalRevenue).toBeUndefined();
  });

  it("SURFACES a real runtime error from the canonical RPC instead of degrading (FIX-A)", async () => {
    // Deployed canonical RPC throws a genuine error whose text contains "does not
    // exist" but whose code is NOT PGRST202/42883. Must throw (isError), NOT hide
    // wrong money behind the legacy revenue.
    routeRpc({
      get_sales_metrics: {
        data: null,
        error: { code: "42703", message: 'column "sold_at" does not exist' },
      },
    });
    const { result } = renderHook(() => useDashboardMetrics(6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // Did NOT silently degrade to legacy money.
    expect(result.current.data).toBeUndefined();
  });
});

const LEGACY_RANKING = {
  salesRanking: [
    { id: "a", name: "Ana", job_title: "Closer", metric_type: "sales", value: 1, conversions: 1, goal: 40000, goalProgress: 1, position: 2, role: "membro" },
    { id: "b", name: "Bruno", job_title: "Closer", metric_type: "sales", value: 1, conversions: 1, goal: 10000, goalProgress: 1, position: 1, role: "membro" },
    { id: "c", name: "Caio (5-key only)", job_title: "SDR", metric_type: "sales", value: 999, conversions: 9, goal: 0, goalProgress: 0, position: 3, role: "membro" },
  ],
  meetingsRanking: [
    { id: "s1", name: "Sara", value: 0, meetings: 12, meetingsBooked: 20, goal: 15, goalProgress: 80, position: 1, role: "membro", metric_type: "meetings", job_title: null },
  ],
};

const CANONICAL_RANKING = {
  period: { name: "month", start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" },
  pipeline_id: null,
  revenue_total: 50000,
  sale_count_total: 6,
  // Ana out-earns Bruno under single-key attribution; Caio has no canonical credit.
  ranking: [
    { member_id: "a", revenue: 30000, sale_count: 4, rank: 1, revenue_share: 60 },
    { member_id: "b", revenue: 20000, sale_count: 2, rank: 2, revenue_share: 40 },
  ],
  unattributed: { revenue: 0, sale_count: 0 },
};

describe("useRankingData — canonical ranking overlay", () => {
  beforeEach(() => rpcMock.mockReset());

  it("rebuilds salesRanking from the canonical leaderboard in rank order with legacy enrichment", async () => {
    rpcMock.mockImplementation((name: string) =>
      Promise.resolve(
        name === "get_ranking_data"
          ? { data: LEGACY_RANKING, error: null }
          : name === "get_ranking"
          ? { data: CANONICAL_RANKING, error: null }
          : { data: null, error: null },
      ),
    );

    const { result } = renderHook(() => useRankingData(6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const sales = result.current.data!.salesRanking;
    // Canonical rank order + canonical money; Caio (no canonical credit) dropped — R5.
    expect(sales.map((s) => s.id)).toEqual(["a", "b"]);
    expect(sales[0]).toMatchObject({ id: "a", position: 1, value: 30000, conversions: 4, name: "Ana" });
    // goalProgress recomputed against canonical value (30000/40000 = 75%)
    expect(sales[0].goalProgress).toBe(75);
    expect(sales[0].revenueShare).toBe(60);
    // meetingsRanking untouched (get_ranking is sales-only, #997)
    expect(result.current.data!.meetingsRanking).toHaveLength(1);
    expect(result.current.data!.meetingsRanking[0].id).toBe("s1");
  });

  it("keeps the legacy podium when the canonical migration is not applied", async () => {
    rpcMock.mockImplementation((name: string) =>
      Promise.resolve(
        name === "get_ranking_data"
          ? { data: LEGACY_RANKING, error: null }
          : { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      ),
    );

    const { result } = renderHook(() => useRankingData(6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.salesRanking.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
