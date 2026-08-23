/**
 * Integration tests for #304 — action gates applied across the lead modal
 * surface. Verifies that destrutivos hide / cotidianos disabled+tooltip when
 * useLeadActionGates returns allowed: false.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ResponsibleSlot } from "../header/ResponsibleSlot";
import { QualificationSlot } from "../header/QualificationSlot";
import { StageRail } from "../pipes/StageRail";
import { LeadModalToolbar } from "../LeadModalToolbar";
import { EMAIL_CHANNEL_AVAILABLE } from "@/modules/communication/lib/channel-availability";

// ─── Mocks ──────────────────────────────────────────────────────────

type GateState = { allowed: boolean; isLoading: boolean; reason?: string };

const gatesState = vi.hoisted(() => ({
  current: {
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
  } as Record<string, GateState>,
}));

vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => gatesState.current,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useResponsibleMembers: () => [],
}));

vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/modules/communication/lib/whatsapp", () => ({
  useOpenWhatsAppChat: () => vi.fn(),
  formatPhoneForWhatsApp: (s: string) => s,
}));

// Migração do #1620: o botão de WhatsApp virou <AbrirConversaButton>, que traz
// hooks de query e router. Este teste cobre OUTRAS ações do componente, então o
// botão entra como dublê — o comportamento dele tem teste próprio em
// tests/unit/abrir-conversa-button.test.tsx.
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: ({ children }: { children?: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));

vi.mock("@/modules/engagement/components/followups/ScheduleFollowUpButton", () => ({
  ScheduleFollowUpButton: () => null,
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>,
  );
}

function resetGates() {
  gatesState.current = {
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
  };
}

beforeEach(resetGates);

// ─── ResponsibleSlot — disabled+tooltip when !canReassign ────────────

describe("ResponsibleSlot gate (canReassign)", () => {
  it("disables the slot button when canReassign=false", () => {
    gatesState.current.canReassign = { allowed: false, isLoading: false, reason: "denied" };
    renderWithQuery(
      <ResponsibleSlot
        leadId="lead-1"
        field="pre_sale_responsible_id"
        label="Pré-Venda"
        currentMember={null}
      />,
    );
    const btn = screen.getByRole("button", { name: /pré-venda/i });
    expect(btn).toBeDisabled();
  });

  it("enables the slot button when canReassign=true", () => {
    renderWithQuery(
      <ResponsibleSlot
        leadId="lead-1"
        field="pre_sale_responsible_id"
        label="Pré-Venda"
        currentMember={null}
      />,
    );
    const btn = screen.getByRole("button", { name: /pré-venda/i });
    expect(btn).not.toBeDisabled();
  });
});

// ─── QualificationSlot — disabled+tooltip when !canEditField ─────────

describe("QualificationSlot gate (canEditField)", () => {
  it("disables the slot button when canEditField=false", () => {
    gatesState.current.canEditField = { allowed: false, isLoading: false, reason: "denied" };
    renderWithQuery(
      <QualificationSlot
        leadId="lead-1"
        field="qualification_tier"
        label="Qualificação"
        current={null}
      />,
    );
    const btn = screen.getByRole("button", { name: /qualifica/i });
    expect(btn).toBeDisabled();
  });
});

// ─── StageRail — disabled when !canMoveMeeting ───────────────────────

describe("StageRail gate (canMoveMeeting)", () => {
  it("disables stage segments when canMoveMeeting=false", () => {
    gatesState.current.canMoveMeeting = { allowed: false, isLoading: false, reason: "denied" };
    renderWithQuery(
      <StageRail
        pipe={{
          kind: "system",
          recordId: "entry-1",
          pipeRef: "whatsapp",
          shortLabel: "Qualificação",
          color: "#6366f1",
          stages: [
            { key: "novo_lead", label: "Novo lead" },
            { key: "abordado", label: "Abordado" },
          ],
          currentKey: "novo_lead",
        }}
        pendingStageKey={null}
        recentlyMovedStageKey={null}
        disabled
        disabledReason="denied"
        onMove={vi.fn()}
      />,
    );
    const segs = screen.getAllByRole("tab");
    expect(segs.length).toBe(2);
    for (const s of segs) expect(s).toBeDisabled();
  });
});

// ─── LeadModalToolbar — destructive + comms gates ────────────────────

describe("LeadModalToolbar gates", () => {
  const baseLead = {
    id: "lead-1",
    name: "Lead",
    phone: "+5511999999999",
    email: "lead@test.com",
    responsible_id: null,
  };
  const baseProps = {
    lead: baseLead,
    aiDisabled: false,
    onToggleAI: vi.fn(),
    onOpenCallModal: vi.fn(),
    onOpenEmailComposer: vi.fn(),
    onOpenEmailWriter: vi.fn(),
    onOpenScheduleModal: vi.fn(),
    onOpenSmsDialog: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };

  it("hides Excluir lead option when canDelete=false", async () => {
    gatesState.current.canDelete = { allowed: false, isLoading: false, reason: "denied" };
    const { getByRole, queryByText } = renderWithQuery(<LeadModalToolbar {...baseProps} />);
    // Open the overflow dropdown
    const trigger = getByRole("button", { name: "" }); // MoreVertical icon-only button
    trigger.click();
    expect(queryByText(/excluir lead/i)).not.toBeInTheDocument();
  });

  it("esconde Email e SMS enquanto o canal não estiver disponível", () => {
    // Ancorado NA FLAG, não em `not.toBeInTheDocument()` seco: se um dia o
    // backend de e-mail/SMS existir e a flag virar, este teste continua
    // dizendo a verdade em vez de virar asserção vazia que passa sempre.
    renderWithQuery(<LeadModalToolbar {...baseProps} />);
    expect(Boolean(screen.queryByRole("button", { name: /^email$/i }))).toBe(
      EMAIL_CHANNEL_AVAILABLE,
    );
  });

  it("hides comms buttons (WhatsApp/Ligar) when canSendMessage=false", () => {
    // Add canSendMessage to gates contract via canMention as proxy until granular key lands.
    // For now sendMessage gate maps internally; we exercise the "off" path with all comm-related flags off.
    gatesState.current.canMention = { allowed: false, isLoading: false, reason: "denied" };
    gatesState.current.canEditField = { allowed: false, isLoading: false, reason: "denied" };
    renderWithQuery(<LeadModalToolbar {...baseProps} />);
    // When comms are denied, WhatsApp / Ligar should not render.
    // (Email tem teste próprio acima — está atrás da flag de canal, não do gate.)
    expect(screen.queryByRole("button", { name: /whatsapp/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^ligar$/i })).not.toBeInTheDocument();
  });
});
