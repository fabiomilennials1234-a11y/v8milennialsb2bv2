/**
 * ChatBubbleComposer — digitar enquanto a mensagem anterior é enviada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const sendState = { pending: false };
const mockSendMutateAsync = vi.fn();

vi.mock("@/modules/communication/hooks/chat/useWhatsAppSend", () => ({
  useSendWhatsAppMessage: () => ({ mutateAsync: mockSendMutateAsync, isPending: sendState.pending }),
  useSendWhatsAppMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/modules/communication/components/chat/media/AudioRecorder", () => ({
  AudioRecorder: () => <div />,
}));

import { ChatBubbleComposer } from "@/modules/communication/components/chat/bubble/ChatBubbleComposer";

const PROPS = { phoneNumber: "5511999990000", instanceId: "inst-1", instanceName: "inst1", canReply: true, leadId: "lead-1" };

describe("ChatBubbleComposer — digitar durante o envio", () => {
  beforeEach(() => {
    sendState.pending = false;
    mockSendMutateAsync.mockReset();
  });

  it("não desabilita a caixa de texto com o envio pendente e preserva o que se digita", () => {
    sendState.pending = true;
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    expect(box).not.toBeDisabled();
    fireEvent.change(box, { target: { value: "segunda" } });
    expect(box).toHaveValue("segunda");
  });

  it("Enter com envio pendente não envia de novo e mantém o texto", () => {
    sendState.pending = true;
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    fireEvent.change(box, { target: { value: "segunda" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(mockSendMutateAsync).not.toHaveBeenCalled();
    expect(box).toHaveValue("segunda");
  });
});
