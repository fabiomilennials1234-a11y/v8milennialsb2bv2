/**
 * Regressão: Reuniões marcadas no funil contam pelo período de marcação
 * (metrics_period_at ?? created_at), NÃO pela data do meeting.
 *
 * Bug pré-fix: reuniões marcadas neste mês com meeting_date em mês futuro
 * sumiam do funil porque o filtro era em meeting_date.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

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
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false, isLoading: false }) }));
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
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
vi.mock("@/modules/identity/hooks/useUserRole", () => ({
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

const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15).toISOString();
const futureMonth = new Date(now.getFullYear(), now.getMonth() + 2, 10).toISOString();
const pastMonth = new Date(now.getFullYear(), now.getMonth() - 2, 10).toISOString();

const mockConfirmacoes = [
  // Marcada este mês, meeting no futuro — DEVE entrar em "Reuniões Marcadas"
  {
    id: "c-future-meeting",
    status: "reuniao_marcada",
    meeting_date: futureMonth,
    created_at: thisMonth,
    metrics_period_at: thisMonth,
    closer_id: "tm1",
    sdr_id: "tm2",
    pre_sale_responsible_id: "tm2",
    sale_responsible_id: "tm1",
  },
  // Marcada em mês passado, meeting este mês compareceu — NÃO entra em marcadas (passou); ENTRA em comparecidas
  {
    id: "c-past-scheduled-attended",
    status: "compareceu",
    meeting_date: thisMonth,
    created_at: pastMonth,
    metrics_period_at: pastMonth,
    closer_id: "tm1",
    sdr_id: "tm2",
    pre_sale_responsible_id: "tm2",
    sale_responsible_id: "tm1",
  },
  // Marcada este mês, meeting este mês compareceu — entra em marcadas E comparecidas
  {
    id: "c-current-attended",
    status: "compareceu",
    meeting_date: thisMonth,
    created_at: thisMonth,
    metrics_period_at: thisMonth,
    closer_id: "tm1",
    sdr_id: "tm2",
    pre_sale_responsible_id: "tm2",
    sale_responsible_id: "tm1",
  },
];

vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({ usePipeConfirmacao: () => ({ data: mockConfirmacoes }), useCreatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })), useUpdatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })), useDeletePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })) }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

import { useTVDashboardData } from "@/modules/analytics/hooks/useTVDashboardData";

describe("useTVDashboardData — funnel regression", () => {
  it("reunioesMarcadas conta por metrics_period_at (não meeting_date)", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5000 });
    const data = result.current.data!;

    // 2 marcadas neste mês (c-future-meeting + c-current-attended).
    // c-past-scheduled-attended foi marcada em mês passado — não conta.
    expect(data.funnel.reunioesMarcadas).toBe(2);
  });

  it("comparecidas conta por meeting_date (evento real)", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5000 });
    const data = result.current.data!;

    // 2 comparecidas com meeting_date neste mês: c-past-scheduled-attended + c-current-attended
    expect(data.funnel.comparecidas).toBe(2);
  });

  it("reuniões marcadas com meeting futuro NÃO somem (bug regression)", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5000 });
    const data = result.current.data!;

    // Garante que c-future-meeting (marcada este mês, meeting em 2 meses) está no contador.
    expect(data.funnel.reunioesMarcadas).toBeGreaterThanOrEqual(1);
  });
});
