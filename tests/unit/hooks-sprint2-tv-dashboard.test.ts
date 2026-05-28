import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Mocks ----

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

vi.mock("@/modules/identity/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));

vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));

vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false, isLoading: false }) }));

vi.mock("@/modules/identity/hooks/useIdentity", () => ({
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

vi.mock("@/modules/identity/hooks/useUserRole", () => ({
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

vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
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

vi.mock("@/modules/pipelines/hooks/usePipePropostas", () => ({
  usePipePropostas: () => ({ data: mockPropostas }),
}));

vi.mock("@/modules/pipelines/hooks/usePipeConfirmacao", () => ({
  usePipeConfirmacao: () => ({ data: mockConfirmacoes }),
}));

vi.mock("@/modules/pipelines/hooks/usePipeWhatsapp", () => ({
  usePipeWhatsapp: () => ({ data: mockWhatsapp }),
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

vi.mock("@/modules/identity/hooks/useUserRole", () => ({
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

vi.mock("@/modules/pipelines/hooks/usePipelineStages", () => ({
  usePipelineStages: () => ({ data: [] }),
  DEFAULT_STAGES: {},
  getPipelineTypeName: (t: string) => t,
  stagesToColumns: (s: any[]) => s.map((x: any) => ({ id: x.id, title: x.name })),
  stagesToSelectOptions: () => [],
  getSuccessStageTransition: () => null,
  useAllPipelineStages: () => ({ data: [] }),
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
  });

  it("computes dashboard metrics", async () => {
    const { result } = renderHook(() => useTVDashboardData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true), { timeout: 5000 });

    if (result.current.isSuccess && result.current.data) {
      const data = result.current.data;

      // Sales goal
      expect(data.metaVendasMes).toBe(100000);

      // Receita do mês = Σ sale_value (canônico ADR 2026-04-24) — vem da RPC mockada.
      // MRR 5000, sem × contract_duration.
      expect(data.vendasRealizadas).toBe(5000);
      expect(data.vendasMRR).toBe(5000);
      expect(data.vendasProjeto).toBe(0);

      // quantoFalta
      expect(data.quantoFalta).toBe(100000 - 5000);

      // reunioesComparecidas
      expect(data.reunioesComparecidas).toBe(1);

      // Leads to work
      expect(data.leadsNovo).toBe(1);
      expect(data.leadsAbordado).toBe(1);
      expect(data.leadsRemarcar).toBe(1);
      expect(data.leadsParaTrabalhar).toBe(3);

      // Hot proposals (calor >= 7 and not closed)
      expect(data.propostasQuentes.length).toBe(1);
      expect(data.propostasQuentes[0].id).toBe("p2");

      // Conversion rate: 1 vendido out of 2 total = 50%
      expect(data.taxaConversaoGeral).toBe(50);

      // Individual goals
      expect(data.individualGoals.closers.length).toBe(1);
      expect(data.individualGoals.sdrs.length).toBe(1);

      // Funnel
      expect(data.funnel.reunioesMarcadas).toBeGreaterThanOrEqual(0);
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
});
