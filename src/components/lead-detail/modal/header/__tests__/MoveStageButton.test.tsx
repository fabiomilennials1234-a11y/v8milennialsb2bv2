import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MoveStageButton } from "../MoveStageButton";

// ─── Supabase mock with spy on update payload ─────────────────────────

const updateSpy = vi.fn();
let stagesFixture: Array<{ id: string; name: string; position: number; stage_key: string }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      // SELECT stages
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: stagesFixture, error: null }),
          }),
        }),
      }),
      // UPDATE writes
      update: (payload: Record<string, unknown>) => {
        updateSpy(table, payload);
        return {
          eq: () => Promise.resolve({ error: null }),
        };
      },
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("@/components/lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => ({
    canEditField: { allowed: true, isLoading: false },
    canMoveMeeting: { allowed: true, isLoading: false },
    canEditProposal: { allowed: true, isLoading: false },
    canDelete: { allowed: true, isLoading: false },
    canReassign: { allowed: true, isLoading: false },
    canRemoveFromPipe: { allowed: true, isLoading: false },
    canAddToPipe: { allowed: true, isLoading: false },
    canManageTags: { allowed: true, isLoading: false },
    canToggleAi: { allowed: true, isLoading: false },
    canMention: { allowed: true, isLoading: false },
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  updateSpy.mockClear();
  stagesFixture = [
    { id: "uuid-stage-1", name: "Novo Lead",  position: 1, stage_key: "novo_lead" },
    { id: "uuid-stage-2", name: "Abordado",   position: 2, stage_key: "abordado" },
    { id: "uuid-stage-3", name: "Respondeu",  position: 3, stage_key: "respondeu" },
  ];
});

describe("MoveStageButton — system pipe", () => {
  it("writes { status: stage_key } to view (not { stage_id: uuid })", async () => {
    renderWithProviders(
      <MoveStageButton
        leadId="lead-1"
        organizationId="org-1"
        variant="whatsapp"
        pipeData={{ id: "entry-1", status: "novo_lead" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /mover/i }));

    const target = await screen.findByText("Abordado");
    fireEvent.click(target);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        "pipe_whatsapp",
        { status: "abordado" },
      );
    });

    // Bug regression guard: never write stage_id
    const payloads = updateSpy.mock.calls.map((c) => c[1]);
    for (const p of payloads) {
      expect(p).not.toHaveProperty("stage_id");
    }
  });

  it("highlights current stage by matching stage_key against pipeData.status", async () => {
    renderWithProviders(
      <MoveStageButton
        leadId="lead-1"
        organizationId="org-1"
        variant="whatsapp"
        pipeData={{ id: "entry-1", status: "abordado" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /mover/i }));

    // Wait for stages render
    const abordadoRow = await screen.findByText("Abordado");
    const button = abordadoRow.closest("button");
    expect(button).toBeTruthy();
    // Current stage button is the only one rendering the check icon
    expect(button?.querySelector("svg.lucide-check")).toBeTruthy();
  });

  it("disables the trigger when lead has no entry (pipeData null)", () => {
    renderWithProviders(
      <MoveStageButton
        leadId="lead-1"
        organizationId="org-1"
        variant="whatsapp"
        pipeData={null}
      />,
    );
    const btn = screen.getByRole("button", { name: /mover/i });
    expect(btn).toBeDisabled();
  });

  it("disables when variant has no pipe-type mapping (followup)", () => {
    renderWithProviders(
      <MoveStageButton
        leadId="lead-1"
        organizationId="org-1"
        variant="followup"
        pipeData={{ id: "entry-1", status: "x" }}
      />,
    );
    const btn = screen.getByRole("button", { name: /mover/i });
    expect(btn).toBeDisabled();
  });
});

describe("MoveStageButton — custom pipe", () => {
  it("writes { stage_id: <uuid> } to custom_pipe_entries (not status)", async () => {
    // Custom pipes use stage_id uuid on custom_pipe_entries (FK to custom_pipeline_stages.id)
    stagesFixture = [
      { id: "uuid-custom-A", name: "A Fazer",     position: 1, stage_key: "a_fazer" },
      { id: "uuid-custom-B", name: "Em Progresso", position: 2, stage_key: "em_progresso" },
    ];

    renderWithProviders(
      <MoveStageButton
        leadId="lead-1"
        organizationId="org-1"
        variant="custom"
        pipeData={{ id: "custom-entry-1", stage_id: "uuid-custom-A", pipeline_id: "pipeline-X" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /mover/i }));

    const target = await screen.findByText("Em Progresso");
    fireEvent.click(target);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        "custom_pipe_entries",
        { stage_id: "uuid-custom-B" },
      );
    });
  });
});
