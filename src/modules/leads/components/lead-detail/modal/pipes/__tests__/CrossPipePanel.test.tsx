import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CrossPipePanel } from "../CrossPipePanel";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";

// ─── Mocks ────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Funil mergeado OFF nos testes (comportamento legacy assertado abaixo).
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

const allPipelinesMock = vi.fn();
const addStandardMutate = vi.fn().mockResolvedValue({});
const removeStandardMutate = vi.fn().mockResolvedValue({});
vi.mock("@/modules/leads/hooks/useLeadAllPipelines", () => ({
  useLeadAllPipelines: (...args: unknown[]) => allPipelinesMock(...args),
  useAddLeadToStandardPipe: () => ({ mutateAsync: addStandardMutate, isPending: false }),
  useRemoveLeadFromStandardPipe: () => ({
    mutateAsync: removeStandardMutate,
    isPending: false,
  }),
}));

// Pós-inversão F7: custom-pipe mutations + byLeadId reads vêm do PipeOpsPort.
const pipeOpsPort = {
  useAddLeadToCustomPipe: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }) as never,
  useRemoveLeadFromCustomPipe: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }) as never,
  usePipeConfirmacaoByLeadId: () => ({ data: null, isLoading: false }) as never,
  usePipePropostaByLeadId: () => ({ data: null, isLoading: false }) as never,
};

vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));

// O modal de novo negócio lista os donos possíveis — vem do identity, que exige
// AuthProvider. Aqui só interessa que o modal renderize.
vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [{ id: "tm-1", name: "Ana" }],
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "org-1" } }),
  isVirtualTeamMember: (id: string) => String(id).startsWith("master-virtual-"),
}));

// Metadados de negócio (valor / dias parados / rota do board). Vazio por padrão:
// os testes daqui asseguram o trilho de etapas, não a meta.
const dealsMock = vi.fn(() => ({ data: {} as Record<string, unknown[]> }));
vi.mock("@/modules/leads/hooks/useLeadsDeals", () => ({
  useLeadsDeals: (...args: unknown[]) => dealsMock(...(args as [])),
}));

const gatesMock = vi.fn(() => ({
  canAddToPipe: { allowed: true, isLoading: false },
  canRemoveFromPipe: { allowed: true, isLoading: false },
  canMoveMeeting: { allowed: true, isLoading: false },
  canEditField: { allowed: true, isLoading: false },
  canEditProposal: { allowed: true, isLoading: false },
  canDelete: { allowed: true, isLoading: false },
  canReassign: { allowed: true, isLoading: false },
  canManageTags: { allowed: true, isLoading: false },
  canToggleAi: { allowed: true, isLoading: false },
  canMention: { allowed: true, isLoading: false },
}));
vi.mock("../../../hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => gatesMock(),
}));

