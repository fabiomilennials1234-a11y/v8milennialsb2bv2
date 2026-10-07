/**
 * ChatComposer — digitar enquanto a mensagem anterior é enviada.
 *
 * Contrato: a caixa de texto não trava durante o envio; o rascunho é limpo na
 * hora do envio (não depois do await), então o que for digitado depois
 * sobrevive tanto ao resolve quanto ao reject; Enter durante o envio não
 * dispara um segundo envio concorrente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const sendState = { pending: false, mediaPending: false };
const mockSendMutateAsync = vi.fn();
const mockMediaMutateAsync = vi.fn();
const mediaTemplate = { id: "t1", name: "Catalogo", body: "Segue", media_url: "https://x/y.pdf", media_type: "document" };

vi.mock("@/modules/communication/hooks/chat/useWhatsAppSend", () => ({
  useSendWhatsAppMessage: () => ({ mutateAsync: mockSendMutateAsync, isPending: sendState.pending }),
  useSendWhatsAppMedia: () => ({ mutateAsync: mockMediaMutateAsync, isPending: sendState.mediaPending }),
}));

// Rascunho em memória, com a mesma forma de useConversationDraft.
vi.mock("@/modules/communication/hooks/useConversationDraft", () => ({
  useConversationDraft: () => {
    const [draft, setDraft] = useState("");
    return { draft, setDraft };
  },
}));

vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1", name: "Vendedor" } }),
}));
vi.mock("@/modules/communication/hooks/chat/useTypingPresence", () => ({
  useTypingPresence: () => ({ typing: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/modules/communication/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [mediaTemplate] }),
}));
vi.mock("@/modules/communication/hooks/useInstanceCapabilities", () => ({
  useInstanceCapabilities: () => ({ canUseUazapiActions: false }),
}));
vi.mock("@/modules/communication/hooks/chat/useChatReply", () => ({
  useChatReply: () => null,
}));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/modules/communication/components/chat/media/AudioRecorder", () => ({
  AudioRecorder: () => <div />,
}));
vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));
vi.mock("@/modules/communication/components/chat/composer/SendMenuDialog", () => ({
  SendMenuDialog: () => null,
}));
vi.mock("@/modules/communication/components/chat/composer/SendPixDialog", () => ({
  SendPixDialog: () => null,
}));
vi.mock("@/modules/communication/components/chat/composer/SendRichContactActions", () => ({
  SendRichContactActions: () => null,
}));
vi.mock("@/modules/communication/components/chat/SlashCommandPopover", () => ({
  SlashCommandPopover: ({ onSelect }: { onSelect: (t: typeof mediaTemplate) => void }) => (
    <button type="button" onClick={() => onSelect(mediaTemplate)}>escolher-template</button>
  ),
}));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

import { toast } from "sonner";
import { ChatComposer } from "@/modules/communication/components/chat/composer/ChatComposer";

const PROPS = {
  conversationKey: "inst-1:5511999990000",
  phoneNumber: "5511999990000",
  contactName: "Maria",
  instanceName: "inst1",
  instanceId: "inst-1",
  canReply: true,
};

const box = () => screen.getByLabelText("Digite uma mensagem para Maria") as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(box(), { target: { value: v } });
const enter = () => fireEvent.keyDown(box(), { key: "Enter" });

describe("ChatComposer — digitar durante o envio", () => {
  beforeEach(() => {
    sendState.pending = false;
    sendState.mediaPending = false;
    mockSendMutateAsync.mockReset();
    mockMediaMutateAsync.mockReset();
    vi.mocked(toast.info).mockClear();
  });

  it("Enter com envio pendente avisa o vendedor em vez de falhar em silêncio", () => {
    sendState.pending = true;
    render(<ChatComposer {...PROPS} />);
    type("segunda");
    enter();
    expect(toast.info).toHaveBeenCalledWith("Aguarde o envio anterior finalizar.");
  });

  it("com mídia pendente, Enter não envia texto em paralelo e o rascunho fica", () => {
    sendState.mediaPending = true;
    render(<ChatComposer {...PROPS} />);
    type("segunda");
    enter();
    expect(mockSendMutateAsync).not.toHaveBeenCalled();
    expect(box()).toHaveValue("segunda");
    expect(screen.getByTitle("Aguardando envio da mensagem anterior")).toBeDisabled();
  });

  it("duplo Enter em sequência real resulta em 1 envio", () => {
    const d = deferred();
    mockSendMutateAsync.mockReturnValue(d.promise);
    const { rerender } = render(<ChatComposer {...PROPS} />);
    type("primeira");
    enter();
    sendState.pending = true;
    rerender(<ChatComposer {...PROPS} />);
    type("segunda");
    enter();
    expect(mockSendMutateAsync).toHaveBeenCalledTimes(1);
    expect(box()).toHaveValue("segunda");
  });

  it("template com mídia: texto digitado durante o envio sobrevive ao resolve", async () => {
    const d = deferred();
    mockMediaMutateAsync.mockReturnValueOnce(d.promise);
    render(<ChatComposer {...PROPS} />);
    type("/cat");
    fireEvent.click(screen.getByText("escolher-template"));
    expect(mockMediaMutateAsync).toHaveBeenCalledTimes(1);
    type("nova");
    await act(async () => { d.resolve({}); await d.promise; });
    expect(box()).toHaveValue("nova");
  });

  it("template com mídia que falha devolve o comando se o rascunho está vazio", async () => {
    const d = deferred();
    mockMediaMutateAsync.mockReturnValueOnce(d.promise);
    render(<ChatComposer {...PROPS} />);
    type("/cat");
    fireEvent.click(screen.getByText("escolher-template"));
    await act(async () => { d.reject(new Error("falhou")); await d.promise.catch(() => {}); });
    expect(box()).toHaveValue("/cat");
  });

  it("template com mídia que falha não pisa no texto novo", async () => {
    const d = deferred();
    mockMediaMutateAsync.mockReturnValueOnce(d.promise);
    render(<ChatComposer {...PROPS} />);
    type("/cat");
    fireEvent.click(screen.getByText("escolher-template"));
    type("nova");
    await act(async () => { d.reject(new Error("falhou")); await d.promise.catch(() => {}); });
    expect(box()).toHaveValue("nova");
  });

  it("não desabilita a caixa de texto com o envio pendente", () => {
    sendState.pending = true;
    render(<ChatComposer {...PROPS} />);
    expect(box()).not.toBeDisabled();
  });

  it("mantém o texto novo quando o envio anterior resolve", async () => {
    const d = deferred();
    mockSendMutateAsync.mockReturnValueOnce(d.promise);
    render(<ChatComposer {...PROPS} />);
    type("primeira");
    enter();
    expect(mockSendMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ message: "primeira" }));
    expect(box()).toHaveValue("");
    type("segunda");
    await act(async () => { d.resolve({}); await d.promise; });
    expect(box()).toHaveValue("segunda");
  });

  it("mantém o texto novo quando o envio anterior falha", async () => {
    const d = deferred();
    mockSendMutateAsync.mockReturnValueOnce(d.promise);
    render(<ChatComposer {...PROPS} />);
    type("primeira");
    enter();
    type("segunda");
    await act(async () => { d.reject(new Error("falhou")); await d.promise.catch(() => {}); });
    expect(box()).toHaveValue("segunda");
  });

  it("Enter com envio pendente não dispara um segundo envio", () => {
    sendState.pending = true;
    render(<ChatComposer {...PROPS} />);
    type("segunda");
    enter();
    expect(mockSendMutateAsync).not.toHaveBeenCalled();
    expect(box()).toHaveValue("segunda");
  });

  it("botão Enviar fica desabilitado e explica a espera", () => {
    sendState.pending = true;
    render(<ChatComposer {...PROPS} />);
    type("segunda");
    const btn = screen.getByTitle("Aguardando envio da mensagem anterior");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-label", "Aguardando envio da mensagem anterior");
  });
});
