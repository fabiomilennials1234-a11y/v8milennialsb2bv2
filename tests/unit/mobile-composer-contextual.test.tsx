/**
 * MobileComposerContextual — state machine tests.
 *
 * Cycles:
 *  1. Shows mic button when input empty (IDLE)
 *  2. Shows send button when input has text (TYPING)
 *  3. "+" opens action tray with 4 items (TRAY_OPEN)
 *  4. Tapping "+" again closes tray
 *  5. Send button calls mutation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSendMutateAsync = vi.fn().mockResolvedValue({});
const mockMediaMutateAsync = vi.fn().mockResolvedValue({});

vi.mock("@/hooks/chat/useWhatsAppSend", () => ({
  useSendWhatsAppMessage: () => ({
    mutateAsync: mockSendMutateAsync,
    isPending: false,
  }),
  useSendWhatsAppMedia: () => ({
    mutateAsync: mockMediaMutateAsync,
    isPending: false,
  }),
}));

const mockSetDraft = vi.fn();
let mockDraft = "";

vi.mock("@/hooks/useConversationDraft", () => ({
  useConversationDraft: () => ({
    draft: mockDraft,
    setDraft: (v: string) => {
      mockDraft = v;
      mockSetDraft(v);
    },
  }),
}));

vi.mock("@/hooks/use-keyboard-offset", () => ({
  useKeyboardOffset: () => ({ offset: 0, isKeyboardOpen: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-user-id" } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
  },
}));

vi.mock("@/components/chat/media/AudioRecorder", () => ({
  AudioRecorder: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="audio-recorder">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock("@/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => <div data-testid="schedule-modal" />,
}));

vi.mock("@/lib/audioToMp3", () => ({
  convertAudioBlobToMp3: vi.fn().mockResolvedValue(new Blob()),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Framer motion — simplify for tests
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: Record<string, unknown> & { children: React.ReactNode }) => (
      <div data-testid={props["data-testid"] as string}>{children}</div>
    ),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { MobileComposerContextual } from "@/components/chat/composer/MobileComposerContextual";

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const BASE_PROPS = {
  conversationKey: "inst1:5511999990000",
  phoneNumber: "5511999990000",
  contactName: "João",
  instanceName: "inst1",
  instanceId: "inst-uuid-1",
  canReply: true,
  selectedContact: {
    push_name: "João",
    lead_name: "João da Silva",
    phone_number: "5511999990000",
    lead_id: "lead-1",
  },
};

function renderComposer(overrides?: Partial<typeof BASE_PROPS>) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MobileComposerContextual {...BASE_PROPS} {...overrides} />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MobileComposerContextual", () => {
  beforeEach(() => {
    mockDraft = "";
    mockSendMutateAsync.mockClear();
    mockMediaMutateAsync.mockClear();
    mockSetDraft.mockClear();
  });

  // ─── Cycle 1: IDLE state ───────────────────────────────────
  it("shows mic button when input is empty", () => {
    renderComposer();
    expect(screen.getByLabelText("Gravar audio")).toBeInTheDocument();
    expect(screen.queryByLabelText("Enviar mensagem")).not.toBeInTheDocument();
  });

  // ─── Cycle 2: TYPING state ────────────────────────────────
  it("shows send button when input has text", () => {
    mockDraft = "hello";
    renderComposer();
    expect(screen.getByLabelText("Enviar mensagem")).toBeInTheDocument();
    expect(screen.queryByLabelText("Gravar audio")).not.toBeInTheDocument();
  });

  // ─── Cycle 3: TRAY_OPEN ───────────────────────────────────
  it("opens action tray with 4 items on '+' click", () => {
    renderComposer();

    // Tray not visible initially
    expect(screen.queryByTestId("action-tray")).not.toBeInTheDocument();

    // Click "+"
    fireEvent.click(screen.getByLabelText("Abrir acoes"));

    // Tray visible with 4 actions
    expect(screen.getByTestId("action-tray")).toBeInTheDocument();
    expect(screen.getByLabelText("Camera")).toBeInTheDocument();
    expect(screen.getByLabelText("Arquivo")).toBeInTheDocument();
    expect(screen.getByLabelText("Template")).toBeInTheDocument();
    expect(screen.getByLabelText("Agendar")).toBeInTheDocument();
  });

  // ─── Cycle 4: close tray ──────────────────────────────────
  it("closes tray on second '+' click", () => {
    renderComposer();

    fireEvent.click(screen.getByLabelText("Abrir acoes"));
    expect(screen.getByTestId("action-tray")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Fechar acoes"));
    expect(screen.queryByTestId("action-tray")).not.toBeInTheDocument();
  });

  // ─── Cycle 5: send calls mutation ─────────────────────────
  it("calls sendMessage mutation on send click", async () => {
    mockDraft = "Oi João";
    renderComposer();

    fireEvent.click(screen.getByLabelText("Enviar mensagem"));

    await waitFor(() => {
      expect(mockSendMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: "5511999990000",
          message: "Oi João",
          instanceName: "inst1",
          instanceId: "inst-uuid-1",
        }),
      );
    });
  });

  // ─── canReply=false shows warning ─────────────────────────
  it("shows permission warning when canReply is false", () => {
    renderComposer({ canReply: false });
    expect(screen.getByText(/Sem permissao/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Gravar audio")).not.toBeInTheDocument();
  });

  // ─── Mic click enters RECORDING ──────────────────────────
  it("shows AudioRecorder when mic is clicked", () => {
    renderComposer();
    fireEvent.click(screen.getByLabelText("Gravar audio"));
    expect(screen.getByTestId("audio-recorder")).toBeInTheDocument();
  });
});
