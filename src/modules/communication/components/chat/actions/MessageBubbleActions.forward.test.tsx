/**
 * Botão "Encaminhar" na barra da bolha: só aparece quando a mensagem é
 * encaminhável e dispara o pedido de abertura do seletor.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/modules/communication/hooks/useMessageActions", () => {
  const m = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useReactMessage: m,
    useEditMessage: m,
    usePinMessage: m,
    useDeleteMessage: m,
    useMarkMessageRead: m,
    useDownloadMedia: m,
    isFeatureUnavailable: () => false,
  };
});
vi.mock("@/modules/communication/hooks/useInstanceCapabilities", () => ({
  useInstanceCapabilities: () => ({ canUseUazapiActions: true }),
}));
vi.mock("../../../hooks/chat/useChatReply", () => ({ useChatReply: () => null }));
vi.mock("./EmojiPickerPopover", () => ({ EmojiPickerPopover: () => null }));
vi.mock("./DeleteMessageConfirm", () => ({ DeleteMessageConfirm: () => null }));

import { MessageBubbleActions } from "./MessageBubbleActions";

const base = {
  instanceId: "i1",
  messageId: "m1",
  number: "5511912345678",
  direction: "incoming" as const,
  canEdit: false,
  canDelete: false,
  isPinned: false,
  onRequestEdit: () => {},
};

describe("MessageBubbleActions — Encaminhar", () => {
  it("canForward: mostra o botão e dispara onRequestForward", () => {
    const onRequestForward = vi.fn();
    render(<MessageBubbleActions {...base} canForward onRequestForward={onRequestForward} />);
    fireEvent.click(screen.getByRole("button", { name: /encaminhar mensagem/i }));
    expect(onRequestForward).toHaveBeenCalledTimes(1);
  });

  it("sem canForward (ou sem handler): não mostra o botão", () => {
    const { rerender } = render(<MessageBubbleActions {...base} onRequestForward={() => {}} />);
    expect(screen.queryByRole("button", { name: /encaminhar mensagem/i })).toBeNull();
    rerender(<MessageBubbleActions {...base} canForward />);
    expect(screen.queryByRole("button", { name: /encaminhar mensagem/i })).toBeNull();
  });
});
