import { useEffect } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DealDetailDialog } from "../DealDetailDialog";
import { DealPanelProvider } from "../DealPanelProvider";
import { useDealSheet } from "../deal-sheet-context";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";

// ─── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => false }),
}));

vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false }),
}));

const leadDetailMock = vi.fn();
vi.mock("../../lead-detail/hooks/useLeadDetail", () => ({
  useLeadDetail: () => leadDetailMock(),
}));
vi.mock("../../lead-detail/hooks/useLeadDetailRealtime", () => ({
  useLeadDetailRealtime: () => undefined,
}));
vi.mock("../../lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => ({
    canMoveMeeting: { allowed: true, isLoading: false },
    canRemoveFromPipe: { allowed: true, isLoading: false },
    canAddToPipe: { allowed: true, isLoading: false },
  }),
}));

// A coluna de atividade é a do modal do lead — aqui só precisa aparecer.
vi.mock("../../lead-detail/modal/activity/LeadActivityColumn", () => ({
  LeadActivityColumn: () => <div data-testid="activity-column" />,
}));
vi.mock("../../lead-detail/cross-pipe/MeetingFieldBlock", () => ({
  MeetingFieldBlock: () => <div data-testid="meeting-block" />,
}));
vi.mock("../../lead-detail/cross-pipe/BudgetFieldBlock", () => ({
  BudgetFieldBlock: () => <div data-testid="budget-block" />,
}));
vi.mock("../../lead-detail/modal/pipes/useCrossPipeMove", () => ({
  useCrossPipeMove: () => ({
    move: vi.fn(),
    pendingStageKey: null,
    recentlyMovedStageKey: null,
  }),
}));

const allPipelinesMock = vi.fn();
const removeStandardMutate = vi.fn().mockResolvedValue({});
vi.mock("../../../hooks/useLeadAllPipelines", () => ({
  useLeadAllPipelines: () => allPipelinesMock(),
  useRemoveLeadFromStandardPipe: () => ({
    mutateAsync: removeStandardMutate,
    isPending: false,
  }),
}));

const dealsMock = vi.fn();
vi.mock("../../../hooks/useLeadsDeals", () => ({
  useLeadsDeals: () => dealsMock(),
}));

const pipeOpsPort = {
  usePipeConfirmacaoByLeadId: () => ({ data: null, isLoading: false }) as never,
  usePipePropostaByLeadId: () => ({ data: null, isLoading: false }) as never,
};

const PROPOSTAS_PIPE = {
  type: "standard",
  pipeType: "propostas",
  label: "Propostas",
  color: "#f59e0b",
  pipeId: "entry-1",
  currentStage: "enviada",
  currentStageLabel: "Enviada",
  stages: [
    { id: "enviada", label: "Enviada", color: "#fff" },
    { id: "vendido", label: "Vendido", color: "#fff" },
  ],
};

const DEAL = {
  id: "entry-1",
  leadId: "lead-1",
  title: "Propostas",
  funnelName: "Propostas",
  funnelColor: "#f59e0b",
  pipelineId: "pl-1",
  pipelineSlug: "propostas",
  isSystem: true,
  stageKey: "enviada",
  stageName: "Enviada",
  outcome: "open" as const,
  won: false,
  value: 40000,
  meetingDate: null,
  enteredAt: null,
  stageChangedAt: null,
  daysInStage: 3,
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  leadDetailMock.mockReturnValue({
    lead: {
      id: "lead-1",
      name: "Marina",
      company: "Distribuidora Alfa",
      organization_id: "org-1",
    },
    isLoading: false,
    visibility: "exists",
  });
  allPipelinesMock.mockReturnValue({ data: [PROPOSTAS_PIPE], isLoading: false });
  dealsMock.mockReturnValue({ data: { "lead-1": [DEAL] } });
});

/**
 * Abre o modal no negócio pedido assim que monta.
 *
 * Em efeito, não durante o render: `setState` na fase de render torna a ordem de
 * commit indeterminada e fez os testes falharem de forma intermitente.
 */
function OpenOnMount({ entryId, leadId }: { entryId: string; leadId: string }) {
  const { openDeal } = useDealSheet();
  useEffect(() => {
    openDeal(entryId, leadId);
  }, [openDeal, entryId, leadId]);
  return null;
}

