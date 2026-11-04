/**
 * "Agendar reunião" direto do chat — desktop (ChatComposer) e bandeja mobile
 * (MobileComposerContextual). Só existe com lead; abre CreateMeetingDialog
 * semeado com o lead e SEM funil (o chat não tem par funil/negócio).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const dialogSpy = vi.fn();

vi.mock("@/modules/engagement", () => ({
  CreateMeetingDialog: (props: Record<string, unknown>) => {
    dialogSpy(props);
    return props.open ? <div data-testid="meeting-dialog" /> : null;
  },
}));

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
import { MobileComposerContextual } from "./MobileComposerContextual";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const comLead = {
  push_name: "Fulano",
  lead_name: "Fulano da Silva",
  phone_number: "5511999990000",
  lead_id: "lead-1",
};
const semLead = { ...comLead, lead_id: null, lead_name: null };

const base = {
  conversationKey: "i1:5511999990000",
  phoneNumber: "5511999990000",
  contactName: "Fulano",
  instanceName: "inst",
  instanceId: "i1",
  canReply: true,
};

beforeEach(() => dialogSpy.mockClear());

describe("ChatComposer — Agendar reunião", () => {
  it("mostra o botão com lead e abre o diálogo semeado com o lead, sem funil", () => {
    render(wrap(<ChatComposer {...base} selectedContact={comLead} />));
    fireEvent.click(screen.getByRole("button", { name: "Agendar reunião" }));
    expect(screen.getByTestId("meeting-dialog")).toBeTruthy();
    const last = dialogSpy.mock.calls.at(-1)![0];
    expect(last).toMatchObject({
      open: true,
      initialLeadId: "lead-1",
      initialLeadName: "Fulano da Silva",
    });
    expect(last).not.toHaveProperty("initialPipelineId");
  });

  it("esconde o botão sem lead", () => {
    render(wrap(<ChatComposer {...base} selectedContact={semLead} />));
    expect(screen.queryByRole("button", { name: "Agendar reunião" })).toBeNull();
    expect(screen.getByRole("button", { name: "Agendar mensagem" })).toBeTruthy();
  });
});

describe("MobileComposerContextual — Reunião na bandeja", () => {
  const abrirBandeja = () => {
    const plus = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-plus"));
    fireEvent.click(plus!);
  };

  it("com lead: item Reunião abre o diálogo com o lead, sem funil", () => {
    render(wrap(<MobileComposerContextual {...base} selectedContact={comLead} />));
    abrirBandeja();
    fireEvent.click(screen.getByRole("button", { name: "Reunião" }));
    expect(screen.getByTestId("meeting-dialog")).toBeTruthy();
    const last = dialogSpy.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ open: true, initialLeadId: "lead-1", initialLeadName: "Fulano da Silva" });
    expect(last).not.toHaveProperty("initialPipelineId");
  });

  it("sem lead: bandeja não tem Reunião", () => {
    render(wrap(<MobileComposerContextual {...base} selectedContact={semLead} />));
    abrirBandeja();
    expect(screen.getByRole("button", { name: "Agendar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reunião" })).toBeNull();
  });
});
