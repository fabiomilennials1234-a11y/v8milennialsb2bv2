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
vi.mock("@/hooks/useLeadAllPipelines", () => ({
  useLeadAllPipelines: (...args: unknown[]) => allPipelinesMock(...args),
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
