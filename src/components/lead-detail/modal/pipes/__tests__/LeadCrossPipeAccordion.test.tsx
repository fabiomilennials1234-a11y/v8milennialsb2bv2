import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadCrossPipeAccordion } from "../LeadCrossPipeAccordion";

// ─── Mocks ────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
    }),
  },
}));

const allPipelinesMock = vi.fn();
const addStandardMutateAsync = vi.fn().mockResolvedValue({});
vi.mock("@/hooks/useLeadAllPipelines", () => ({
  useLeadAllPipelines: (...args: unknown[]) => allPipelinesMock(...args),
  useAddLeadToStandardPipe: () => ({
    mutateAsync: addStandardMutateAsync,
    isPending: false,
  }),
}));

const logActionMock = vi.fn();
vi.mock("@/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => logActionMock,
}));

const gatesMock = vi.fn(() => ({
  canAddToPipe: { allowed: true, isLoading: false },
  canRemoveFromPipe: { allowed: true, isLoading: false },
  canMoveMeeting: { allowed: true, isLoading: false },
  canEditField: { allowed: true, isLoading: false },
  canMoveProposal: { allowed: true, isLoading: false },
  canEditProposal: { allowed: true, isLoading: false },
  canDelete: { allowed: true, isLoading: false },
  canReassign: { allowed: true, isLoading: false },
  canManageTags: { allowed: true, isLoading: false },
  canToggleAi: { allowed: true, isLoading: false },
  canMention: { allowed: true, isLoading: false },
}));
vi.mock("../../../hooks/useLeadActionGates", () => ({
  useLeadActionGates: (leadId: string) => gatesMock(leadId),
}));

vi.mock("@/hooks/usePipeConfirmacaoByLeadId", () => ({
  usePipeConfirmacaoByLeadId: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/hooks/usePipePropostaByLeadId", () => ({
  usePipePropostaByLeadId: () => ({ data: null, isLoading: false }),
}));