function renderDeal(entryId = "entry-1", leadId = "lead-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MockPipeOpsProvider port={pipeOpsPort}>
          <DealPanelProvider>
            <OpenOnMount entryId={entryId} leadId={leadId} />
            <DealDetailDialog />
          </DealPanelProvider>
        </MockPipeOpsProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("DealDetailDialog — o card do funil abre o negócio", () => {
  it("mostra a pessoa como cabeçalho e o negócio como assunto", () => {
    renderDeal();
    expect(screen.getByText("Marina")).toBeInTheDocument();
    expect(screen.getByText("· Distribuidora Alfa")).toBeInTheDocument();
    expect(screen.getByText("Propostas · Enviada")).toBeInTheDocument();
  });

  it("renderiza o trilho de etapas do funil clicado", () => {
    renderDeal();
    expect(screen.getByTestId("deal-stage-rail")).toBeInTheDocument();
    expect(screen.getByTestId("stage-rail-propostas")).toBeInTheDocument();
  });

  it("mantém a atividade — conversa é por pessoa (D5a), não por negócio", () => {
    renderDeal();
    expect(screen.getByTestId("activity-column")).toBeInTheDocument();
  });

  it("leva pra aba Leads, único lugar onde o modal do lead abre", () => {
    renderDeal();
    expect(screen.getByTestId("deal-open-lead")).toHaveAttribute(
      "href",
      "/leads?lead=lead-1",
    );
  });

  it("mostra o tempo na etapa", () => {
    renderDeal();
    expect(screen.getByText("3d")).toBeInTheDocument();
  });

  it("não repete o valor fora da pill — dois números do mesmo dinheiro divergem", () => {
    renderDeal();
    expect(screen.getByTestId("action-pill-budget")).toHaveTextContent(/40/);
    // O bloco solto de "Valor" some quando existe pill de orçamento.
    expect(screen.queryByText("Valor")).not.toBeInTheDocument();
  });
});

describe("DealDetailDialog — action pills por funil", () => {
  it("Propostas expõe orçamento, já aberto, e não reunião", () => {
    renderDeal();
    expect(screen.getByTestId("action-pill-budget")).toBeInTheDocument();
    expect(screen.queryByTestId("action-pill-meeting")).not.toBeInTheDocument();
    expect(screen.getByTestId("budget-block")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-block")).not.toBeInTheDocument();
  });

  it("clicar na pill fecha o painel e clicar de novo reabre", () => {
    renderDeal();
    const pill = screen.getByTestId("action-pill-budget");
    fireEvent.click(pill);
    expect(screen.queryByTestId("budget-block")).not.toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.getByTestId("budget-block")).toBeInTheDocument();
  });

  it("Confirmação expõe reunião", () => {
    allPipelinesMock.mockReturnValue({
      data: [{ ...PROPOSTAS_PIPE, pipeType: "confirmacao", label: "Confirmação" }],
      isLoading: false,
    });
    renderDeal();
    expect(screen.getByTestId("action-pill-meeting")).toBeInTheDocument();
    expect(screen.getByTestId("meeting-block")).toBeInTheDocument();
  });

  it("funil custom não expõe pill — `custom_pipe_entries` não tem metadata", () => {
    allPipelinesMock.mockReturnValue({
      data: [
        {
          type: "custom",
          pipelineId: "pl-c",
          pipelineName: "Reativação",
          pipelineColor: "#8b5cf6",
          entryId: "entry-1",
          currentStageId: "st-1",
          currentStageName: "Primeiro contato",
          stages: [{ id: "st-1", name: "Primeiro contato", color: "#fff", position: 0 }],
        },
      ],
      isLoading: false,
    });
    renderDeal();
    expect(screen.queryByTestId("deal-action-pills")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-block")).not.toBeInTheDocument();
    expect(screen.getByTestId("deal-stage-rail")).toBeInTheDocument();
  });
});

describe("DealDetailDialog — negócio que sumiu", () => {
  it("explica em vez de abrir modal vazio quando a entry não existe mais", () => {
    renderDeal("entry-removida", "lead-1");
    expect(screen.getByText("Este negócio não está mais disponível")).toBeInTheDocument();
    expect(screen.queryByTestId("deal-stage-rail")).not.toBeInTheDocument();
  });
});
