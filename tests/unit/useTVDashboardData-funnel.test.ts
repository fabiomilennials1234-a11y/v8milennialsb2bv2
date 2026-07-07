/**
 * Issue #999 (SP-3): a TV lê o caderno canônico. O funil de reunião
 * (reunioesMarcadas / comparecidas) vem de meeting_events (ADR-0007) via
 * useSDRPerformance — a MESMA fonte do KPI "Reuniões" do useTVKPIs. Isso mata o
 * R6 da auditoria: KPI "Reuniões" e funil "Comparecidas" na mesma tela
 * reconciliam por construção (uma fonte só). A semântica de marcadas por
 * occurred_at (reunião com meeting_date futuro NÃO some) é garantida e testada
 * em useSDRPerformance.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Fonte de reunião ÚNICA (meeting_events via useSDRPerformance), compartilhada
// pelos dois hooks — o pivô do R6 kill.
const SDR_TOTALS = { marcadas: 3, comparecidas: 2, noShow: 1, noShowRate: 33.3 };
vi.mock("@/modules/engagement/hooks/useSDRPerformance", () => ({
  useSDRPerformance: () => ({
    totals: SDR_TOTALS,
    bySDR: [{ id: "tm2", name: "SDR 1", ...SDR_TOTALS }],
  }),
}));

// useTVKPIs deps (para o teste de reconciliação R6).
vi.mock("@/modules/engagement/hooks/useCloserPerformance", () => ({
  useCloserPerformance: () => ({
    totals: { reunioesRealizadas: 0, propostas: 4, vendas: 1, vendasValor: 5000, ticketMedio: 5000, conversao: 0 },
    byCloser: [],
    topCloserId: null,
  }),
}));
vi.mock("@/modules/leads/hooks/useNewLeads", () => ({ useNewLeads: () => ({ total: 0 }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
    }),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    // get_sales_metrics vazio: este arquivo foca no funil de reunião (R6).
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false, isLoading: false }) }));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", user_id: "u1", role: "admin" } }),
  useTeamMembers: () => ({ data: [
    { id: "tm1", name: "Closer 1", is_active: true, metric_type: "sales", role: "admin", user_id: "u1", organization_id: "org-t" },
    { id: "tm2", name: "SDR 1", is_active: true, metric_type: "meetings", role: "membro", user_id: "u2", organization_id: "org-t" },
  ] }),
  isVirtualTeamMember: (id: any) => typeof id === "string" && id.startsWith("_virtual_"),
  getSelectedOrgId: () => "org-t",
  setSelectedOrgId: vi.fn(),
  useResponsibleMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipePropostas", () => ({ usePipePropostas: () => ({ data: [] }), useCreatePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })), useUpdatePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })), useDeletePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })) }));
vi.mock("@/modules/pipelines/hooks/legacy/usePipeWhatsapp", () => ({ usePipeWhatsapp: () => ({ data: [] }), useCreatePipeWhatsapp: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })), useUpdatePipeWhatsapp: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })) }));
vi.mock("@/modules/engagement/hooks/useGoals", () => ({
  useTeamGoals: () => ({ data: [{ type: "vendas", target_value: 100000, team_member_id: null, name: "Meta" }] }),
  useIndividualGoals: () => ({ data: { salesGoals: [], meetingsGoals: [] } }),
}));
vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useUserRole: () => "admin",
  useIsAdmin: () => ({ isAdmin: true, isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
}));
vi.mock("@/modules/analytics/hooks/useDashboardMetrics", () => ({
  useDashboardMetrics: () => ({ data: { vendaTotal: 0, vendaMRR: 0, vendaProjeto: 0 } }),
  useConversionRates: () => ({ data: { meetingsRates: [], salesRates: [] } }),
  useFunnelData: () => ({ data: [] }),
  useRankingData: () => ({ data: { salesRanking: [], meetingsRanking: [] } }),
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({ usePipeConfirmacao: () => ({ data: [] }), useCreatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })), useUpdatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })), useDeletePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })) }));
vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({
  usePipelineStages: () => ({ data: [] }),
  DEFAULT_STAGES: {},
  getPipelineTypeName: (t: string) => t,
  stagesToColumns: (s: any[]) => s.map((x: any) => ({ id: x.id, title: x.name })),
  stagesToSelectOptions: () => [],
  getSuccessStageTransition: () => null,
  useAllPipelineStages: () => ({ data: [] }),
  useAllPipelineStageOptions: vi.fn(() => ({ data: [] })),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

import { useTVDashboardData } from "@/modules/analytics/hooks/useTVDashboardData";
import { useTVKPIs } from "@/modules/analytics/hooks/useTVKPIs";
import { getPeriodRange } from "@/lib/tv-periods";

describe("useTVDashboardData — funil de reunião canônico (meeting_events)", () => {
  it("reunioesMarcadas vem de meeting_events (useSDRPerformance.totals.marcadas)", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5000 });
    expect(result.current.data!.funnel.reunioesMarcadas).toBe(SDR_TOTALS.marcadas);
  });

  it("comparecidas vem de meeting_events (useSDRPerformance.totals.comparecidas)", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5000 });
    expect(result.current.data!.funnel.comparecidas).toBe(SDR_TOTALS.comparecidas);
  });
});

describe("R6 kill — KPI Reuniões e funil Comparecidas compartilham a fonte", () => {
  it("useTVKPIs.reunioes === useTVDashboardData.funnel.comparecidas (mesma fonte meeting_events)", async () => {
    const wrapper = createWrapper();
    const dash = renderHook(() => useTVDashboardData(), { wrapper });
    const kpis = renderHook(() => useTVKPIs(getPeriodRange("mes")), { wrapper });

    await waitFor(() => expect(dash.result.current.isSuccess).toBe(true), { timeout: 5000 });

    const funnelComparecidas = dash.result.current.data!.funnel.comparecidas;
    const kpiReunioes = kpis.result.current.reunioes;

    // Ambos derivam de useSDRPerformance.totals.comparecidas → iguais por construção.
    expect(kpiReunioes).toBe(SDR_TOTALS.comparecidas);
    expect(funnelComparecidas).toBe(kpiReunioes);
  });
});
