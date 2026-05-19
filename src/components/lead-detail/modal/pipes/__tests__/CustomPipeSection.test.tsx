import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomPipeSection } from "../CustomPipeSection";

// Radix Select uses scrollIntoView on highlight which jsdom doesn't ship.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  Element.prototype.scrollIntoView = function () {};
}
// jsdom also lacks hasPointerCapture / releasePointerCapture used by Radix.
if (typeof Element !== "undefined" && !(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    setPointerCapture: () => {},
  });
}

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

const moveMutate = vi.fn().mockResolvedValue({});
const removeMutate = vi.fn().mockResolvedValue({});
const addMutate = vi.fn().mockResolvedValue({});

vi.mock("@/hooks/useCustomPipelines", () => ({
  useMoveLeadInCustomPipe: () => ({ mutateAsync: moveMutate, isPending: false }),
  useRemoveLeadFromCustomPipe: () => ({ mutateAsync: removeMutate, isPending: false }),
  useAddLeadToCustomPipe: () => ({ mutateAsync: addMutate, isPending: false }),
}));

const logActionMock = vi.fn();
vi.mock("@/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => logActionMock,
}));

const gatesMock = vi.fn();
vi.mock("../../../hooks/useLeadActionGates", () => ({
  useLeadActionGates: (...args: unknown[]) => gatesMock(...args),
}));

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function renderSection(props: Partial<Parameters<typeof CustomPipeSection>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaultPipe = {
    type: "custom" as const,
    pipelineId: "cp-1",
    pipelineName: "Indicação",
    pipelineColor: "#22c55e",
    pipelineIcon: "users",
    entryId: "entry-cp-1",
    currentStageId: "stage-1",
    currentStageName: "Em andamento",
    stages: [
      { id: "stage-1", name: "Indicado", color: "#3b82f6", position: 1 },
      { id: "stage-2", name: "Em andamento", color: "#eab308", position: 2 },
      { id: "stage-3", name: "Concluído", color: "#22c55e", position: 3 },
    ],
  };
  return render(
    <QueryClientProvider client={qc}>
      <CustomPipeSection
        pipe={props.pipe ?? defaultPipe}
        leadId={props.leadId ?? "lead-1"}
        open={props.open ?? true}
        onToggle={props.onToggle ?? vi.fn()}
        onAdded={props.onAdded}
      />
    </QueryClientProvider>,
  );
}

const allowedGate = { allowed: true, reason: "admin", isLoading: false };
const deniedGate = { allowed: false, reason: "no_perm", isLoading: false };

beforeEach(() => {
  moveMutate.mockReset();
  removeMutate.mockReset();
  addMutate.mockReset();
  moveMutate.mockResolvedValue({});
  removeMutate.mockResolvedValue({});
  addMutate.mockResolvedValue({});
  logActionMock.mockReset();
  gatesMock.mockReset();
});

