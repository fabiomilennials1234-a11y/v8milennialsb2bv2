/**
 * Citação (reply) RECEBIDA — o bloco de citação substitui o prefixo
 * `[Em resposta a: "..."]` que o webhook dobra em `content`.
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
});

function msg(over: Partial<Record<string, unknown>> = {}): WhatsAppMessage {
  const ts = "2026-10-08T12:00:00.000Z";
  return {
    id: "m-1",
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: "5548:IN-1",
    remote_jid: "5548999990000@s.whatsapp.net",
    phone_number: "5548999990000",
    direction: "incoming",
    message_type: "text",
    content: "oi",
    media_url: null,
    push_name: null,
    status: "received",
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

describe("MessageBubble: citação recebida", () => {
  it("com reply_context: bloco de citação e corpo SEM o prefixo", () => {
    render(msg({
      content: '[Em resposta a: "Fechamos em 500k?"]\nesse é o valor',
      reply_context: { messageId: "5548:ORIG", text: "Fechamos em 500k?", direction: "outgoing" },
    }));
    expect(screen.getByRole("button", { name: "Ir para a mensagem citada" })).toHaveTextContent("Fechamos em 500k?");
    expect(screen.getByText("esse é o valor")).toBeInTheDocument();
    expect(screen.queryByText(/Em resposta a:/)).not.toBeInTheDocument();
  });

  it("mensagem ANTIGA (só prefixo, sem reply_context): deriva a citação do prefixo", () => {
    render(msg({ content: '[Em resposta a: "quanto custa?"]\nR$ 500' }));
    const bloco = document.querySelector("[data-quoted-reply]")!;
    expect(bloco).toHaveTextContent("quanto custa?");
    expect(bloco).toBeDisabled();
    expect(screen.getByText("R$ 500")).toBeInTheDocument();
    expect(screen.queryByText(/Em resposta a:/)).not.toBeInTheDocument();
  });

  it("clicar na citação rola até a original quando ela está na thread", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const alvo = document.createElement("div");
    alvo.setAttribute("data-wa-message-id", "5548:ORIG");
    document.body.appendChild(alvo);
    render(msg({
      reply_context: { messageId: "5548:ORIG", text: "original", direction: "outgoing" },
    }));
    screen.getByRole("button", { name: "Ir para a mensagem citada" }).click();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    alvo.remove();
  });

  it("original fora da thread: clique não quebra", () => {
    render(msg({
      reply_context: { messageId: "5548:SUMIU", text: "antiga", direction: "outgoing" },
    }));
    expect(() => screen.getByRole("button", { name: "Ir para a mensagem citada" }).click()).not.toThrow();
  });

  it("mensagem sem citação não ganha bloco", () => {
    render(msg({ content: "bom dia" }));
    expect(document.querySelector("[data-quoted-reply]")).toBeNull();
    expect(screen.getByText("bom dia")).toBeInTheDocument();
  });
});
