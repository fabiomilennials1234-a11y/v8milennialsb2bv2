/**
 * ChatBubbleComposer — digitar enquanto a mensagem anterior é enviada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));

import { ChatBubbleComposer } from "@/modules/communication/components/chat/bubble/ChatBubbleComposer";
import { FilaCheiaError, FilaInterrompidaError, MENSAGEM_DE_FILA_CHEIA } from "@/modules/communication/hooks/chat/shared/filaDeEnvio";
import { toast } from "sonner";
import { notifyError } from "@/shared/errors";

const PROPS = { phoneNumber: "5511999990000", instanceId: "inst-1", instanceName: "inst1", canReply: true, leadId: "lead-1" };

describe("ChatBubbleComposer — digitar durante o envio", () => {
  beforeEach(() => {
    sendState.pending = false;
    mockSendMutateAsync.mockReset();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(notifyError).mockClear();
  });

  it("texto novo sobrevive ao resolve do envio anterior", async () => {
    let resolve!: (v: unknown) => void;
    const p = new Promise((r) => { resolve = r; });
    mockSendMutateAsync.mockReturnValueOnce(p);
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    fireEvent.change(box, { target: { value: "primeira" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue("");
    fireEvent.change(box, { target: { value: "segunda" } });
    await act(async () => { resolve({}); await p; });
    expect(box).toHaveValue("segunda");
  });

  it("não desabilita a caixa de texto com o envio pendente e preserva o que se digita", () => {
    sendState.pending = true;
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    expect(box).not.toBeDisabled();
    fireEvent.change(box, { target: { value: "segunda" } });
    expect(box).toHaveValue("segunda");
  });

  it("Enter com envio pendente entra na fila (sem trava própria)", async () => {
    sendState.pending = true;
    mockSendMutateAsync.mockResolvedValue({});
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    fireEvent.change(box, { target: { value: "segunda" } });
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).not.toBeDisabled();
    await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
    expect(mockSendMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ message: "segunda" }));
    expect(box).toHaveValue("");
  });

  it("fila cheia: avisa e devolve o rascunho (se a caixa ainda estiver vazia)", async () => {
    mockSendMutateAsync.mockRejectedValueOnce(new FilaCheiaError());
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    fireEvent.change(box, { target: { value: "sexta" } });
    await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
    expect(box).toHaveValue("sexta");
    expect(toast.warning).toHaveBeenCalledWith(MENSAGEM_DE_FILA_CHEIA);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("item interrompido não gera toast (a bolha de falha já diz)", async () => {
    mockSendMutateAsync.mockRejectedValueOnce(new FilaInterrompidaError());
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    fireEvent.change(box, { target: { value: "esperava" } });
    await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
    expect(notifyError).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(box).toHaveValue("");
  });

  it("falha real: toast de erro de sempre", async () => {
    mockSendMutateAsync.mockRejectedValueOnce(new Error("sessão morta"));
    render(<ChatBubbleComposer {...PROPS} />);
    const box = screen.getByLabelText("Mensagem");
    fireEvent.change(box, { target: { value: "x" } });
    await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});