vi.mock("../../../cross-pipe/MeetingFieldBlock", () => ({
  MeetingFieldBlock: () => <div data-testid="meeting-block" />,
}));
vi.mock("../../../cross-pipe/BudgetFieldBlock", () => ({
  BudgetFieldBlock: () => <div data-testid="budget-block" />,
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  allPipelinesMock.mockReset();
  addStandardMutate.mockClear();
  removeStandardMutate.mockClear();
});

function renderPanel(extraProps: Partial<React.ComponentProps<typeof CrossPipePanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MockPipeOpsProvider port={pipeOpsPort}>
          <CrossPipePanel
            leadId="lead-1"
            organizationId="org-1"
            userId="user-1"
            {...extraProps}
          />
        </MockPipeOpsProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("CrossPipePanel — empty state", () => {
  it("renders 'Nenhum negócio ainda' when there are 0 active and 0 inactive", () => {
    allPipelinesMock.mockReturnValue({ data: [], isLoading: false });
    renderPanel();
    expect(screen.getByTestId("cross-pipe-panel-empty")).toBeInTheDocument();
    expect(screen.getByText("Nenhum negócio ainda")).toBeInTheDocument();
  });

  it("offers 'Novo negócio' disabled when the lead is in no pipe and none is available", () => {
    allPipelinesMock.mockReturnValue({ data: [], isLoading: false });
    renderPanel();
    expect(screen.getByTestId("new-deal-button")).toBeDisabled();
  });
});

describe("CrossPipePanel — rails", () => {
  it("renders one rail per active pipe", () => {
    allPipelinesMock.mockReturnValue({
      data: [
        {
          type: "standard",
          pipeType: "whatsapp",
          label: "Qualificação",
          color: "#6366f1",
          pipeId: "entry-q",
          currentStage: "novo_lead",
          currentStageLabel: "Novo lead",
          stages: [
            { id: "novo_lead", label: "Novo lead", color: "#fff" },
            { id: "abordado", label: "Abordado", color: "#fff" },
          ],
        },
        {
          type: "standard",
          pipeType: "confirmacao",
          label: "Confirmação",
          color: "#22c55e",
          pipeId: null,
          currentStage: null,
          currentStageLabel: null,
          stages: [{ id: "marcada", label: "Marcada", color: "#fff" }],
        },
        {
          type: "standard",
          pipeType: "propostas",
          label: "Propostas",
          color: "#f59e0b",
          pipeId: null,
          currentStage: null,
          currentStageLabel: null,
          stages: [{ id: "marcar_compromisso", label: "Marcar compromisso", color: "#fff" }],
        },
      ],
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByTestId("stage-rail-whatsapp")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-rail-confirmacao")).not.toBeInTheDocument();

    // Funil em que o lead não está deixou de ser chip no rodapé: agora é opção
    // de "Novo negócio", porque criar negócio virou ação explícita (D1).
    expect(screen.queryByText("Confirmação")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("new-deal-button"));
    expect(screen.getByText("Confirmação")).toBeInTheDocument();
  });
});

describe("CrossPipePanel — terminal proposta rendering", () => {
  it("keeps a propostas pipe with vendido stage as a rail with final stage current", () => {
    allPipelinesMock.mockReturnValue({
      data: [
        {
          type: "standard",
          pipeType: "propostas",
          label: "Propostas",
          color: "#f59e0b",
          pipeId: "entry-p",
          currentStage: "vendido",
          currentStageLabel: "Vendido",
          stages: [
            { id: "marcar_compromisso", label: "Marcar compromisso", color: "#fff" },
            { id: "vendido", label: "Vendido", color: "#fff" },
            { id: "perdido", label: "Perdido", color: "#fff" },
          ],
        },
      ],
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByTestId("stage-rail-propostas")).toBeInTheDocument();
    expect(screen.queryByText(/Encerrado/i)).not.toBeInTheDocument();
    const vendido = screen.getByText("Vendido").closest("button");
    expect(vendido).toHaveAttribute("aria-selected", "true");
  });
});

describe("CrossPipePanel — localStorage migration", () => {
  it("migrates legacy 'confirmacao' key to 'meeting' on first render", () => {
    window.localStorage.setItem("lead-modal:expanded:user-1:lead-1", "confirmacao");
    allPipelinesMock.mockReturnValue({
      data: [
        {
          type: "standard",
          pipeType: "confirmacao",
          label: "Confirmação",
          color: "#22c55e",
          pipeId: "entry-c",
          currentStage: "marcada",
          currentStageLabel: "Marcada",
          stages: [{ id: "marcada", label: "Marcada", color: "#fff" }],
        },
      ],
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByTestId("meeting-block")).toBeInTheDocument();
  });

  it("migrates legacy 'propostas' key to 'budget' on first render", () => {
    window.localStorage.setItem("lead-modal:expanded:user-1:lead-1", "propostas");
    allPipelinesMock.mockReturnValue({
      data: [
        {
          type: "standard",
          pipeType: "propostas",
          label: "Propostas",
          color: "#f59e0b",
          pipeId: "entry-p",
          currentStage: "marcar_compromisso",
          currentStageLabel: "Marcar compromisso",
          stages: [
            { id: "marcar_compromisso", label: "Marcar compromisso", color: "#fff" },
          ],
        },
      ],
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByTestId("budget-block")).toBeInTheDocument();
  });

  it("ignores unknown legacy values", () => {
    window.localStorage.setItem("lead-modal:expanded:user-1:lead-1", "carteira");
    allPipelinesMock.mockReturnValue({
      data: [
        {
          type: "standard",
          pipeType: "confirmacao",
          label: "Confirmação",
          color: "#22c55e",
          pipeId: "entry-c",
          currentStage: "marcada",
          currentStageLabel: "Marcada",
          stages: [{ id: "marcada", label: "Marcada", color: "#fff" }],
        },
      ],
      isLoading: false,
    });
    renderPanel();
    expect(screen.queryByTestId("meeting-block")).not.toBeInTheDocument();
  });
});

describe("CrossPipePanel — collapsible rails", () => {
  const threeActivePipes = [
    {
      type: "standard",
      pipeType: "whatsapp",
      label: "Qualificação",
      color: "#6366f1",
      pipeId: "entry-q",
      currentStage: "abordado",
      currentStageLabel: "Abordado",
      stages: [
        { id: "novo_lead", label: "Novo lead", color: "#fff" },
        { id: "abordado", label: "Abordado", color: "#fff" },
      ],
    },
    {
      type: "standard",
      pipeType: "confirmacao",
      label: "Confirmação",
      color: "#22c55e",
      pipeId: "entry-c",
      currentStage: "marcada",
      currentStageLabel: "Marcada",
      stages: [{ id: "marcada", label: "Marcada", color: "#fff" }],
    },
    {
      type: "standard",
      pipeType: "propostas",
      label: "Propostas",
      color: "#f59e0b",
      pipeId: "entry-p",
      currentStage: "marcar_compromisso",
      currentStageLabel: "Marcar compromisso",
      stages: [
        { id: "marcar_compromisso", label: "Marcar compromisso", color: "#fff" },
        { id: "vendido", label: "Vendido", color: "#fff" },
      ],
    },
  ];

  it("with a single active pipe, renders it expanded and no collapsed chips", () => {
    allPipelinesMock.mockReturnValue({
      data: [threeActivePipes[0]],
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByTestId("stage-rail-whatsapp")).toBeInTheDocument();
    expect(
      screen.queryByTestId("stage-rail-collapsed-whatsapp"),
    ).not.toBeInTheDocument();
  });

  it("with 3 active pipes, expands the most advanced (propostas) and collapses the rest", () => {
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    // propostas wins the heuristic (upsell > propostas > confirmacao > whatsapp)
    expect(screen.getByTestId("stage-rail-propostas")).toBeInTheDocument();
    expect(
      screen.getByTestId("stage-rail-collapsed-whatsapp"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("stage-rail-collapsed-confirmacao"),
    ).toBeInTheDocument();
    // confirmacao current stage shown in its collapsed pill
    expect(
      screen.getByTestId("stage-rail-collapsed-current-confirmacao"),
    ).toHaveTextContent("Marcada");
  });

  it("clicking a collapsed chip expands it and collapses the previous", () => {
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByTestId("stage-rail-propostas")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("stage-rail-collapsed-whatsapp"));
    expect(screen.getByTestId("stage-rail-whatsapp")).toBeInTheDocument();
    expect(
      screen.queryByTestId("stage-rail-propostas"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("stage-rail-collapsed-propostas"),
    ).toBeInTheDocument();
  });

  it("persists the focused rail in localStorage", () => {
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("stage-rail-collapsed-confirmacao"));
    expect(
      window.localStorage.getItem("lead-modal:pipe-focus:user-1:lead-1"),
    ).toBe("system:entry-c");
  });

  it("restores the focused rail from localStorage", () => {
    window.localStorage.setItem(
      "lead-modal:pipe-focus:user-1:lead-1",
      "system:entry-q",
    );
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    // qualificacao expanded despite propostas being more advanced
    expect(screen.getByTestId("stage-rail-whatsapp")).toBeInTheDocument();
    expect(
      screen.getByTestId("stage-rail-collapsed-propostas"),
    ).toBeInTheDocument();
  });

  it("falls back to the heuristic when stored focus points to a removed pipe", () => {
    window.localStorage.setItem(
      "lead-modal:pipe-focus:user-1:lead-1",
      "system:entry-removed",
    );
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    // Heuristic: propostas wins
    expect(screen.getByTestId("stage-rail-propostas")).toBeInTheDocument();
    expect(
      screen.getByTestId("stage-rail-collapsed-whatsapp"),
    ).toBeInTheDocument();
  });

  it("always keeps exactly one rail expanded when pipes are active", () => {
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    // Click chip -> previous collapses, clicked one expands. No way to toggle
    // the expanded one off (no onExpand wired on the expanded variant).
    fireEvent.click(screen.getByTestId("stage-rail-collapsed-confirmacao"));
    expect(screen.getByTestId("stage-rail-confirmacao")).toBeInTheDocument();
    expect(
      screen.queryByTestId("stage-rail-collapsed-confirmacao"),
    ).not.toBeInTheDocument();
    // 3 rails total: 1 expanded + 2 collapsed
    const expanded = screen
      .getAllByTestId(/^stage-rail-(whatsapp|confirmacao|propostas)$/)
      .filter((el) =>
        el.getAttribute("data-testid")?.match(/^stage-rail-(whatsapp|confirmacao|propostas)$/),
      );
    expect(expanded).toHaveLength(1);
  });

  it("collapsed chips expose aria-expanded=false and role=region wraps the rails", () => {
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    const region = screen.getByRole("region", { name: "Negócios do lead" });
    expect(region).toBeInTheDocument();
    const collapsed = screen.getByTestId("stage-rail-collapsed-whatsapp");
    expect(collapsed).toHaveAttribute("aria-expanded", "false");
  });

  it("collapsed chip is keyboard focusable and Enter expands", () => {
    allPipelinesMock.mockReturnValue({
      data: threeActivePipes,
      isLoading: false,
    });
    renderPanel();
    const chip = screen.getByTestId("stage-rail-collapsed-whatsapp") as HTMLButtonElement;
    act(() => chip.focus());
    expect(document.activeElement).toBe(chip);
    fireEvent.click(chip); // native button: Enter/Space → click
    expect(screen.getByTestId("stage-rail-whatsapp")).toBeInTheDocument();
  });
});

describe("CrossPipePanel — pill toggle", () => {
  it("opens, closes and switches between meeting and budget", () => {
    allPipelinesMock.mockReturnValue({
      data: [
        {
          type: "standard",
          pipeType: "confirmacao",
          label: "Confirmação",
          color: "#22c55e",
          pipeId: "entry-c",
          currentStage: "marcada",
          currentStageLabel: "Marcada",
          stages: [{ id: "marcada", label: "Marcada", color: "#fff" }],
        },
        {
          type: "standard",
          pipeType: "propostas",
          label: "Propostas",
          color: "#f59e0b",
          pipeId: "entry-p",
          currentStage: "marcar_compromisso",
          currentStageLabel: "Marcar compromisso",
          stages: [
            { id: "marcar_compromisso", label: "Marcar compromisso", color: "#fff" },
          ],
        },
      ],
      isLoading: false,
    });
    renderPanel();
    const meetingPill = screen.getByTestId("action-pill-meeting");
    const budgetPill = screen.getByTestId("action-pill-budget");

    fireEvent.click(meetingPill);
    expect(screen.getByTestId("meeting-block")).toBeInTheDocument();

    fireEvent.click(budgetPill);
    expect(screen.queryByTestId("meeting-block")).not.toBeInTheDocument();
    expect(screen.getByTestId("budget-block")).toBeInTheDocument();

    fireEvent.click(budgetPill);
    expect(screen.queryByTestId("budget-block")).not.toBeInTheDocument();
  });
});
