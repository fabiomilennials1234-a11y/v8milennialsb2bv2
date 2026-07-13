import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Mocks ----

// Caderno canônico get_sales_metrics (#995): receita líquida de estorno, ticket,
// contagens won/lost, split por stream, por closer. É a fonte de venda da TV (#999).
const SALES_METRICS_JSON = {
  period: { name: "month", start: "2026-07-01T00:00:00Z", end: "2026-08-01T00:00:00Z" },
  pipeline_id: null,
  filter_member_id: null,
  revenue_total: 5000,
  revenue_by_stream: {
    novo_negocio: { revenue: 5000, sale_count: 1 },
    carteira: { revenue: 0, sale_count: 0 },
  },
  won_count: 1,
  lost_count: 1, // 1 won + 1 lost ⇒ conversão canônica = 50%
  ticket_medio: 5000,
  by_closer: [{ member_id: "tm1", revenue: 5000, sale_count: 1 }],
  unattributed: { revenue: 0, sale_count: 0 },
};

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
    rpc: vi.fn().mockImplementation((fn: string) =>
      fn === "get_sales_metrics"
        ? Promise.resolve({ data: SALES_METRICS_JSON, error: null })
        : Promise.resolve({ data: null, error: null })
    ),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

// canonical_metrics dark-launch flag (U3). Default ON so the overlay assertions
// keep exercising the canonical path; the OFF gate test flips it.
let canonicalFlag = { enabled: true, isLoading: false };
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => canonicalFlag,
}));

// Reunião: fonte canônica meeting_events (ADR-0007) via useSDRPerformance — a
// MESMA usada pelo funil e pelo KPI (mata o R6). Mockada para controlar totais.
vi.mock("@/modules/engagement/hooks/useSDRPerformance", () => ({
  useSDRPerformance: () => ({
    totals: { marcadas: 2, comparecidas: 1, noShow: 1, noShowRate: 50 },
    bySDR: [{ id: "tm2", name: "SDR 1", marcadas: 2, comparecidas: 1, noShow: 1 }],
  }),
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));

vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));

vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false, isLoading: false }) }));

vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({
    userId: "u1",
    organizationId: "org-t",
    teamMemberId: "tm1",
    effectiveRole: "admin" as const,
    isMaster: false,
    isAdmin: true,
    features: {} as Record<string, boolean>,
    isLoading: false,
    isReady: true,
  }),
}));

vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useUserRole: () => ({ data: { role: "admin" }, isLoading: false }),
  useIsAdmin: () => ({ isAdmin: true, isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
  useCanManageCopilot: () => ({ canManage: true, canCreate: true, canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
  useCanManageWhatsApp: () => ({ canManage: true, isLoading: false }),
  useJobTitle: () => ({ jobTitle: "", isLoading: false }),
  useMetricType: () => ({ metricType: "sales", isLoading: false }),
  useHasRole: () => ({ hasRole: true, isLoading: false }),
}));

const mockTeamMembers = [
  { id: "tm1", name: "Closer 1", is_active: true, metric_type: "sales", role: "admin", user_id: "u1", organization_id: "org-t" },
  { id: "tm2", name: "SDR 1", is_active: true, metric_type: "meetings", role: "membro", user_id: "u2", organization_id: "org-t" },
];

vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", user_id: "u1", role: "admin" } }),
  useTeamMembers: () => ({ data: mockTeamMembers }),
  isVirtualTeamMember: (id: any) => typeof id === "string" && id.startsWith("_virtual_"),
  getSelectedOrgId: () => "org-t",
  setSelectedOrgId: vi.fn(),
  useResponsibleMembers: () => ({ data: [] }),
}));

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear = now.getFullYear();

