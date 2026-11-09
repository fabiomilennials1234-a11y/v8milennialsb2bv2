/**
 * Ctrl+V de print no ChatComposer (desktop): vira o mesmo anexo do botão de
 * anexar (validação + preview "Enviar Imagem"), sem enviar nada sozinho.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/modules/engagement", () => ({ CreateMeetingDialog: () => null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
  useCurrentTeamMember: () => ({ data: { organization_id: "o1" } }),
}));
vi.mock("@/modules/communication/hooks/useConversationDraft", () => ({
  useConversationDraft: () => ({ draft: "", setDraft: vi.fn() }),
}));
vi.mock("@/modules/communication/hooks/chat/useWhatsAppSend", () => ({
  useSendWhatsAppMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useSendWhatsAppMedia: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/communication/hooks/chat/useTypingPresence", () => ({
  useTypingPresence: () => ({ notifyTyping: vi.fn(), stopTyping: vi.fn() }),
}));
vi.mock("@/modules/communication/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));
vi.mock("@/modules/communication/hooks/useInstanceCapabilities", () => ({
  useInstanceCapabilities: () => ({
    supportsInteractiveMenu: false,
    supportsPix: false,
    supportsContactCard: false,
    supportsLocation: false,
  }),
}));
vi.mock("@/modules/communication/hooks/chat/useChatReply", () => ({
  useChatReply: () => null,
}));
vi.mock("@/shared/hooks/use-keyboard-offset", () => ({
  useKeyboardOffset: () => ({ offset: 0 }),
}));
vi.mock("@/modules/communication/components/chat/media/AudioRecorder", () => ({
  AudioRecorder: () => null,
}));
vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));
vi.mock("@/modules/communication/components/chat/SlashCommandPopover", () => ({
  SlashCommandPopover: () => null,
}));
vi.mock("./SendMenuDialog", () => ({ SendMenuDialog: () => null }));
vi.mock("./SendPixDialog", () => ({ SendPixDialog: () => null }));
vi.mock("./SendRichContactActions", () => ({ SendRichContactActions: () => null }));
vi.mock("./ComposerEmojiPicker", () => ({ ComposerEmojiPicker: () => null }));

import { ChatComposer } from "./ChatComposer";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const base = {
  conversationKey: "i1:5511999990000",
  phoneNumber: "5511999990000",
  contactName: "Fulano",
  instanceName: "inst",
  instanceId: "i1",
  canReply: true,
  selectedContact: { push_name: "Fulano", lead_name: null, phone_number: "5511999990000", lead_id: null },
};

function paste(target: Element, { files = [] as File[], text = "" } = {}) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, items: [], getData: (t: string) => (t === "text/plain" ? text : "") },
  });
  target.dispatchEvent(event);
  return event;
}

const print = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });

describe("ChatComposer — colar print (Ctrl+V)", () => {
  it("print no campo de mensagem vira anexo com preview, pronto para enviar", async () => {
    render(wrap(<ChatComposer {...base} />));
    const event = paste(screen.getByRole("textbox", { name: /Digite uma mensagem/ }), { files: [print()] });
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole("button", { name: "Enviar Imagem" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/legenda/i)).toBeTruthy();
  });

  it("com foco fora do campo (lista de mensagens) também anexa", async () => {
    render(wrap(<ChatComposer {...base} />));
    paste(document.body, { files: [print()] });
    expect(await screen.findByRole("button", { name: "Enviar Imagem" })).toBeTruthy();
  });

  it("texto colado continua sendo só texto: nada de anexo", () => {
    render(wrap(<ChatComposer {...base} />));
    const event = paste(screen.getByRole("textbox", { name: /Digite uma mensagem/ }), { text: "olá" });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("button", { name: "Enviar Imagem" })).toBeNull();
  });

  it("imagem + texto (cópia do Excel) cola o texto, não anexa", () => {
    render(wrap(<ChatComposer {...base} />));
    const event = paste(screen.getByRole("textbox", { name: /Digite uma mensagem/ }), { files: [print()], text: "A1	B1" });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("button", { name: "Enviar Imagem" })).toBeNull();
  });

  it("arquivo não aceito (ex.: .exe) é recusado, sem anexo", () => {
    render(wrap(<ChatComposer {...base} />));
    paste(document.body, { files: [new File(["x"], "setup.exe", { type: "application/x-msdownload" })] });
    expect(screen.queryByRole("button", { name: /Enviar (Imagem|Arquivo|Vídeo)/ })).toBeNull();
  });

  it("sem permissão de responder, colar não anexa", () => {
    render(wrap(<ChatComposer {...base} canReply={false} />));
    paste(document.body, { files: [print()] });
    expect(screen.queryByRole("button", { name: "Enviar Imagem" })).toBeNull();
  });
});
