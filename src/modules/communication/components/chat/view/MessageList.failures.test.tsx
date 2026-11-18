import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createWrapper } from "../../../../../../tests/helpers/hook-test-utils";
import { MessageList, type MessageListProps } from "./MessageList";
import type { FailedMessage } from "@/modules/communication/hooks/chat/types";
import { friendlyWhatsAppSendError } from "@/modules/communication/lib/edgeFunctionError";

vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock("@/modules/communication/hooks/useMessageActions", () => ({
  useEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  isFeatureUnavailable: () => false,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
  } },
}));

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  URL.createObjectURL = vi.fn(() => "blob:https://torquecrm.com.br/failed-audio");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

function failure(overrides: Partial<FailedMessage> = {}): FailedMessage {
  return {
    id: "failed-audio", phoneNumber: "5511999999999", instanceId: "instance-1",
    instanceName: "Comercial", message: null, mediaUrl: "data:audio/mpeg;base64,SUQz",
    mediaType: "audio", error: friendlyWhatsAppSendError("the number is not on WhatsApp"),
    timestamp: "2026-11-18T17:41:00Z", direction: "outgoing", status: "failed",
    sent_by_ai: false, ...overrides,
  };
}

function props(failed: FailedMessage): MessageListProps {
  return {
    messages: [], transferEvents: [], failedMessages: [failed], calls: [],
    isLoading: false, contactName: "Cliente", instanceName: "Comercial",
    lastReadAt: 0, mountTime: Date.now(), onImagePreview: vi.fn(),
    onRetry: vi.fn(), onOpenTemplates: vi.fn(),
  };
}

describe("MessageList — envio recusado", () => {
  it("mantém o player, mostra o motivo e preserva o áudio para reenvio", async () => {
    const failed = failure();
    const listProps = props(failed);
    const { container } = render(<MessageList {...listProps} />, { wrapper: createWrapper() });
    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull());
    expect(screen.getByText(failed.error)).toBeInTheDocument();
    expect(screen.queryByText("Documento")).not.toBeInTheDocument();
    expect(screen.queryByText("URL do áudio inválida.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(listProps.onRetry).toHaveBeenCalledWith(expect.objectContaining(failed));
  });

  it("também mostra o motivo de falha em mensagens de texto", () => {
    const failed = failure({ mediaType: null, mediaUrl: null, message: "Olá!", error: "A instância do WhatsApp está desconectada. Reconecte em Configurações > WhatsApp." });
    render(<MessageList {...props(failed)} />, { wrapper: createWrapper() });
    expect(screen.getByText("Olá!")).toBeInTheDocument();
    expect(screen.getByText(failed.error)).toBeInTheDocument();
  });
});
