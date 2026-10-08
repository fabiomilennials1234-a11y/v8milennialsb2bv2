/**
 * Encaminhar — a evidência no balão. Mensagem com `forwarded_from_message_id`
 * mostra "Encaminhada"; as demais, não. Mensagem apagada não mostra (o
 * placeholder de apagada toma o balão).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { createWrapper } from "../../../../../tests/helpers/hook-test-utils";
import { MessageBubble } from "./MessagePrimitives";
import type { WhatsAppMessage } from "@/modules/communication/hooks/useWhatsAppChat";

vi.mock("@/modules/communication/hooks/useMessageActions", () => ({
  useEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  isFeatureUnavailable: () => false,
}));

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function msg(over: Partial<Record<string, unknown>> = {}): WhatsAppMessage {
  const ts = "2026-10-08T12:00:00.000Z";
  return {
    id: "m-1",
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: "m-1",
    remote_jid: "5548999990000@s.whatsapp.net",
    phone_number: "5548999990000",
    direction: "outgoing",
    message_type: "text",
    content: "Segue o pedido",
    media_url: null,
    push_name: null,
    status: "sent",
    lead_id: null,
    timestamp: ts,
    created_at: ts,
    sent_by_ai: false,
    sent_source: "manual",
    ...over,
  } as unknown as WhatsAppMessage;
}

function render(message: WhatsAppMessage) {
  return rtlRender(<MessageBubble message={message} onImagePreview={() => {}} />, {
    wrapper: createWrapper(),
  });
}

describe("rótulo Encaminhada", () => {
  it("aparece quando a mensagem foi encaminhada pelo Torque", () => {
    render(msg({ forwarded_from_message_id: "row-origem" }));
    expect(screen.getByText("Encaminhada")).toBeInTheDocument();
  });

  it("não aparece em mensagem comum", () => {
    render(msg());
    expect(screen.queryByText("Encaminhada")).not.toBeInTheDocument();
  });

  it("não aparece em mensagem apagada", () => {
    render(msg({ forwarded_from_message_id: "row-origem", deleted_at: "2026-10-08T12:05:00Z" }));
    expect(screen.queryByText("Encaminhada")).not.toBeInTheDocument();
  });
});
