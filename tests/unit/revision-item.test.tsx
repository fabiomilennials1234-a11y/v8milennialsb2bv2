/**
 * RevisionItem — unit tests for the expanded action panel and completion notes.
 * Covers: quick actions visibility, completion with/without notes, reschedule,
 * and scheduled-message branch (no follow-up actions).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/modules/communication/lib/whatsapp", () => ({
  useOpenWhatsAppChat: () => vi.fn(),
  formatPhoneForWhatsApp: (phone?: string) => (phone ? `55${phone}` : null),
}));

// Mock child modals to avoid their deep dependency tree
vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));

vi.mock("@/components/followups/ScheduleFollowUpModal", () => ({
  ScheduleFollowUpModal: () => null,
}));

import { RevisionItem, type RevisionTask } from "@/components/revisao/RevisionItem";

// ── Helpers ──────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const Wrapper = createWrapper();
  return render(ui, { wrapper: Wrapper });
}

// ── Fixtures ─────────────────────────────────────────────

function makeFollowUp(overrides: Partial<RevisionTask> = {}): RevisionTask {
  return {
    id: "fu-1",
    type: "follow-up",
    title: "Ligar para João",
    leadName: "João da Silva",
    leadCompany: "Acme Corp",
    leadPhone: "11999990000",
    leadId: "lead-1",
    scheduledAt: new Date("2026-05-06T14:00:00Z"),
    priority: "normal",
    isCompleted: false,
    assignedTo: "tm-1",
    assignedToName: "Gabriel",
    sourcePipe: "whatsapp",
    sourcePipeId: "pipe-1",
    ...overrides,
  };
}

function makeScheduledMessage(overrides: Partial<RevisionTask> = {}): RevisionTask {
  return {
    id: "sm-1",
    type: "scheduled-message",
    title: "Olá, bom dia!",
    leadName: "Maria Souza",
    leadPhone: "11988880000",
    leadId: "lead-2",
    scheduledAt: new Date("2026-05-06T10:00:00Z"),
    isCompleted: false,
    messageContent: "Olá, bom dia! Gostaria de saber sobre o projeto.",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe("RevisionItem", () => {
  const onComplete = vi.fn();
  const onArchive = vi.fn();
  const onDelete = vi.fn();
  const onReschedule = vi.fn();
  const onOpenLead = vi.fn();
  const onScheduleNew = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it("renders follow-up title and lead name", () => {
    renderWithProviders(
      <RevisionItem task={makeFollowUp()} onComplete={onComplete} />,
    );
    expect(screen.getByText("Ligar para João")).toBeTruthy();
    expect(screen.getByText(/João da Silva/)).toBeTruthy();
  });

  it("renders follow-up badge for follow-up type", () => {
    renderWithProviders(
      <RevisionItem task={makeFollowUp()} onComplete={onComplete} />,
    );
    expect(screen.getByText("Follow-up")).toBeTruthy();
  });

  it("renders message badge for scheduled-message type", () => {
    renderWithProviders(
      <RevisionItem task={makeScheduledMessage()} onComplete={onComplete} />,
    );
    expect(screen.getByText("Mensagem")).toBeTruthy();
  });

  it("shows quick actions when expanded (follow-up)", () => {
    renderWithProviders(
      <RevisionItem
        task={makeFollowUp()}
        onComplete={onComplete}
        onArchive={onArchive}
        onDelete={onDelete}
        onReschedule={onReschedule}
        onOpenLead={onOpenLead}
        onScheduleNew={onScheduleNew}
        canDelete
      />,
    );

    // Click to expand
    fireEvent.click(screen.getByText("Ligar para João"));

    // Quick actions should be visible (WhatsApp appears in both meta info and action button)
    expect(screen.getAllByText("WhatsApp").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Reagendar")).toBeTruthy();
    expect(screen.getByText("Novo FU")).toBeTruthy();
    expect(screen.getByText("Ver Lead")).toBeTruthy();
    expect(screen.getByText("Arquivar")).toBeTruthy();
    expect(screen.getByText("Remover")).toBeTruthy();
  });

  it("shows completion section with notes when expanded (follow-up)", () => {
    renderWithProviders(
      <RevisionItem task={makeFollowUp()} onComplete={onComplete} />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));

    expect(screen.getByPlaceholderText(/Notas de conclusao/)).toBeTruthy();
    expect(screen.getByText("Concluir com nota")).toBeTruthy();
    expect(screen.getByText("Concluir sem nota")).toBeTruthy();
  });

  it("calls onComplete without notes when 'Concluir sem nota' clicked", () => {
    renderWithProviders(
      <RevisionItem task={makeFollowUp()} onComplete={onComplete} />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));
    fireEvent.click(screen.getByText("Concluir sem nota"));

    expect(onComplete).toHaveBeenCalledWith("fu-1");
  });

  it("calls onComplete with notes when 'Concluir com nota' clicked", () => {
    renderWithProviders(
      <RevisionItem task={makeFollowUp()} onComplete={onComplete} />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));

    const textarea = screen.getByPlaceholderText(/Notas de conclusao/);
    fireEvent.change(textarea, { target: { value: "Ligou e agendou reunião" } });
    fireEvent.click(screen.getByText("Concluir com nota"));

    expect(onComplete).toHaveBeenCalledWith("fu-1", "Ligou e agendou reunião");
  });

  it("'Concluir com nota' is disabled when textarea is empty", () => {
    renderWithProviders(
      <RevisionItem task={makeFollowUp()} onComplete={onComplete} />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));

    const btn = screen.getByText("Concluir com nota").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("calls onOpenLead with leadId", () => {
    renderWithProviders(
      <RevisionItem
        task={makeFollowUp()}
        onComplete={onComplete}
        onOpenLead={onOpenLead}
      />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));
    fireEvent.click(screen.getByText("Ver Lead"));

    expect(onOpenLead).toHaveBeenCalledWith("lead-1");
  });

  it("calls onScheduleNew with lead context", () => {
    renderWithProviders(
      <RevisionItem
        task={makeFollowUp()}
        onComplete={onComplete}
        onScheduleNew={onScheduleNew}
      />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));
    fireEvent.click(screen.getByText("Novo FU"));

    expect(onScheduleNew).toHaveBeenCalledWith(
      "lead-1",
      "João da Silva",
      "whatsapp",
      "pipe-1",
      "tm-1",
    );
  });

  it("does NOT show follow-up actions for scheduled-message type", () => {
    renderWithProviders(
      <RevisionItem
        task={makeScheduledMessage()}
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText("Olá, bom dia!"));

    // Should show cancel but NOT follow-up specific actions
    expect(screen.getByText("Cancelar envio")).toBeTruthy();
    expect(screen.queryByText("Reagendar")).toBeNull();
    expect(screen.queryByText("Novo FU")).toBeNull();
    expect(screen.queryByText("Concluir com nota")).toBeNull();
  });

  it("does not expand when task is completed", () => {
    renderWithProviders(
      <RevisionItem
        task={makeFollowUp({ isCompleted: true, completedAt: new Date() })}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));

    // Completion section should NOT appear
    expect(screen.queryByText("Concluir com nota")).toBeNull();
  });

  it("hides WhatsApp action button when lead has no phone", () => {
    renderWithProviders(
      <RevisionItem
        task={makeFollowUp({ leadPhone: undefined })}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByText("Ligar para João"));

    // "WhatsApp" still shows in meta info (source pipe label), but the action button should not be present.
    // The action button uses MessageCircle icon with text "WhatsApp" inside a <button>.
    const allWhatsApp = screen.getAllByText("WhatsApp");
    const whatsAppButtons = allWhatsApp.filter(
      (el) => el.closest("button") !== null,
    );
    expect(whatsAppButtons).toHaveLength(0);
  });
});
