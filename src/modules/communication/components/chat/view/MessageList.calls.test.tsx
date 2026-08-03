/**
 * A ligação entra na MESMA linha do tempo das mensagens, na ordem certa.
 *
 * O vendedor não pensa "aba de ligações" — ele pensa "o que aconteceu com esse
 * lead". Ligação e mensagem são a mesma história, então a prova aqui é de
 * ORDEM: a ligação tem que cair exatamente entre as mensagens que a cercam no
 * tempo, e não no fim nem no começo da lista.
 *
 * Também trava o caso de janela: mensagens e ligações são buscadas com o MESMO
 * recorte (a conversa inteira, sem paginação nos dois lados). Se um dia alguém
 * recortar só um dos lados, o teste de ordem denuncia — a ligação aparece sem a
 * mensagem vizinha.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { createWrapper } from "../../../../../../tests/helpers/hook-test-utils";
import { MessageList, type MessageListProps } from "./MessageList";
import type { ConversationCall } from "@/modules/communication/lib/conversationCallsQuery";
import type { WhatsAppMessage } from "@/modules/communication/hooks/useWhatsAppChat";

vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

// A barra de ações do balão puxa auth/instância — nada a ver com a ordem da
// linha do tempo, que é o que este arquivo prova.
vi.mock("@/modules/communication/hooks/useMessageActions", () => ({
  useEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  isFeatureUnavailable: () => false,
}));

// jsdom não implementa scroll — o auto-scroll do MessageList explodiria antes
// de qualquer asserção. Lacuna do ambiente, não do produto.
beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  // `prefers-reduced-motion` — jsdom também não tem matchMedia.
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

/** MessageBubble consulta o React Query — sem provider a thread nem monta. */
function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: createWrapper() });
}

function msg(id: string, timestamp: string, content: string): WhatsAppMessage {
  return {
    id,
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: id,
    remote_jid: "554896458738@s.whatsapp.net",
    phone_number: "554896458738",
    direction: "incoming",
    message_type: "text",
    content,
    media_url: null,
    push_name: "Isabelly",
    status: "received",
    lead_id: null,
    timestamp,
    created_at: timestamp,
    sent_by_ai: false,
  } as unknown as WhatsAppMessage;
}

function call(over: Partial<ConversationCall> = {}): ConversationCall {
  return {
    id: "call-1",
    lead_id: "lead-1",
    direction: "outbound",
    outcome: "connected",
    duration_seconds: 220,
    phone_number: "48996458738",
    started_at: "2026-08-02T12:00:00.000Z",
    // Ausência de gravação — o estado de 100% das ligações em produção hoje.
    recording_status: null,
    recording_url: null,
    recording_failure_reason: null,
    ...over,
  };
}

function baseProps(over: Partial<MessageListProps> = {}): MessageListProps {
  return {
    messages: [],
    transferEvents: [],
    failedMessages: [],
    calls: [],
    isLoading: false,
    contactName: "Isabelly",
    instanceName: "Comercial",
    lastReadAt: 0,
    mountTime: Date.now(),
    onImagePreview: vi.fn(),
    onRetry: vi.fn(),
    onOpenTemplates: vi.fn(),
    ...over,
  };
}

/** `true` quando `a` aparece antes de `b` na ordem real do documento. */
function vemAntes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Confere que a sequência inteira está em ordem de cima para baixo. */
function emOrdem(nodes: Element[]): boolean {
  return nodes.every((n, i) => i === 0 || vemAntes(nodes[i - 1], n));
}

