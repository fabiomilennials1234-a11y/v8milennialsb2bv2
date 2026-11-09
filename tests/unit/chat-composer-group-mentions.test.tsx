/**
 * ChatComposer — menção (@) em conversa de grupo Uazapi.
 *
 * Digitar `@termo` abre o seletor; Enter/clique insere `@<número> ` e NÃO
 * envia; com o seletor fechado, Enter envia o texto com a menção. Fora de
 * grupo o seletor não existe e os participantes nunca são buscados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

const A = "5548999990001";
const participants = [
  { phone: A, lid: null, name: "Ana Júlia", isAdmin: false },
  { phone: null, lid: "9@lid", name: "Só LID", isAdmin: false },
];
const participantsCalls: unknown[][] = [];

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
  useInstanceCapabilities: () => ({ canUseUazapiActions: true }),
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
vi.mock("@/modules/communication/hooks/chat/useGroupParticipants", () => ({
  useGroupParticipants: (...args: unknown[]) => {
    participantsCalls.push(args);
    return { data: participants, isLoading: false };
  },
}));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

import { ChatComposer } from "@/modules/communication/components/chat/composer/ChatComposer";

const GROUP = {
  conversationKey: "inst-1:120363404701403742",
  phoneNumber: "120363404701403742",
  isGroup: true,
  contactName: "Grupo",
  instanceName: "inst1",
  instanceId: "inst-1",
  canReply: true,
};

const box = () => screen.getByLabelText(/Digite uma mensagem para/) as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(box(), { target: { value: v, selectionStart: v.length } });

describe("ChatComposer — menção em grupo", () => {
  beforeEach(() => {
    mockSendMutateAsync.mockReset().mockResolvedValue({});
    participantsCalls.length = 0;
  });

  it("abre o seletor no @, Enter insere a menção sem enviar, Enter de novo envia", () => {
    render(<ChatComposer {...GROUP} />);
    type("oi @an");
    expect(screen.getByRole("listbox", { name: "Mencionar participante" })).toBeInTheDocument();
    expect(screen.queryByText("Só LID")).toBeNull();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(mockSendMutateAsync).not.toHaveBeenCalled();
    expect(box().value).toBe(`oi @${A} `);

    type(`oi @${A} tudo bem?`);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(mockSendMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      isGroup: true, message: `oi @${A} tudo bem?`,
    }));
  });

  it("Todos insere @todos", () => {
    render(<ChatComposer {...GROUP} />);
    type("@");
    fireEvent.click(screen.getByText("Todos"));
    expect(box().value).toBe("@todos ");
  });

  it("Esc fecha o seletor sem mexer no texto", () => {
    render(<ChatComposer {...GROUP} />);
    type("@an");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box().value).toBe("@an");
  });

  it("busca participantes só depois do primeiro @", () => {
    render(<ChatComposer {...GROUP} />);
    expect(participantsCalls.at(-1)).toEqual(["inst-1", "120363404701403742@g.us", false]);
    type("@");
    expect(participantsCalls.at(-1)).toEqual(["inst-1", "120363404701403742@g.us", true]);
  });

  it("troca de conversa sem remontar: grupo B só busca depois de um @ novo", () => {
    const { rerender } = render(<ChatComposer {...GROUP} />);
    type("@");
    expect(participantsCalls.at(-1)).toEqual(["inst-1", "120363404701403742@g.us", true]);
    const B = { ...GROUP, conversationKey: "inst-1:120363000000000001", phoneNumber: "120363000000000001" };
    rerender(<ChatComposer {...B} />);
    expect(participantsCalls.at(-1)).toEqual(["inst-1", "120363000000000001@g.us", false]);
    expect(screen.queryByRole("listbox")).toBeNull();
    type("oi @");
    expect(participantsCalls.at(-1)).toEqual(["inst-1", "120363000000000001@g.us", true]);
  });

  it("conversa 1:1 não tem seletor nem busca", () => {
    render(<ChatComposer {...GROUP} isGroup={false} phoneNumber="5548999990000" contactName="Maria" />);
    type("@an");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(participantsCalls.every((c) => c[2] === false)).toBe(true);
  });
});
