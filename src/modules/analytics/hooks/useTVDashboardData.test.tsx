import { act, cleanup, renderHook } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useTVDashboardData } from "./useTVDashboardData";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  identity: { isReady: true, userId: "user-a", organizationId: "org-a", isAdmin: true },
  member: { id: "member-a", organization_id: "org-a", name: "A", metric_type: "sales" },
  proposals: [] as { status: string; sale_value: number; calor: number; closer_id: string }[],
  confirmations: [] as { status: string; sdr_id: string }[],
  whatsapp: [] as { status: string; sdr_id: string }[],
  teamGoals: [{ type: "vendas", name: "Meta", target_value: 1000, team_member_id: null }],
  individualGoals: { salesGoals: [{ id: "member-a", name: "A", goal: 200 }], meetingsGoals: [{ id: "sdr-a", name: "SDR", goal: 10 }] },
  performance: { totals: { marcadas: 4, comparecidas: 2, noShowRate: 50 }, bySDR: [{ id: "sdr-a", comparecidas: 2 }] },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => state.identity,
  useCurrentTeamMember: () => ({ data: state.member }),
  useTeamMembers: () => ({ data: [state.member] }),
}));
vi.mock("@/modules/pipelines", () => ({
  usePipePropostas: () => ({ data: state.proposals }),
  usePipeConfirmacao: () => ({ data: state.confirmations }),
  usePipeWhatsapp: () => ({ data: state.whatsapp }),
}));
vi.mock("@/modules/engagement/hooks/useGoals", () => ({
  useTeamGoals: () => ({ data: state.teamGoals }),
  useIndividualGoals: () => ({ data: state.individualGoals }),
}));
vi.mock("@/modules/engagement/hooks/useSDRPerformance", () => ({ useSDRPerformance: () => state.performance }));
const sales = { revenue_total: 400, won_count: 2, lost_count: 2, ticket_medio: 200,
  revenue_by_stream: { novo_negocio: { revenue: 300, sale_count: 1 }, carteira: { revenue: 100, sale_count: 1 } },
  by_closer: [{ member_id: "member-a", revenue: 400, sale_count: 2 }] };
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 12));
  state.identity = { isReady: true, userId: "user-a", organizationId: "org-a", isAdmin: true };
  state.member = { id: "member-a", organization_id: "org-a", name: "A", metric_type: "sales" };
  state.proposals = []; state.confirmations = []; state.whatsapp = [];
  state.teamGoals = [{ type: "vendas", name: "Meta", target_value: 1000, team_member_id: null }];
  state.performance = { totals: { marcadas: 4, comparecidas: 2, noShowRate: 50 }, bySDR: [{ id: "sdr-a", comparecidas: 2 }] };
  state.rpc.mockReset().mockResolvedValue({ data: sales, error: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); });

describe("TV financial query budget", () => {
  it("recomposes changed lists, goals and SDR distribution without requerying the ledger", async () => {
    const { result, rerender } = renderHook(useTVDashboardData, { wrapper });
    await settle();
    expect(result.current.data?.vendasRealizadas).toBe(400);
    state.proposals = [{ status: "reativar", sale_value: 90, calor: 9, closer_id: "member-a" }];
    state.whatsapp = [{ status: "novo", sdr_id: "member-a" }];
    state.confirmations = [{ status: "remarcar", sdr_id: "member-a" }];
    state.teamGoals = [{ ...state.teamGoals[0], target_value: 2000 }];
    state.performance = { ...state.performance, bySDR: [{ id: "sdr-a", comparecidas: 1 }] };
    rerender();
    expect(result.current.data?.funnel.marcandoR2Value).toBe(90);
    expect(result.current.data?.metaVendasMes).toBe(2000);
    expect(result.current.data?.leadsParaTrabalhar).toBe(2);
    expect(result.current.data?.individualGoals.sdrs[0].current).toBe(1);
    expect(result.current.data?.vendasRealizadas).toBe(400);
    expect(result.current.data?.ticketMedio).toBe(200);
    expect(result.current.data?.taxaConversaoGeral).toBe(50);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("isolates user, organization, member scope and date; rejects transitional organization mismatch", async () => {
    const { result, rerender } = renderHook(useTVDashboardData, { wrapper });
    await settle();
    expect(state.rpc.mock.calls[0][1].p_filter_member_id).toBeNull();
    state.identity = { ...state.identity, isAdmin: false };
    state.proposals = [{ status: "reativar", sale_value: 100, calor: 9, closer_id: "someone-else" }];
    rerender(); await settle();
    expect(state.rpc.mock.calls[1][1].p_filter_member_id).toBe("member-a");
    expect(result.current.data?.propostasQuentes).toEqual([]);
    expect(result.current.data?.metaVendasMes).toBe(200);
    state.identity = { ...state.identity, userId: "user-b" };
    rerender(); await settle();
    expect(state.rpc).toHaveBeenCalledTimes(3);
    state.identity = { ...state.identity, organizationId: "org-b" };
    rerender(); await settle();
    expect(result.current.data).toBeUndefined();
    await act(async () => { expect((await result.current.refetch()).data).toBeUndefined(); });
    expect(state.rpc).toHaveBeenCalledTimes(3);
    state.member = { ...state.member, id: "member-b", organization_id: "org-b" };
    rerender(); await settle();
    expect(state.rpc.mock.calls[3][1]).toMatchObject({ p_org_id: "org-b", p_filter_member_id: "member-b" });
    vi.setSystemTime(new Date(2026, 9, 1, 0, 1));
    rerender(); await settle();
    expect(state.rpc.mock.calls[4][1]).toMatchObject({ p_period: "month", p_ref: "2026-10-01" });
  });

  it("shares one thirty-second polling cadence across simultaneous and rotating observers", async () => {
    renderHook(useTVDashboardData, { wrapper });
    let rotating = renderHook(useTVDashboardData, { wrapper });
    await settle();
    expect(state.rpc).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
      rotating.unmount();
      rotating = renderHook(useTVDashboardData, { wrapper });
      await settle();
    }
    expect(state.rpc).toHaveBeenCalledTimes(3); // initial, 30s, 60s
  });

  it("pauses background polling while explicit refetch returns composed fresh data", async () => {
    const { result } = renderHook(useTVDashboardData, { wrapper });
    await settle();
    focusManager.setFocused(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    state.rpc.mockResolvedValue({ data: { ...sales, revenue_total: 500 }, error: null });
    await act(async () => {
      const fresh = await result.current.refetch();
      expect(fresh.data?.vendasRealizadas).toBe(500);
    });
    await settle();
    expect(result.current.data?.vendasRealizadas).toBe(500);
    expect(state.rpc).toHaveBeenCalledTimes(2);
    focusManager.setFocused(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(state.rpc).toHaveBeenCalledTimes(3);
  });

  it("propagates runtime failure instead of fabricating zero revenue", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Denied" } });
    const { result } = renderHook(useTVDashboardData, { wrapper });
    await settle();
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toContain("Denied");
    expect(result.current.data).toBeUndefined();
  });

  it("degrades to zero only when the RPC is absent", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Absent" } });
    const { result } = renderHook(useTVDashboardData, { wrapper });
    await settle();
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data?.vendasRealizadas).toBe(0);
    expect(result.current.data?.funnel.comparecidas).toBe(2);
  });

  it("does not request metrics until identity is ready", async () => {
    state.identity.isReady = false;
    const { result } = renderHook(useTVDashboardData, { wrapper });
    await settle();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