const mockPropostas = [
  {
    id: "p1",
    status: "vendido",
    sale_value: 5000,
    product_type: "mrr",
    closed_at: now.toISOString(),
    created_at: now.toISOString(),
    closer_id: "tm1",
    responsible_id: "tm1",
    calor: 5,
    lead: { name: "Lead 1", company: "Co 1" },
    closer: { name: "Closer 1" },
    contract_duration: 12,
    items: null,
  },
  {
    id: "p2",
    status: "proposta_enviada",
    sale_value: 3000,
    product_type: "projeto",
    closed_at: null,
    created_at: now.toISOString(),
    closer_id: "tm1",
    responsible_id: "tm1",
    calor: 8,
    lead: { name: "Lead 2", company: "Co 2" },
    closer: { name: "Closer 1" },
    contract_duration: null,
    items: null,
  },
];

const mockConfirmacoes = [
  {
    id: "c1",
    status: "compareceu",
    meeting_date: now.toISOString(),
    closer_id: "tm1",
    sdr_id: "tm2",
    responsible_id: "tm1",
  },
  {
    id: "c2",
    status: "remarcar",
    meeting_date: new Date(now.getTime() - 86400000).toISOString(), // yesterday
    closer_id: "tm1",
    sdr_id: "tm2",
    responsible_id: "tm1",
  },
];

const mockWhatsapp = [
  { id: "w1", status: "novo", sdr_id: "tm2", responsible_id: "tm2" },
  { id: "w2", status: "abordado", sdr_id: "tm2", responsible_id: "tm2" },
  { id: "w3", status: "respondeu", sdr_id: "tm2", responsible_id: "tm2" },
];

vi.mock("@/modules/pipelines/hooks/legacy/usePipePropostas", () => ({
  usePipePropostas: () => ({ data: mockPropostas }),
  useCreatePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useUpdatePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useDeletePipeProposta: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
}));

vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({
  usePipeConfirmacao: () => ({ data: mockConfirmacoes }),
  useCreatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useUpdatePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useDeletePipeConfirmacao: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
}));

vi.mock("@/modules/pipelines/hooks/legacy/usePipeWhatsapp", () => ({
  usePipeWhatsapp: () => ({ data: mockWhatsapp }),
  useCreatePipeWhatsapp: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
  useUpdatePipeWhatsapp: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() })),
}));

vi.mock("@/modules/engagement/hooks/useGoals", () => ({
  useTeamGoals: () => ({
    data: [{ type: "vendas", target_value: 100000, team_member_id: null, name: "Meta de Vendas" }],
  }),
  useIndividualGoals: () => ({
    data: {
      salesGoals: [{ id: "tm1", name: "Closer 1", goal: 50000 }],
      meetingsGoals: [{ id: "tm2", name: "SDR 1", goal: 20 }],
    },
  }),
}));

vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useUserRole: () => "admin",
  useIsAdmin: () => ({ isAdmin: true, isLoading: false }),
}));

