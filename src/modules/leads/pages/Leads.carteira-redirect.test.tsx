/**
 * `Leads.tsx` REAL com o `cliente` antigo — o redirect para /carteira visto da
 * página, não só do hook (CTO 2026-10-16).
 *
 * O teste do hook (`useRedirecionaAbaClientes.test.tsx`) usa um dublê da
 * página. Isto monta a página de verdade, com os hooks de dado dublados, para
 * pegar o que só ela decide:
 *  - não pinta NADA enquanto o redirect está pendente (nem o cabeçalho);
 *  - não reabre o `?lead=` no painel de Leads depois que `cliente` chega —
 *    quem abre é a Carteira;
 *  - não busca a lista (`useLeads` sempre desligado) — nem o `all` do reset.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { m, query, mutation, nada } = vi.hoisted(() => ({
  m: { header: vi.fn(), openLead: vi.fn(), useLeads: vi.fn() },
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
  useLeadsCount: () => query({ value: 0, capped: false }),
  useCreateLead: mutation,
  useUpdateLead: mutation,
  useDeleteLead: mutation,
}));
vi.mock("../hooks/useLeadsCarteiraMetrics", () => ({ useLeadsCarteiraMetrics: () => query({}) }));
vi.mock("../hooks/useLeadsSalesMetrics", () => ({ useLeadsSalesMetrics: () => query({}) }));
vi.mock("../hooks/useLeadsDeals", () => ({ useLeadsDeals: () => query({}) }));
vi.mock("../hooks/useLeadsReorderCycle", () => ({ useLeadsReorderCycle: () => query({}) }));
vi.mock("../hooks/useLeadsStats", () => ({ useLeadsStats: () => query(undefined), monthStartInTz: () => new Date(0) }));
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

const LEADS_KEY = "v8:ui:leads:org-1:tm-1";
function seedAba(aba: string) {
  const now = Date.now();
  localStorage.setItem(
    LEADS_KEY,
    JSON.stringify({
      value: { searchQuery: "", filterOrigin: "all", filterQualification: "all", filterResponsible: "all", filterClassificacao: aba },
      savedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }),
  );
}

function CarteiraMarker() {
  return <div>CARTEIRA {useLocation().search}</div>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/leads" element={<Leads />} />
        <Route path="/carteira" element={<CarteiraMarker />} />
      </Routes>
    </MemoryRouter>,
  );

/** Cada `useLeads` que a página pediu LIGADO depois de `cliente` aparecer. */
const ligadosDepoisDoCliente = () => {
  const calls = m.useLeads.mock.calls;
  const primeiro = calls.findIndex(([p]) => (p as { filterClassificacao?: string }).filterClassificacao === "cliente");
  return calls.slice(primeiro).filter(([, o]) => (o as { enabled?: boolean }).enabled !== false);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Leads.tsx com a aba antiga `cliente`", () => {
  it("redireciona sem pintar a página e repassa ?lead= SEM abrir o lead em Leads", async () => {
    seedAba("cliente");
    renderAt("/leads?lead=L1");

    expect(await screen.findByText("CARTEIRA ?lead=L1")).toBeInTheDocument();
    // O primeiro render é o pré-hidratação (estado padrão); depois que `cliente`
    // chega, a página não pinta mais — nem o commit do reset para `all`.
    expect(m.header.mock.calls.length).toBeLessThanOrEqual(1);
    expect(screen.queryByRole("heading", { name: "Leads" })).toBeNull();
    // Quem abre o `?lead=` é a Carteira. O ÚNICO `openLead` aceito em Leads é o
    // do commit pré-hidratação (`usePersistedState` hidrata em efeito, então o
    // 1º render ainda não sabe que a aba é `cliente`) — depois que `cliente`
    // chega, Leads não reabre.
    expect(m.openLead.mock.calls.filter(([id]) => id === "L1").length).toBeLessThanOrEqual(1);
    expect(ligadosDepoisDoCliente()).toEqual([]);
  });

  it("controle: aba `lead` pinta a lista, busca e abre o ?lead= em Leads", async () => {
    seedAba("lead");
    renderAt("/leads?lead=L1");

    expect(await screen.findByRole("heading", { name: "Leads" })).toBeInTheDocument();
    expect(screen.queryByText(/^CARTEIRA/)).toBeNull();
    expect(m.openLead).toHaveBeenCalledWith("L1");
    expect(m.useLeads).toHaveBeenLastCalledWith(expect.objectContaining({ filterClassificacao: "lead" }), { enabled: true });
  });
});

// The owner feature flag is not the target of page navigation/debounce tests.
vi.mock("../hooks/useLeadOwners", () => ({ useLeadOwnersEnabled: () => false }));
