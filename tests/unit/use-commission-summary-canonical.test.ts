/**
 * FIX-D (code review) · #1000 · ADR-0017 §6 — the commission-ledger overlay is the
 * highest-risk money mapping and shipped effectively untested. Mirrors the #998
 * useDashboardMetrics.test.ts style: a realistic get_commission_ledger jsonb mock,
 * asserting the deeply-nested adapter (m.by_type.mrr.base_revenue → totalMRR, etc.)
 * and fail-closed behavior when the ledger/coverage contract is unavailable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
}));

// canonical_metrics dark-launch flag (U3). Default ON so the overlay assertions
// keep exercising the canonical path; the OFF gate test flips it.
let canonicalFlag = { enabled: true, isLoading: false };
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => canonicalFlag,
}));

import { useCommissionSummary } from "@/modules/engagement/hooks/useCommissions";

// ── Self-referential chain factory (single / maybeSingle / thenable) ───────────
const CHAIN_METHODS = ["select", "eq", "is", "not", "gte", "lte", "lt", "order", "limit"];
function chain(payload: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  CHAIN_METHODS.forEach((m) => (c[m] = vi.fn(() => c)));
  c.single = vi.fn().mockResolvedValue(payload);
  c.maybeSingle = vi.fn().mockResolvedValue(payload);
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(payload).then(res, rej);
  return c;
}

const MEMBER = {
  id: "tm1",
  name: "Ana",
  organization_id: "org-t",
  metric_type: "sales",
  commission_mrr_percent: 1,
  commission_projeto_percent: 0.5,
  ote_base: 3000,
  ote_bonus: 1000,
};

// Legacy fallback source (product_type based). Note: the hook fires two parallel
// negocio_projetado queries (metrics_period_at not-null / null) that share this mock,
// so the legacy array is counted twice — accounted for deterministically below.
const LEGACY_SALES = [{ sale_value: 1000, product_type: "mrr" }];

// Realistic canonical ledger for tm1: base_revenue == podium revenue (#997 invariant).
const LEDGER = {
  projection_status: "ready",
  period: { name: "month", start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" },
  filter_member_id: "tm1",
  commission_total: 400,
  base_revenue_total: 50000,
  sale_count_total: 6,
  by_member: [
    {
      member_id: "tm1",
      commission: 400,
      base_revenue: 50000,
      sale_count: 6,
      by_type: {
        mrr: { commission: 300, base_revenue: 30000, sale_count: 4, rate_percent: 1 },
        projeto: { commission: 100, base_revenue: 20000, sale_count: 2, rate_percent: 0.5 },
      },
    },
  ],
};

function routeFrom() {
  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "team_members":
        return chain({ data: MEMBER, error: null });
      case "negocio_projetado":
        return chain({ data: LEGACY_SALES, error: null });
      case "goals":
        // Individual "vendas" goal in R$ (>=500 → treated as revenue target).
        return chain({ data: { target_value: 10000, created_at: "2026-06-01" }, error: null });
      case "campanha_members":
        return chain({ data: [], error: null });
      default:
        return chain({ data: [], error: null });
    }
  });
}

describe("useCommissionSummary — canonical commission-ledger overlay (#1000)", () => {
  it("distingue vendas sem projeção de comissão apurada", async () => {
    mockRpc.mockResolvedValue({ data: { ...LEDGER, projection_status: "pending", pending_count: 4,
      by_member: [{ ...LEDGER.by_member[0], pending_count: 4, pending_revenue: 14380 }] }, error: null });
    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.commissionStatus).toBe("pending");
    expect(result.current.data!.pendingRevenue).toBe(14380);
    expect(result.current.data!.totalEarnings).toBeNull();
  });

  it("expõe reuniões realizadas e meta ausente sem afirmar desempenho zero", async () => {
    mockRpc.mockResolvedValue({ data: { ...LEDGER, by_member: [] }, error: null });
    mockFrom.mockImplementation((table: string) => chain({ data:
      table === "team_members" ? { ...MEMBER, metric_type: "meetings" } :
      table === "goals" ? null : table === "meeting_events" ? [{ id: "held", meeting_date: "2026-06-10", occurred_at: "2026-06-10" }] : [], error: null }));
    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.goalConfigured).toBe(false);
    expect(result.current.data!.goalCurrent).toBe(1);
    expect(result.current.data!.totalEarnings).toBeNull();
  });

  it("propaga erro de metas em vez de transformar falha em bônus zero", async () => {
    mockRpc.mockResolvedValue({ data: LEDGER, error: null });
    const base = mockFrom.getMockImplementation()!;
    mockFrom.mockImplementation((table: string) => table === "goals" ? chain({ data: null, error: new Error("goals unavailable") }) : base(table));
    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    routeFrom();
    canonicalFlag = { enabled: true, isLoading: false };
  });

  it("maps the nested ledger (by_type.*.base_revenue/commission) onto the summary", async () => {
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(name === "get_commission_ledger" ? { data: LEDGER, error: null } : { data: null, error: null }),
    );

    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const s = result.current.data!;
    // by_type.mrr.base_revenue → totalMRR ; by_type.projeto.base_revenue → totalProjeto
    expect(s.totalMRR).toBe(30000);
    expect(s.totalProjeto).toBe(20000);
    // by_type.*.commission map through
    expect(s.commissionMRR).toBe(300);
    expect(s.commissionProjeto).toBe(100);
    expect(s.totalCommission).toBe(400);
    // Podium invariant (#997): member base_revenue == totalMRR + totalProjeto
    expect(s.totalMRR + s.totalProjeto).toBe(LEDGER.by_member[0].base_revenue);
  });

  it("feeds the SALES goal from the canonical revenue (one number: bar == podium)", async () => {
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(name === "get_commission_ledger" ? { data: LEDGER, error: null } : { data: null, error: null }),
    );

    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // goalIsRevenue (vendas 10000 >= 500) → current = canonical 50000 / target 10000 = 500%.
    expect(result.current.data!.goalProgress).toBe(500);
  });

  it("calls get_commission_ledger with a NAMED period (month + p_ref) for the member", async () => {
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(name === "get_commission_ledger" ? { data: LEDGER, error: null } : { data: null, error: null }),
    );

    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = mockRpc.mock.calls.find((c) => c[0] === "get_commission_ledger");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({
      p_org_id: "org-t",
      p_period: "month",
      p_ref: "2026-06-01",
      p_filter_member_id: "tm1",
    });
  });

  it("não estima comissão quando a RPC canônica está ausente", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find function" } });
    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("recusa leitor antigo que omite a verificação de projeções", async () => {
    mockRpc.mockResolvedValue({ data: { ...LEDGER, projection_status: undefined, by_member: [] }, error: null });
    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("flag OFF → NUNCA chama get_commission_ledger; comissão legada on-the-fly permanece", async () => {
    canonicalFlag = { enabled: false, isLoading: false };
    // Ledger available, but the gate must skip it entirely.
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(name === "get_commission_ledger" ? { data: LEDGER, error: null } : { data: null, error: null }),
    );

    const { result } = renderHook(() => useCommissionSummary("tm1", 6, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc.mock.calls.some((c) => c[0] === "get_commission_ledger")).toBe(false);
    // Legacy computation (product_type), NOT the canonical 30000/20000.
    const s = result.current.data!;
    expect(s.totalMRR).toBe(2000);
    expect(s.totalProjeto).toBe(0);
    expect(s.commissionMRR).toBe(20);
    expect(s.totalCommission).toBe(20);
  });
});