// Stub body blocks to keep tests focused on accordion shell.
vi.mock("../../../cross-pipe/MeetingFieldBlock", () => ({
  MeetingFieldBlock: () => <div data-testid="meeting-block" />,
}));
vi.mock("../../../cross-pipe/BudgetFieldBlock", () => ({
  BudgetFieldBlock: () => <div data-testid="budget-block" />,
}));
vi.mock("../../header/MoveStageButton", () => ({
  MoveStageButton: () => <div data-testid="move-stage-button" />,
}));
vi.mock("../CustomPipeSection", () => ({
  CustomPipeSection: ({ pipe, open, onToggle }: {
    pipe: { pipelineId: string; pipelineName: string };
    open: boolean;
    onToggle: () => void;
  }) => (
    <button
      type="button"
      data-testid={`custom-stub-${pipe.pipelineId}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      {pipe.pipelineName}
    </button>
  ),
}));
vi.mock("../UpsellPipeSection", () => ({
  UpsellPipeSection: ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="upsell-stub"
      aria-expanded={open}
      onClick={onToggle}
    >
      Carteira
    </button>
  ),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseProps = {
  leadId: "lead-1",
  organizationId: "org-1",
  userId: "user-1",
};

const standardPipe = (overrides: Partial<{ pipeType: "qualificacao" | "confirmacao" | "propostas"; label: string; pipeId: string | null; currentStage: string | null }>) => ({
  type: "standard" as const,
  pipeType: overrides.pipeType ?? "qualificacao",
  label: overrides.label ?? "Qualificação",
  color: "#6366f1",
  pipeId: overrides.pipeId ?? "entry-1",
  currentStage: overrides.currentStage ?? "novo_lead",
  currentStageLabel: "Novo lead",
  stages: [],
});

beforeEach(() => {
  localStorage.clear();
  allPipelinesMock.mockReset();
  addStandardMutateAsync.mockReset().mockResolvedValue({});
  logActionMock.mockReset();
  gatesMock.mockReset().mockReturnValue({
    canAddToPipe: { allowed: true, isLoading: false },
    canRemoveFromPipe: { allowed: true, isLoading: false },
    canMoveMeeting: { allowed: true, isLoading: false },
    canEditField: { allowed: true, isLoading: false },
    canMoveProposal: { allowed: true, isLoading: false },
    canEditProposal: { allowed: true, isLoading: false },
    canDelete: { allowed: true, isLoading: false },
    canReassign: { allowed: true, isLoading: false },
    canManageTags: { allowed: true, isLoading: false },
    canToggleAi: { allowed: true, isLoading: false },
    canMention: { allowed: true, isLoading: false },
  });
});

describe("LeadCrossPipeAccordion", () => {
  describe("zero pipes", () => {
    it("renders empty placeholder when hook returns []", () => {
      allPipelinesMock.mockReturnValue({ data: [], isLoading: false });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      expect(screen.getByText(/sem pipes/i)).toBeInTheDocument();
    });
  });

  describe("3 standard pipes", () => {
    it("renders 3 section headers (Qualificação, Confirmação, Propostas)", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          standardPipe({ pipeType: "confirmacao", label: "Confirmação", pipeId: "entry-2" }),
          standardPipe({ pipeType: "propostas", label: "Propostas", pipeId: "entry-3", currentStage: "proposta_enviada" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      expect(screen.getByRole("button", { name: /qualificação/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /confirmação/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /propostas/i })).toBeInTheDocument();
    });

    it("opens first non-terminal pipe by default", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          standardPipe({ pipeType: "confirmacao", label: "Confirmação", pipeId: "entry-2" }),
          standardPipe({ pipeType: "propostas", label: "Propostas", pipeId: "entry-3" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const qualifBtn = screen.getByRole("button", { name: /qualificação/i });
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("terminal pipes collapsed by default", () => {
    it("does not auto-expand vendido propostas section", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "propostas", label: "Propostas", pipeId: "entry-1", currentStage: "vendido" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const btn = screen.getByRole("button", { name: /propostas/i });
      expect(btn.getAttribute("aria-expanded")).toBe("false");
    });

    it("auto-expands first active when later pipe is terminal", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          standardPipe({ pipeType: "propostas", label: "Propostas", pipeId: "entry-3", currentStage: "perdido" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      expect(
        screen.getByRole("button", { name: /qualificação/i }).getAttribute("aria-expanded"),
      ).toBe("true");
      expect(
        screen.getByRole("button", { name: /propostas/i }).getAttribute("aria-expanded"),
      ).toBe("false");
    });
  });

  describe("single-expand toggle", () => {
    it("clicking another header collapses the current one", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          standardPipe({ pipeType: "confirmacao", label: "Confirmação", pipeId: "entry-2" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const qualifBtn = screen.getByRole("button", { name: /qualificação/i });
      const confirmBtn = screen.getByRole("button", { name: /confirmação/i });
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(confirmBtn);
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("false");
      expect(confirmBtn.getAttribute("aria-expanded")).toBe("true");
    });

    it("clicking the expanded header collapses it (no expansion left)", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const btn = screen.getByRole("button", { name: /qualificação/i });
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(btn);
      expect(btn.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("localStorage persistence", () => {
    const STORAGE_KEY = "lead-modal:expanded:user-1:lead-1";

    it("persists expanded section to localStorage on toggle", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          standardPipe({ pipeType: "confirmacao", label: "Confirmação", pipeId: "entry-2" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /confirmação/i }));
      });
      expect(localStorage.getItem(STORAGE_KEY)).toContain("confirmacao");
    });

    it("restores expanded section from localStorage on mount", () => {
      localStorage.setItem(STORAGE_KEY, "confirmacao");
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          standardPipe({ pipeType: "confirmacao", label: "Confirmação", pipeId: "entry-2" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      expect(
        screen.getByRole("button", { name: /confirmação/i }).getAttribute("aria-expanded"),
      ).toBe("true");
      expect(
        screen.getByRole("button", { name: /qualificação/i }).getAttribute("aria-expanded"),
      ).toBe("false");
    });
  });

  describe("custom pipe sections", () => {
    const customPipe = (overrides: Partial<{ pipelineId: string; pipelineName: string; entryId: string | null; currentStageId: string | null }>) => ({
      type: "custom" as const,
      pipelineId: overrides.pipelineId ?? "cp-1",
      pipelineName: overrides.pipelineName ?? "Indicação",
      pipelineColor: "#22c55e",
      pipelineIcon: "users",
      entryId: overrides.entryId ?? "entry-cp-1",
      currentStageId: overrides.currentStageId ?? "stage-1",
      currentStageName: "Em andamento",
      stages: [],
    });

    it("renders custom pipe stubs after system pipes", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          customPipe({ pipelineId: "cp-A", pipelineName: "Indicação" }),
          customPipe({ pipelineId: "cp-B", pipelineName: "Reativação" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      expect(screen.getByTestId("custom-stub-cp-A")).toBeInTheDocument();
      expect(screen.getByTestId("custom-stub-cp-B")).toBeInTheDocument();
    });

    it("clicking a custom pipe header collapses the open system pipe", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          customPipe({ pipelineId: "cp-A", pipelineName: "Indicação" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const qualifBtn = screen.getByRole("button", { name: /qualificação/i });
      const customBtn = screen.getByTestId("custom-stub-cp-A");
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(customBtn);
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("false");
      expect(customBtn.getAttribute("aria-expanded")).toBe("true");
    });

    it("expands the matching custom pipe via defaultExpandedPipeEntryId", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação", pipeId: "entry-A" }),
          customPipe({ pipelineId: "cp-X", pipelineName: "Custom X", entryId: "entry-cp-X" }),
        ],
        isLoading: false,
      });
      renderWithQuery(
        <LeadCrossPipeAccordion {...baseProps} defaultExpandedPipeEntryId="entry-cp-X" />,
      );
      expect(screen.getByTestId("custom-stub-cp-X").getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("upsell carteira section", () => {
    it("renders the Carteira section after all pipes", () => {
      allPipelinesMock.mockReturnValue({
        data: [standardPipe({ pipeType: "qualificacao", label: "Qualificação" })],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      expect(screen.getByTestId("upsell-stub")).toBeInTheDocument();
    });

    it("clicking Carteira collapses the open system pipe (single-expand)", () => {
      allPipelinesMock.mockReturnValue({
        data: [standardPipe({ pipeType: "qualificacao", label: "Qualificação" })],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const qualifBtn = screen.getByRole("button", { name: /qualificação/i });
      const carteiraBtn = screen.getByTestId("upsell-stub");
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(carteiraBtn);
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("false");
      expect(carteiraBtn.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("Adicionar a [Pipe] CTA (issue #298)", () => {
    const emptySystemPipe = (overrides: Partial<{ pipeType: "qualificacao" | "confirmacao" | "propostas"; label: string }>) => ({
      type: "standard" as const,
      pipeType: overrides.pipeType ?? "confirmacao",
      label: overrides.label ?? "Confirmação",
      color: "#22c55e",
      pipeId: null,
      currentStage: null,
      currentStageLabel: null,
      stages: [
        { id: "novo", label: "Novo", color: "#888" },
        { id: "andamento", label: "Andamento", color: "#888" },
      ],
    });

    it("renders 'Não está neste pipe' badge in header when pipe is empty", () => {
      allPipelinesMock.mockReturnValue({
        data: [emptySystemPipe({ pipeType: "confirmacao", label: "Confirmação" })],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const section = screen.getByTestId("pipe-section-confirmacao");
      expect(section.textContent ?? "").toMatch(/não está neste pipe/i);
    });

    it("renders Adicionar CTA in body when pipe is empty and open", () => {
      allPipelinesMock.mockReturnValue({
        data: [emptySystemPipe({ pipeType: "confirmacao", label: "Confirmação" })],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const cta = screen.getByTestId("add-to-pipe-cta-Confirmação");
      expect(cta).toBeInTheDocument();
      expect(cta).not.toBeDisabled();
    });

    it("disables CTA when canAddToPipe gate denies", () => {
      gatesMock.mockReturnValue({
        canAddToPipe: { allowed: false, reason: "denied", isLoading: false },
        canRemoveFromPipe: { allowed: false, isLoading: false },
        canMoveMeeting: { allowed: false, isLoading: false },
        canEditField: { allowed: false, isLoading: false },
        canMoveProposal: { allowed: false, isLoading: false },
        canEditProposal: { allowed: false, isLoading: false },
        canDelete: { allowed: false, isLoading: false },
        canReassign: { allowed: false, isLoading: false },
        canManageTags: { allowed: false, isLoading: false },
        canToggleAi: { allowed: false, isLoading: false },
        canMention: { allowed: false, isLoading: false },
      });
      allPipelinesMock.mockReturnValue({
        data: [emptySystemPipe({ pipeType: "confirmacao", label: "Confirmação" })],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const cta = screen.getByTestId("add-to-pipe-cta-Confirmação");
      expect(cta).toBeDisabled();
    });

    it("click CTA calls useAddLeadToStandardPipe with first stage + logs pipe_added", async () => {
      allPipelinesMock.mockReturnValue({
        data: [emptySystemPipe({ pipeType: "confirmacao", label: "Confirmação" })],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      const cta = screen.getByTestId("add-to-pipe-cta-Confirmação");
      await act(async () => {
        fireEvent.click(cta);
      });
      expect(addStandardMutateAsync).toHaveBeenCalledWith({
        leadId: "lead-1",
        pipeType: "confirmacao",
        stageId: "novo",
      });
      expect(logActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          leadId: "lead-1",
          action: "pipe_added",
          metadata: expect.objectContaining({ pipe_type: "confirmacao", stage_key: "novo" }),
        }),
      );
    });

    it("after successful add, section becomes expanded (forceExpand)", async () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação" }),
          emptySystemPipe({ pipeType: "confirmacao", label: "Confirmação" }),
        ],
        isLoading: false,
      });
      renderWithQuery(<LeadCrossPipeAccordion {...baseProps} />);
      // initially qualificacao is expanded (first active)
      const qualifBtn = screen.getByRole("button", { name: /qualificação/i });
      expect(qualifBtn.getAttribute("aria-expanded")).toBe("true");
      // expand confirmacao to surface the CTA
      const confirmBtn = screen.getByRole("button", { name: /confirmação/i });
      fireEvent.click(confirmBtn);
      const cta = screen.getByTestId("add-to-pipe-cta-Confirmação");
      await act(async () => {
        fireEvent.click(cta);
      });
      // localStorage persists confirmacao as expanded section
      expect(localStorage.getItem("lead-modal:expanded:user-1:lead-1")).toBe("confirmacao");
    });
  });

  describe("defaultExpandedPipeEntryId hint", () => {
    it("expands the pipe matching the given entry id when no localStorage value exists", () => {
      allPipelinesMock.mockReturnValue({
        data: [
          standardPipe({ pipeType: "qualificacao", label: "Qualificação", pipeId: "entry-A" }),
          standardPipe({ pipeType: "propostas", label: "Propostas", pipeId: "entry-B", currentStage: "proposta_enviada" }),
        ],
        isLoading: false,
      });
      renderWithQuery(
        <LeadCrossPipeAccordion {...baseProps} defaultExpandedPipeEntryId="entry-B" />,
      );
      expect(
        screen.getByRole("button", { name: /propostas/i }).getAttribute("aria-expanded"),
      ).toBe("true");
    });
  });
});
