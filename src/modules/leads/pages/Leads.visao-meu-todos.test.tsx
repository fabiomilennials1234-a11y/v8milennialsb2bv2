/** Ver o describe. Harness: o mesmo de `Leads.busca-debounce.test.tsx`. */
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { m, query, mutation, nada, visao } = vi.hoisted(() => ({
  visao: { disponivel: false, visao: "todos" as "meu" | "todos", setVisao: () => {}, donoForcado: null as string | null },
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
vi.mock("@/modules/platform/hooks/useLeadsLabel", () => ({ useLeadsLabel: () => "Leads" }));
vi.mock("@/modules/platform/hooks/useVisaoMeuTodos", () => ({
  useVisaoMeuTodos: () => visao,
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
  useSaldos: () => ({ data: undefined }),
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

// O dono por N donos não é o alvo aqui.
vi.mock("../hooks/useLeadOwners", () => ({ useLeadOwnersEnabled: () => false }));

import Leads from "./Leads";

/**
 * Visão Meus · Todos (flag `visao_meu_todos`, só admin). "Meus" tem que chegar
 * como dono em TODO hook que recorta a lista — lista, contagens das abas e
 * estatísticas — senão a aba diz um número e a lista mostra outro.
 */
const renderLeads = () =>
  render(
    <MemoryRouter initialEntries={["/leads"]}>
      <Routes>
        <Route path="/leads" element={<Leads />} />
      </Routes>
    </MemoryRouter>,
  );

type ComDono = { filterResponsible?: string };
const donos = (fn: { mock: { calls: unknown[][] } }) => [
  ...new Set(fn.mock.calls.map(([p]) => (p as ComDono).filterResponsible ?? "all")),
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(visao, { disponivel: false, visao: "todos", donoForcado: null });
});

describe("Leads.tsx — visão Meus · Todos", () => {
  it("sem a visão (membro, ou org sem flag): sem controle e sem dono forçado", () => {
    renderLeads();
    act(() => {});
    expect(screen.queryByRole("radiogroup", { name: "Visão dos leads" })).toBeNull();
    for (const fn of [m.useLeads, m.useLeadsCount]) expect(donos(fn)).toEqual(["all"]);
  });

  it("admin em 'Todos': controle aparece e a lista segue o filtro da tela", () => {
    Object.assign(visao, { disponivel: true, visao: "todos", donoForcado: null });
    renderLeads();
    expect(screen.getByRole("radiogroup", { name: "Visão dos leads" })).toBeTruthy();
    for (const fn of [m.useLeads, m.useLeadsCount]) expect(donos(fn)).toEqual(["all"]);
  });

  it("admin em 'Meus': lista e TODAS as contagens recortam pelo próprio membro; o chip de dono sai", () => {
    Object.assign(visao, { disponivel: true, visao: "meu", donoForcado: "tm-1" });
    renderLeads();
    for (const fn of [m.useLeads, m.useLeadsCount, m.useLeadsStats]) expect(donos(fn)).toEqual(["tm-1"]);
    expect(screen.queryByText("Dono da conta")).toBeNull();
  });
});