describe("CustomPipeSection", () => {
  it("renders pipe name + current stage in the header", () => {
    gatesMock.mockReturnValue({ canRemoveFromPipe: allowedGate, canMoveMeeting: allowedGate, canAddToPipe: allowedGate });
    renderSection();
    // Header button has aria-expanded — disambiguate from remove button.
    const headerBtn = screen.getAllByRole("button", { name: /indicação/i })
      .find((b) => b.hasAttribute("aria-expanded"));
    expect(headerBtn).toBeDefined();
    expect(screen.getAllByText(/em andamento/i).length).toBeGreaterThan(0);
  });

  it("shows 'Remover de [Pipe]' button only when canRemoveFromPipe is allowed (admin)", () => {
    gatesMock.mockReturnValue({ canRemoveFromPipe: allowedGate, canMoveMeeting: allowedGate, canAddToPipe: allowedGate });
    renderSection();
    expect(
      screen.getByRole("button", { name: /remover de indicação/i }),
    ).toBeInTheDocument();
  });

  it("hides 'Remover' button when canRemoveFromPipe is denied (member)", () => {
    gatesMock.mockReturnValue({ canRemoveFromPipe: deniedGate, canMoveMeeting: allowedGate, canAddToPipe: deniedGate });
    renderSection();
    expect(
      screen.queryByRole("button", { name: /remover de indicação/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/remoção restrita a admins/i)).toBeInTheDocument();
  });

  it("renders 'Não está neste pipe' badge when entryId is null", () => {
    gatesMock.mockReturnValue({ canRemoveFromPipe: allowedGate, canMoveMeeting: allowedGate, canAddToPipe: allowedGate });
    renderSection({
      pipe: {
        type: "custom" as const,
        pipelineId: "cp-1",
        pipelineName: "Indicação",
        pipelineColor: "#22c55e",
        pipelineIcon: "users",
        entryId: null,
        currentStageId: null,
        currentStageName: null,
        stages: [],
      },
    });
    expect(screen.getAllByText(/não está neste pipe/i).length).toBeGreaterThan(0);
    // No stage selector when lead is not in pipe
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  describe("Adicionar a [Pipe] CTA (issue #298)", () => {
    const emptyPipe = {
      type: "custom" as const,
      pipelineId: "cp-1",
      pipelineName: "Indicação",
      pipelineColor: "#22c55e",
      pipelineIcon: "users",
      entryId: null,
      currentStageId: null,
      currentStageName: null,
      stages: [
        { id: "stage-1", name: "Indicado", color: "#3b82f6", position: 1 },
        { id: "stage-2", name: "Em andamento", color: "#eab308", position: 2 },
      ],
    };

    it("renders Adicionar CTA when entry is null and canAddToPipe allowed", () => {
      gatesMock.mockReturnValue({ canRemoveFromPipe: allowedGate, canMoveMeeting: allowedGate, canAddToPipe: allowedGate });
      renderSection({ pipe: emptyPipe });
      const cta = screen.getByTestId("add-to-pipe-cta-cp-1");
      expect(cta).toBeInTheDocument();
      expect(cta).not.toBeDisabled();
    });

    it("disables CTA when canAddToPipe denies", () => {
      gatesMock.mockReturnValue({ canRemoveFromPipe: deniedGate, canMoveMeeting: allowedGate, canAddToPipe: deniedGate });
      renderSection({ pipe: emptyPipe });
      const cta = screen.getByTestId("add-to-pipe-cta-cp-1");
      expect(cta).toBeDisabled();
    });

    it("click CTA calls useAddLeadToCustomPipe + logs pipe_added + invokes onAdded", async () => {
      gatesMock.mockReturnValue({ canRemoveFromPipe: allowedGate, canMoveMeeting: allowedGate, canAddToPipe: allowedGate });
      const onAdded = vi.fn();
      const props: Partial<Parameters<typeof CustomPipeSection>[0]> = { pipe: emptyPipe, onAdded };
      renderSection(props);
      fireEvent.click(screen.getByTestId("add-to-pipe-cta-cp-1"));
      await waitFor(() => {
        expect(addMutate).toHaveBeenCalledWith({
          lead_id: "lead-1",
          pipeline_id: "cp-1",
          stage_id: "stage-1",
        });
        expect(logActionMock).toHaveBeenCalledWith(
          expect.objectContaining({
            leadId: "lead-1",
            action: "pipe_added",
            metadata: expect.objectContaining({ pipe_type: "custom", pipeline_id: "cp-1", stage_id: "stage-1" }),
          }),
        );
        expect(onAdded).toHaveBeenCalled();
      });
    });
  });

  it("calls useMoveLeadInCustomPipe.mutateAsync with the new stage_id on change", async () => {
    gatesMock.mockReturnValue({ canRemoveFromPipe: allowedGate, canMoveMeeting: allowedGate, canAddToPipe: allowedGate });
    renderSection();
    // Open the select trigger
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    // Click another stage option
    const stage3 = await screen.findByRole("option", { name: /concluído/i });
    fireEvent.click(stage3);
    await waitFor(() => {
      expect(moveMutate).toHaveBeenCalledWith({
        entry_id: "entry-cp-1",
        pipeline_id: "cp-1",
        stage_id: "stage-3",
      });
    });
  });
});
