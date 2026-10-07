/**
 * Chamado 6dfcae6d (PR-A) — nome de quem escreveu, no balão de GRUPO.
 *
 * Regras: só em grupo, só em mensagem recebida, só na PRIMEIRA de uma sequência
 * do mesmo remetente, e nada quando o nome não foi gravado.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { createWrapper } from "../../../../../tests/helpers/hook-test-utils";
import { MessageList, type MessageListProps } from "./view/MessageList";
import type { WhatsAppMessage } from "@/modules/communication/hooks/useWhatsAppChat";

vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock("@/modules/communication/hooks/useMessageActions", () => ({
  useEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  isFeatureUnavailable: () => false,
}));

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
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

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: createWrapper() });
}

let seq = 0;
function msg(over: Partial<Record<string, unknown>> = {}): WhatsAppMessage {
  seq += 1;
  const ts = new Date(Date.UTC(2026, 9, 7, 12, 0, seq)).toISOString();
  return {
    id: `m-${seq}`,
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: `m-${seq}`,
    remote_jid: "120363000000000000@g.us",
    phone_number: "120363000000000000",
    direction: "incoming",
    message_type: "text",
    content: `texto ${seq}`,
    media_url: null,
    push_name: "Ana Souza",
    status: "received",
    lead_id: null,
    timestamp: ts,
    created_at: ts,
    sent_by_ai: false,
    is_group: true,
    ...over,
  } as unknown as WhatsAppMessage;
}

function props(messages: WhatsAppMessage[]): MessageListProps {
  return {
    messages,
    transferEvents: [],
    failedMessages: [],
    calls: [],
    isLoading: false,
    contactName: "Grupo",
    instanceName: "Comercial",
    lastReadAt: 0,
    mountTime: Date.now(),
    onImagePreview: vi.fn(),
    onRetry: vi.fn(),
    onOpenTemplates: vi.fn(),
  };
}

describe("balão de grupo — nome do remetente", () => {
  it("mostra o nome na primeira mensagem recebida de grupo", () => {
    render(<MessageList {...props([msg()])} />);
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
  });

  it("não repete o nome na sequência do mesmo remetente", () => {
    render(<MessageList {...props([msg(), msg(), msg()])} />);
    expect(screen.getAllByText("Ana Souza")).toHaveLength(1);
  });

  it("mostra o nome de novo quando o remetente muda e quando volta", () => {
    render(<MessageList {...props([msg(), msg({ push_name: "Bruno Lima" }), msg()])} />);
    expect(screen.getAllByText("Ana Souza")).toHaveLength(2);
    expect(screen.getAllByText("Bruno Lima")).toHaveLength(1);
  });

  it("não mostra nome em mensagem enviada por nós", () => {
    render(<MessageList {...props([msg({ direction: "outgoing" })])} />);
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("não mostra nome em conversa 1:1", () => {
    render(<MessageList {...props([msg({ is_group: false })])} />);
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("sem push_name não mostra nada (nem undefined, nem telefone)", () => {
    const { container } = render(
      <MessageList {...props([msg({ push_name: null }), msg({ push_name: "   " })])} />,
    );
    expect(container.textContent).not.toMatch(/undefined|null|120363000000000000/);
    expect(container.querySelector("[data-group-sender]")).toBeNull();
  });

  it("renderiza o nome como texto, não como HTML", () => {
    const { container } = render(
      <MessageList {...props([msg({ push_name: "<img src=x onerror=alert(1)>" })])} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});
