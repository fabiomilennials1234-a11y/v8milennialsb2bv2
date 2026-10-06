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

const sendState = { pending: false };
const mockSendMutateAsync = vi.fn();

vi.mock("@/modules/communication/hooks/chat/useWhatsAppSend", () => ({
  useSendWhatsAppMessage: () => ({ mutateAsync: mockSendMutateAsync, isPending: sendState.pending }),
  useSendWhatsAppMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useMessageTemplates: () => ({ data: [] }),
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
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

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
    mockSendMutateAsync.mockReset();
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
