/**
 * A bolha do chat V5 desenha a menção de grupo com o NOME (Chamado 6885e65d).
 *
 * Antes: `@11111111111111 confere o pedido` saía cru — o vendedor via um número
 * que não é nem telefone (é o LID do participante). Agora a menção vira um
 * `<span data-wa-mention>` com `@Nome`; sem nome conhecido, continua o número.
 *
 * Fixtures fictícias.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { createWrapper } from "../../../../../../tests/helpers/hook-test-utils";
import { MessageBubble } from "../MessagePrimitives";
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

const ANA = "11111111111111@lid";
const BETO = "222222222222222@lid";

function msg(over: Partial<Record<string, unknown>> = {}): WhatsAppMessage {
  const ts = "2026-10-15T13:38:42.000Z";
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: "wamid-1",
    remote_jid: "120000000000000000@g.us",
    phone_number: "120000000000000000",
    direction: "incoming",
    message_type: "text",
    content: "@11111111111111 @222222222222222 confere o pedido",
    media_url: null,
    push_name: "Carla Teste",
    is_group: true,
    status: "received",
    lead_id: null,
    timestamp: ts,
    created_at: ts,
    sent_by_ai: false,
    uazapi_mentioned_jids: [ANA, BETO],
    ...over,
  } as unknown as WhatsAppMessage;
}

function render(message: WhatsAppMessage, mentionNames?: ReadonlyMap<string, string>) {
  return rtlRender(<MessageBubble message={message} onImagePreview={() => {}} mentionNames={mentionNames} />, {
    wrapper: createWrapper(),
  });
}

describe("menção de grupo na bolha V5", () => {
  it("mostra @Nome no lugar do LID resolvido, marcado com data-wa-mention", () => {
    const { container } = render(msg(), new Map([[ANA, "Ana Teste"]]));
    const mentions = container.querySelectorAll("[data-wa-mention]");
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toHaveTextContent("@Ana Teste");
    expect(screen.queryByText(/@11111111111111/)).not.toBeInTheDocument();
  });

  it("LID sem nome conhecido continua com o número, intacto", () => {
    const { container } = render(msg(), new Map([[ANA, "Ana Teste"]]));
    expect(container.querySelectorAll("[data-wa-mention]")[1]).toHaveTextContent("@222222222222222");
    expect(container.querySelector("p.whitespace-pre-wrap")).toHaveTextContent(
      "@Ana Teste @222222222222222 confere o pedido",
    );
  });

  it("menção que chega pelo Realtime (raw_payload inteiro, sem projeção) também resolve", () => {
    const { container } = render(
      msg({
        uazapi_mentioned_jids: undefined,
        raw_payload: { content: { contextInfo: { mentionedJID: [ANA] } } },
        content: "@11111111111111 ok",
      }),
      new Map([[ANA, "Ana Teste"]]),
    );
    expect(container.querySelector("[data-wa-mention]")).toHaveTextContent("@Ana Teste");
  });

  it("legenda de imagem com menção também resolve", () => {
    const { container } = render(
      msg({ message_type: "image", media_url: null, content: "@11111111111111 confirma o pix" }),
      new Map([[ANA, "Ana Teste"]]),
    );
    expect(container.querySelector("[data-wa-mention]")).toHaveTextContent("@Ana Teste");
  });

  it("mensagem sem menção sai exatamente como veio", () => {
    const { container } = render(msg({ content: "frete FOB, ok", uazapi_mentioned_jids: null }));
    expect(container.querySelector("[data-wa-mention]")).toBeNull();
    expect(screen.getByText("frete FOB, ok")).toBeInTheDocument();
  });
});