// RPC canônica (ADR 2026-04-24): vendaTotal = Σ sale_value (sem × duration).
// Mock espelha a resposta de get_dashboard_metrics para o fixture acima.
vi.mock("@/modules/analytics/hooks/useDashboardMetrics", () => ({
  useDashboardMetrics: () => ({
    data: {
      totalLeads: 0,
      reunioesMarcadas: 0,
      reunioesComparecidas: 0,
      noShow: 0,
      taxaNoShow: 0,
      vendaTotal: 5000,
      vendaMRR: 5000,
      vendaProjeto: 0,
      ticketMedio: 5000,
      ticketMedioMRR: 5000,
      ticketMedioProjeto: 0,
      novosClientes: 1,
      propostasEnviadas: 1,
      tempoMedioResposta: 0,
      vendaPrimeiroPedido: 5000,
      vendaBaseAtiva: 0,
      taxaConversao: 50,
      dailySales: [],
    },
  }),
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

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---- Import hook ----

import { useTVDashboardData } from "@/modules/analytics/hooks/useTVDashboardData";

// ---- Tests ----

describe("useTVDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canonicalFlag = { enabled: true, isLoading: false };
  });

  it("computes dashboard metrics", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true), { timeout: 5000 });

    if (result.current.isSuccess && result.current.data) {
      const data = result.current.data;

      // Sales goal
      expect(data.metaVendasMes).toBe(100000);

      // Receita do mês = get_sales_metrics.revenue_total (líquido de estorno, #995).
      // NÃO recomputada no cliente. Split por stream: novo_negocio 5000, carteira 0.
      expect(data.vendasRealizadas).toBe(5000);
      expect(data.vendasMRR).toBe(5000);
      expect(data.vendasProjeto).toBe(0);
      // Ticket médio canônico (get_sales_metrics.ticket_medio), não recomputado.
      expect(data.ticketMedio).toBe(5000);

      // quantoFalta
      expect(data.quantoFalta).toBe(100000 - 5000);

      // reunioesComparecidas — fonte meeting_events (useSDRPerformance), não pipe.
      expect(data.reunioesComparecidas).toBe(1);

      // Leads to work
      expect(data.leadsNovo).toBe(1);
      expect(data.leadsAbordado).toBe(1);
      expect(data.leadsRemarcar).toBe(1);
      expect(data.leadsParaTrabalhar).toBe(3);

      // Hot proposals (calor >= 7 and not closed)
      expect(data.propostasQuentes.length).toBe(1);
      expect(data.propostasQuentes[0].id).toBe("p2");

      // Conversão canônica = won / (won + lost) = 1 / (1 + 1) = 50%. Do caderno,
      // não do array truncado.
      expect(data.taxaConversaoGeral).toBe(50);

      // Individual goals
      expect(data.individualGoals.closers.length).toBe(1);
      expect(data.individualGoals.sdrs.length).toBe(1);

      // Funil canônico: vendido = won_count, valor = revenue_total (#995);
      // comparecidas/marcadas = meeting_events (useSDRPerformance).
      expect(data.funnel.vendido).toBe(1);
      expect(data.funnel.vendidoValue).toBe(5000);
      expect(data.funnel.comparecidas).toBe(1);
      expect(data.funnel.reunioesMarcadas).toBe(2);
    }
  });

  it("returns expected structure", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true), { timeout: 5000 });

    if (result.current.data) {
      const data = result.current.data;
      expect(data).toHaveProperty("metaVendasMes");
      expect(data).toHaveProperty("vendasRealizadas");
      expect(data).toHaveProperty("vendasMRR");
      expect(data).toHaveProperty("vendasProjeto");
      expect(data).toHaveProperty("ondeDeveriamEstar");
      expect(data).toHaveProperty("quantoFalta");
      expect(data).toHaveProperty("reunioesComparecidas");
      expect(data).toHaveProperty("taxaConversaoGeral");
      expect(data).toHaveProperty("conversaoPorCloser");
      expect(data).toHaveProperty("ticketMedioMRR");
      expect(data).toHaveProperty("ticketMedioProjeto");
      expect(data).toHaveProperty("noShowGeral");
      expect(data).toHaveProperty("noShowPorCloser");
      expect(data).toHaveProperty("leadsParaTrabalhar");
      expect(data).toHaveProperty("propostasQuentes");
      expect(data).toHaveProperty("vendasDoMes");
      expect(data).toHaveProperty("individualGoals");
      expect(data).toHaveProperty("funnel");
    }
  });

  // Regressão do incidente 2026-07-13: o gate dark-launch U3 (canonical_metrics)
  // shipou OFF para 100% das orgs e zerou toda a receita da TV. Gate REMOVIDO —
  // o caderno canônico é sempre-on. Trava a ausência do gate: flag OFF é ignorada.
  it("flag OFF é ignorada → lê get_sales_metrics normalmente, receita NÃO zera", async () => {
    canonicalFlag = { enabled: false, isLoading: false };
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true), { timeout: 5000 });

    expect(result.current.isSuccess).toBe(true);
    const data = result.current.data!;
    // Caderno canônico roda independente da flag → receita real do fixture (5000).
    expect(data.vendasRealizadas).toBe(5000);
    expect(data.ticketMedio).toBe(5000);
    expect(data.funnel.vendido).toBe(1);
    expect(data.reunioesComparecidas).toBe(1);
  });
});
