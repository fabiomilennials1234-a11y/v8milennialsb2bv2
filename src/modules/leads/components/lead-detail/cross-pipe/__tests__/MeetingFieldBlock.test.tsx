import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MeetingFieldBlock } from "../MeetingFieldBlock";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "test@test.com" },
    loading: false,
  }),
}));

vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "admin", isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false }),
}));

vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({ isMaster: false }),
}));

vi.mock("@/modules/identity/permissions/hooks/useCanDo", () => ({
  useCanDo: () => ({ allowed: true, reason: "admin", isLoading: false }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelineEntries", () => ({
  usePipelineEntries: () => ({ data: [], isLoading: false }),
  usePipelineId: () => ({ data: "pipeline-confirmacao-id" }),
  findOrCreatePipelineEntry: vi.fn().mockResolvedValue({ id: "entry-new" }),
}));

vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: vi.fn(),
}));

// CompareceuModal foi movido para leads (inversão F7) — stub local.
vi.mock("../../../leads/funnel-contexts/modals/CompareceuModal", () => ({
  CompareceuModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="compareceu-modal-stub" /> : null,
}));

// Pós-inversão F7: useCreatePipeConfirmacao/useUpdatePipeConfirmacao/
// useCreatePipeProposta + RescheduleModal vêm do PipeOpsPort (context).
// RescheduleModal arrasta hooks de GoogleCalendar — stub via slot do port.
const pipeOpsPort = {
  useCreatePipeConfirmacao: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }) as never,
  useUpdatePipeConfirmacao: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }) as never,
  useCreatePipeProposta: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }) as never,
  RescheduleModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="reschedule-modal-stub" /> : null,
};

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MockPipeOpsProvider port={pipeOpsPort}>{ui}</MockPipeOpsProvider>
    </QueryClientProvider>,
  );
}

const baseProps = {
  leadId: "lead-1",
  organizationId: "org-1",
};

describe("MeetingFieldBlock", () => {
  describe("state: empty (lead has no pipe_confirmacao entry)", () => {
    it("renders 'Sem reunião marcada' message and Adicionar CTA", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={null} locked={false} />,
      );
      expect(screen.getByText(/sem reunião marcada/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /adicionar à confirmação/i }),
      ).toBeInTheDocument();
    });
  });

  describe("state: editable (lead in pipe_confirmacao + permission ok)", () => {
    const meetingRow = {
      id: "conf-1",
      lead_id: "lead-1",
      status: "reuniao_marcada",
      meeting_date: "2026-05-25T14:00:00.000Z",
      notes: null,
      responsible_id: null,
      organization_id: "org-1",
      updated_at: "2026-05-19T10:00:00.000Z",
    };

    it("renders datetime input + status select + Salvar button when not locked", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={false} />,
      );
      // Save button visible
      expect(screen.getByRole("button", { name: /salvar reunião/i })).toBeInTheDocument();
      // Datetime input present (type=datetime-local)
      const inputs = screen.getAllByDisplayValue(/2026-05-25/);
      expect(inputs.length).toBeGreaterThan(0);
    });

    it("renders 'Remarcar' button to open RescheduleModal", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={false} />,
      );
      expect(screen.getByRole("button", { name: /remarcar/i })).toBeInTheDocument();
    });

    it("opens CompareceuModal when user changes status to 'compareceu' and clicks Salvar", async () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={false} />,
      );
      // Click Salvar after status switched would normally open modal.
      // We assert by simulating internal trigger: any "compareceu" save path
      // should surface the stubbed modal element. Implementation chooses how;
      // test ensures CompareceuModal is rendered as a child component (controlled).
      // Trigger via a button label "Marcar comparecimento" that the editable
      // state must render for fast access.
      const compareceuBtn = screen.queryByRole("button", { name: /marcar comparecimento/i });
      expect(compareceuBtn).toBeInTheDocument();
      fireEvent.click(compareceuBtn!);
      await waitFor(() => {
        expect(screen.getByTestId("compareceu-modal-stub")).toBeInTheDocument();
      });
    });
  });

  describe("state: locked (lead in pipe_confirmacao + no permission)", () => {
    const meetingRow = {
      id: "conf-1",
      lead_id: "lead-1",
      status: "reuniao_marcada",
      meeting_date: "2026-05-25T14:00:00.000Z",
      notes: null,
      responsible_id: null,
      organization_id: "org-1",
      updated_at: "2026-05-19T10:00:00.000Z",
    };

    it("does not render Salvar button when locked", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={true} />,
      );
      expect(screen.queryByRole("button", { name: /salvar reunião/i })).not.toBeInTheDocument();
    });

    it("shows lock indicator with tooltip text", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={true} />,
      );
      // Lock icon via data-testid or aria-label
      expect(screen.getByLabelText(/somente leitura/i)).toBeInTheDocument();
    });

    it("renders meeting date and status as read-only text", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={true} />,
      );
      // Status label rendered as text (not select)
      expect(screen.getByText(/reunião marcada/i)).toBeInTheDocument();
    });
  });
});