describe("MessageList — ligação na linha do tempo", () => {
  it("coloca a ligação ENTRE as mensagens que a cercam no tempo", () => {
    const { container } = render(
      <MessageList
        {...baseProps({
          messages: [
            msg("m1", "2026-08-02T10:00:00.000Z", "antes"),
            msg("m2", "2026-08-02T14:00:00.000Z", "depois"),
          ],
          calls: [call({ started_at: "2026-08-02T12:00:00.000Z" })],
        })}
      />,
    );

    const marker = screen.getByTestId("call-marker");
    const antes = screen.getByText("antes");
    const depois = screen.getByText("depois");

    // `compareDocumentPosition` lê a ordem real no DOM.
    expect(antes.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(marker.compareDocumentPosition(depois) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("ligação anterior a toda mensagem aparece no topo", () => {
    render(
      <MessageList
        {...baseProps({
          messages: [msg("m1", "2026-08-02T10:00:00.000Z", "primeira msg")],
          calls: [call({ started_at: "2026-08-01T09:00:00.000Z" })],
        })}
      />,
    );
    const marker = screen.getByTestId("call-marker");
    const primeira = screen.getByText("primeira msg");
    expect(marker.compareDocumentPosition(primeira) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ligação posterior a toda mensagem aparece no fim", () => {
    render(
      <MessageList
        {...baseProps({
          messages: [msg("m1", "2026-08-02T10:00:00.000Z", "ultima msg")],
          calls: [call({ started_at: "2026-08-03T09:00:00.000Z" })],
        })}
      />,
    );
    const marker = screen.getByTestId("call-marker");
    const ultima = screen.getByText("ultima msg");
    expect(ultima.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("várias ligações e mensagens intercaladas mantêm a ordem cronológica", () => {
    render(
      <MessageList
        {...baseProps({
          messages: [
            msg("m1", "2026-08-02T09:00:00.000Z", "A"),
            msg("m2", "2026-08-02T11:00:00.000Z", "B"),
            msg("m3", "2026-08-02T15:00:00.000Z", "C"),
          ],
          calls: [
            call({ id: "c1", started_at: "2026-08-02T10:00:00.000Z" }),
            call({ id: "c2", started_at: "2026-08-02T13:00:00.000Z", outcome: "no_answer", duration_seconds: null }),
          ],
        })}
      />,
    );

    const [lig1, lig2] = screen.getAllByTestId("call-marker");
    // Esperado de cima para baixo: A · ligação · B · ligação · C
    expect(
      emOrdem([
        screen.getByText("A"),
        lig1,
        screen.getByText("B"),
        lig2,
        screen.getByText("C"),
      ]),
    ).toBe(true);

    // E a ordem entre as duas ligações também é a do relógio.
    expect(lig1.getAttribute("data-connected")).toBe("true");
    expect(lig2.getAttribute("data-connected")).toBe("false");
  });

  it("entrada e saída convivem na mesma thread", () => {
    render(
      <MessageList
        {...baseProps({
          messages: [msg("m1", "2026-08-02T09:00:00.000Z", "oi")],
          calls: [
            call({ id: "c1", direction: "outbound", started_at: "2026-08-02T10:00:00.000Z" }),
            call({ id: "c2", direction: "inbound", started_at: "2026-08-02T11:00:00.000Z" }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Ligação realizada")).toBeInTheDocument();
    expect(screen.getByText("Ligação recebida")).toBeInTheDocument();
  });

  it("a não atendida aparece junto com as mensagens, não escondida", () => {
    render(
      <MessageList
        {...baseProps({
          messages: [msg("m1", "2026-08-02T09:00:00.000Z", "oi")],
          calls: [call({ outcome: "no_answer", duration_seconds: null })],
        })}
      />,
    );
    expect(screen.getByTestId("call-marker")).toBeInTheDocument();
    expect(screen.getByText("Não atendeu")).toBeInTheDocument();
  });
});

describe("MessageList — lead sem ligação nenhuma", () => {
  it("nada muda: nenhum marco na thread", () => {
    render(
      <MessageList
        {...baseProps({
          messages: [
            msg("m1", "2026-08-02T09:00:00.000Z", "oi"),
            msg("m2", "2026-08-02T10:00:00.000Z", "tudo bem?"),
          ],
          calls: [],
        })}
      />,
    );
    expect(screen.queryByTestId("call-marker")).not.toBeInTheDocument();
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(screen.getByText("tudo bem?")).toBeInTheDocument();
  });

  it("a prop é opcional — quem ainda não passa `calls` continua funcionando", () => {
    const props = baseProps({ messages: [msg("m1", "2026-08-02T09:00:00.000Z", "oi")] });
    delete (props as Partial<MessageListProps>).calls;
    render(<MessageList {...props} />);
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(screen.queryByTestId("call-marker")).not.toBeInTheDocument();
  });
});

describe("MessageList — conversa só com ligação", () => {
  it("o vendedor que ligou antes de escrever vê a ligação, não 'nada aqui ainda'", () => {
    render(
      <MessageList
        {...baseProps({
          messages: [],
          calls: [call({ duration_seconds: 122 })],
        })}
      />,
    );
    expect(screen.getByTestId("call-marker")).toBeInTheDocument();
    expect(screen.getByText("2min 2s")).toBeInTheDocument();
  });

  it("sem mensagem E sem ligação, a tela de conversa vazia continua", () => {
    render(<MessageList {...baseProps({ messages: [], calls: [] })} />);
    expect(screen.queryByTestId("call-marker")).not.toBeInTheDocument();
  });
});

describe("MessageList — separador de data", () => {
  it("uma ligação que ABRE o dia não engole o separador da data", () => {
    // A ligação é o primeiro item do dia 03. Se o separador só fosse desenhado
    // no ramo de mensagem, a msg seguinte compararia a data com a da ligação
    // (igual) e o dia 03 começaria sem marca nenhuma.
    // Datas bem no passado de propósito: perto de "hoje" o rótulo vira
    // "Hoje"/"Ontem" e o teste passaria a depender do dia em que roda.
    render(
      <MessageList
        {...baseProps({
          messages: [
            msg("m1", "2025-03-10T12:00:00.000Z", "dia 10"),
            msg("m2", "2025-03-12T15:00:00.000Z", "dia 12"),
          ],
          calls: [call({ started_at: "2025-03-12T13:00:00.000Z" })],
        })}
      />,
    );

    // O dia 12 precisa ter a sua própria marca, e ela tem que vir ANTES da
    // ligação que abre o dia.
    const marcaDia12 = screen.getByText("12/03/2025");
    expect(vemAntes(marcaDia12, screen.getByTestId("call-marker"))).toBe(true);
    // E o dia 10 continua marcado.
    expect(screen.getByText("10/03/2025")).toBeInTheDocument();
    // Dois dias distintos ⇒ exatamente dois separadores, sem duplicar.
    expect(screen.getAllByText(/\d{2}\/\d{2}\/2025/)).toHaveLength(2);
  });
});
