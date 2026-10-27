/**
 * Perf onda 1 (F2) — a busca da tela de Leads responde na hora no input, mas
 * só o termo ASSENTADO (300 ms sem digitar) chega às queries. Antes, cada tecla
 * disparava a lista + contagens + estatísticas, e cada uma a pré-consulta de
 * telefone secundário: 11 dígitos = dezenas de `lead_phones ilike` em prod.
 *
 * Monta a página real com os hooks de dado dublados (mesmo harness de
 * `Leads.carteira-redirect.test.tsx`) e lê os termos que eles receberam.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { m, query, mutation, nada } = vi.hoisted(() => ({
  m: { header: vi.fn(), openLead: vi.fn(), useLeads: vi.fn(), useLeadsCount: vi.fn(), useLeadsStats: vi.fn() },
  query: (data: unknown = undefined) => ({ data, isLoading: false, isFetching: false, isSuccess: true }),
  mutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  nada: () => null,
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1", timezone: "America/Sao_Paulo" }),
  useCanDo: () => ({ allowed: true }),
  useFeaturePermission: () => ({ allowed: true }),
  useCurrentTeamMember: () => ({ data: { id: "tm-1" }, isLoading: false, isFetching: false }),
  useResponsibleMembers: () => [],
}));
vi.mock("@/lib/analytics", () => ({ trackModuleVisit: vi.fn() }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));
vi.mock("@/shared/hooks/use-viewport", () => ({ useViewport: () => ({ isMobile: false }) }));
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: (props: { title: ReactNode }) => {
    m.header(props.title);
    return <h1>{props.title}</h1>;
  },
}));
vi.mock("../hooks/useLeads", () => ({
  LEADS_PAGE_SIZE: 50,
  useLeads: (params: unknown, options: { enabled?: boolean }) => {
    m.useLeads(params, options);
    return query([]);
  },
  useLeadsCount: (params: unknown) => {
    m.useLeadsCount(params);
    return query({ value: 0, capped: false });
  },
  useCreateLead: mutation,
  useUpdateLead: mutation,
  useDeleteLead: mutation,
}));
vi.mock("../hooks/useLeadsCarteiraMetrics", () => ({ useLeadsCarteiraMetrics: () => query({}) }));
vi.mock("../hooks/useLeadsSalesMetrics", () => ({ useLeadsSalesMetrics: () => query({}) }));
vi.mock("../hooks/useLeadsDeals", () => ({ useLeadsDeals: () => query({}) }));
vi.mock("../hooks/useLeadsReorderCycle", () => ({ useLeadsReorderCycle: () => query({}) }));
vi.mock("../hooks/useLeadsStats", () => ({
  useLeadsStats: (params: unknown) => {
    m.useLeadsStats(params);
    return query(undefined);
  },
  monthStartInTz: () => new Date(0),
}));
vi.mock("../hooks/useLeadClassificacao", () => ({ useLeadClassificacao: mutation }));
vi.mock("../hooks/useClassificacaoCafeJurere", () => ({ useClassificacaoCafeJurere: () => false }));
vi.mock("../hooks/useOrgUsaLeiDoErp", () => ({ useOrgUsaLeiDoErp: () => ({ usaLeiDoErp: false }) }));
// Lista fria (ADR-0042): org sem a flag. A aba e o cartão de buscas nem entram na tela.
vi.mock("@/modules/lista-fria", () => ({
  useListaFriaAcesso: () => ({ carregando: false, habilitada: false, podeVer: false, podeEditar: false }),
  useSaldoDeCreditos: () => ({ data: undefined }),
  BuscasCard: () => null,
  NovaBuscaDialog: () => null,
}));
vi.mock("../pipe-ops", () => ({
  usePipeOps: () => ({
    useCustomPipelines: () => query([]),
    useCustomPipelineStages: () => query([]),
    useAddLeadToCustomPipe: mutation,
    useAllPipelineStageOptions: () => ({ stagesByPipe: {} }),
    useCreatePipeWhatsapp: mutation,
    useCreatePipeConfirmacao: mutation,
    useCreatePipeProposta: mutation,
    useSystemPipes: () => query([]),
  }),
}));
vi.mock("../components/lead-detail", () => ({
  LeadPanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLeadSheet: () => ({ openLead: m.openLead }),
}));
vi.mock("../components/deal-detail/DealPanelProvider", () => ({
  DealPanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/platform/components/layout/LeadPanelLayout", () => ({
  LeadPanelLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../components/lead-card/LeadCardPanel", () => ({ LeadCardPanel: nada }));
vi.mock("../components/deal-card/DealCardPanel", () => ({ DealCardPanel: nada }));
vi.mock("../components/leads/LeadListRow", () => ({ LeadListRow: nada, LeadListHeader: nada, LEAD_LIST_MIN_WIDTH: 0 }));
vi.mock("../components/leads/LeadListRowV2", () => ({ LeadListRowV2: nada, LeadListHeaderV2: nada }));
vi.mock("../components/leads/LeadsStatsV2", () => ({ LeadsStatsV2: nada }));
vi.mock("../components/leads/LeadsPageSegments", () => ({ LeadsPageSegments: nada }));
vi.mock("../components/leads/LeadMobileCard", () => ({ LeadMobileCard: nada }));
vi.mock("../components/leads/LeadMobileSortBar", () => ({ LeadMobileSortBar: nada }));
vi.mock("../components/leads/ExportLeadsModal", () => ({ ExportLeadsModal: nada }));
vi.mock("../components/leads/ImportLeadsModal", () => ({ ImportLeadsModal: nada }));
vi.mock("../components/leads/ImportHistoryPanel", () => ({ ImportHistoryPanel: nada }));
vi.mock("@/modules/leads/components/bulk-actions/BulkActionBar", () => ({ BulkActionBar: nada }));
vi.mock("@/modules/platform/components/saved-views/SavedViewsDropdown", () => ({ SavedViewsDropdown: nada }));

import Leads from "./Leads";

const renderLeads = () =>
  render(
    <MemoryRouter initialEntries={["/leads"]}>
      <Routes>
        <Route path="/leads" element={<Leads />} />
      </Routes>
    </MemoryRouter>,
  );

type ComBusca = { searchQuery?: string };
/** Termos distintos que cada hook de dado recebeu, na ordem. */
const termos = (fn: { mock: { calls: unknown[][] } }) => [
  ...new Set(fn.mock.calls.map(([p]) => (p as ComBusca).searchQuery ?? "")),
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Leads.tsx — busca com debounce", () => {
  it("o input acompanha cada tecla; as queries só veem o termo final, 300 ms depois", () => {
    renderLeads();
    act(() => { vi.advanceTimersByTime(0); });
    const input = screen.getByPlaceholderText(/Buscar por nome/);

    const numero = "17981257650";
    for (let i = 1; i <= numero.length; i++) {
      fireEvent.change(input, { target: { value: numero.slice(0, i) } });
      act(() => { vi.advanceTimersByTime(50); });
      expect(input).toHaveValue(numero.slice(0, i));
    }

    // Digitando: nenhum termo parcial chegou a hook de dado.
    for (const fn of [m.useLeads, m.useLeadsCount, m.useLeadsStats]) {
      expect(termos(fn)).toEqual([""]);
    }

    // 50 ms já correram depois da última tecla; faltam 250.
    act(() => { vi.advanceTimersByTime(249); });
    expect(termos(m.useLeads)).toEqual([""]);

    act(() => { vi.advanceTimersByTime(1); });
    for (const fn of [m.useLeads, m.useLeadsCount, m.useLeadsStats]) {
      expect(termos(fn)).toEqual(["", numero]);
    }
  });
});

// The owner feature flag is not the target of page navigation/debounce tests.
vi.mock("../hooks/useLeadOwners", () => ({ useLeadOwnersEnabled: () => false }));
