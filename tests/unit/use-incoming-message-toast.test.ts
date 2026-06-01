import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity/auth/contexts/AuthContext";
import { useIncomingMessageToast } from "@/modules/communication/hooks/useIncomingMessageToast";
import { createWrapper } from "../helpers/hook-test-utils";

// --- Mocks ---

const mockUnsubscribe = vi.fn();
const mockOn = vi.fn().mockReturnThis();
const mockSubscribe = vi.fn().mockReturnThis();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(() => ({
      on: mockOn,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    })),
    removeChannel: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useLocation: vi.fn(() => ({ pathname: "/leads" })),
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock("sonner", () => ({ toast: vi.fn() }));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "user-1" },
    organizationId: "org-1",
  })),
}));

// --- Helpers ---

function simulateInsert(row: Record<string, unknown>) {
  // Extract the callback from the `.on()` call
  const onCall = mockOn.mock.calls.find(
    (call) => call[0] === "postgres_changes",
  );
  if (!onCall) throw new Error("No postgres_changes subscription found");
  const callback = onCall[2];
  callback({ eventType: "INSERT", new: row, old: {} });
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    organization_id: "org-1",
    channel: "whatsapp",
    direction: "inbound",
    sender_name: "João Silva",
    content: "Boa tarde, gostaria de saber sobre os produtos",
    lead_id: "lead-1",
    phone_number: "+5511999999999",
    remote_jid: "5511999999999@s.whatsapp.net",
    message_type: "text",
    timestamp: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// --- Tests ---

describe("useIncomingMessageToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("NÃO exibe toast quando pathname é /chat-whatsapp", () => {
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/chat-whatsapp",
      search: "",
      hash: "",
      state: null,
      key: "default",
    });

    renderHook(() => useIncomingMessageToast(), {
      wrapper: createWrapper(),
    });

    // Simulate inbound message
    simulateInsert(makeMessage());

    expect(toast).not.toHaveBeenCalled();
  });

  it("NÃO exibe toast quando pathname é /chat", () => {
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/chat",
      search: "",
      hash: "",
      state: null,
      key: "default",
    });

    renderHook(() => useIncomingMessageToast(), {
      wrapper: createWrapper(),
    });

    simulateInsert(makeMessage());

    expect(toast).not.toHaveBeenCalled();
  });

  it("exibe toast quando mensagem inbound chega e pathname é /leads", () => {
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/leads",
      search: "",
      hash: "",
      state: null,
      key: "default",
    });

    renderHook(() => useIncomingMessageToast(), {
      wrapper: createWrapper(),
    });

    simulateInsert(makeMessage());

    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining("João Silva"),
      expect.objectContaining({
        action: expect.objectContaining({ label: "Ver conversa" }),
      }),
    );
  });

  it("NÃO exibe toast para mensagens outbound", () => {
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/leads",
      search: "",
      hash: "",
      state: null,
      key: "default",
    });

    renderHook(() => useIncomingMessageToast(), {
      wrapper: createWrapper(),
    });

    simulateInsert(makeMessage({ direction: "outbound" }));

    expect(toast).not.toHaveBeenCalled();
  });

  it("trunca conteúdo em 80 caracteres com reticências", () => {
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/dashboard",
      search: "",
      hash: "",
      state: null,
      key: "default",
    });

    const longContent = "A".repeat(120);

    renderHook(() => useIncomingMessageToast(), {
      wrapper: createWrapper(),
    });

    simulateInsert(makeMessage({ content: longContent, sender_name: "Maria" }));

    const expectedPreview = `Maria: ${"A".repeat(80)}...`;
    expect(toast).toHaveBeenCalledWith(expectedPreview, expect.any(Object));
  });

  it("exibe conteúdo completo quando <= 80 caracteres", () => {
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/dashboard",
      search: "",
      hash: "",
      state: null,
      key: "default",
    });

    const shortContent = "Oi, tudo bem?";

    renderHook(() => useIncomingMessageToast(), {
      wrapper: createWrapper(),
    });

    simulateInsert(makeMessage({ content: shortContent, sender_name: "Pedro" }));

    expect(toast).toHaveBeenCalledWith(`Pedro: ${shortContent}`, expect.any(Object));
  });

  it("remove channel do Supabase no unmount", () => {
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/leads",
      search: "",
      hash: "",
      state: null,
      key: "default",
    });

    const { unmount } = renderHook(() => useIncomingMessageToast(), {
      wrapper: createWrapper(),
    });

    expect(supabase.removeChannel).not.toHaveBeenCalled();

    unmount();

    expect(supabase.removeChannel).toHaveBeenCalledOnce();
  });
});
