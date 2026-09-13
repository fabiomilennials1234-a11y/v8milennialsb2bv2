import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InteractiveResponseBubble } from "../../src/modules/communication/components/chat/bubbles/InteractiveResponseBubble";

afterEach(cleanup);
describe("Uazapi selections in the chat", () => {
  it.each([true, false])("renders the display label for outgoing=%s", (isOutgoing) => {
    render(<InteractiveResponseBubble content="Concluir" messageType="listResponse" isOutgoing={isOutgoing} />);
    expect(screen.getByText("Selecionou (lista)")).toBeTruthy();
    expect(screen.getByText("Concluir")).toBeTruthy();
  });
  it("does not add a selection badge to ordinary text", () => {
    const { container } = render(<InteractiveResponseBubble content="Olá" messageType="text" isOutgoing={false} />);
    expect(container.textContent).toBe("");
  });
});

import { fireEvent } from "@testing-library/react";
import { MessageSticker } from "../../src/modules/communication/components/chat/media/MessageMedia";
it("keeps a failed sticker visible and recovers when its URL is refreshed", () => {
  const { rerender } = render(<MessageSticker src="https://example.test/old.webp" />);
  fireEvent.error(screen.getByAltText("Figurinha"));
  expect(screen.getByRole("status").textContent).toBe("Figurinha indisponível");
  rerender(<MessageSticker src="https://example.test/new.webp" />);
  expect(screen.getByAltText("Figurinha")).toBeTruthy();
});

it("renders the canonical incoming list_response persisted by ingestion", () => {
  render(<InteractiveResponseBubble content="Validar" messageType="list_response" isOutgoing={false} />);
  expect(screen.getByText("Selecionou (lista)")).toBeTruthy();
  expect(screen.getByText("Validar")).toBeTruthy();
});
