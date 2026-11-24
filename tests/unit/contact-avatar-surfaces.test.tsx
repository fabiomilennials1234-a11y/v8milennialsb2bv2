/**
 * Foto do contato nas superfícies do chat WhatsApp: lista (desktop e mobile),
 * cabeçalho (desktop e mobile) e painel de contexto.
 *
 * O hook `useContactAvatarUrl` é dublado (o lote/assinatura tem teste próprio
 * em contact-avatar-loader.test.ts). Aqui se prende: com URL a foto aparece
 * POR CIMA do gradiente; erro de carga some e o gradiente fica; grupo e canal
 * social não consultam (o hook recebe `null`).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const avatar = vi.hoisted(() => ({
  calls: [] as Array<string | null | undefined>,
  url: "https://proj.supabase.co/storage/v1/object/sign/contact-avatars/org/avatars/a.jpg?token=t" as string | null,
}));
vi.mock("@/modules/communication/hooks/chat/useContactAvatarUrl", () => ({
  useContactAvatarUrl: (phone: string | null | undefined) => {
    avatar.calls.push(phone);
    return phone ? avatar.url : null;
  },
}));
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: false }) }));
vi.mock("@/modules/identity", () => ({ useChatLeadCreation: () => ({ allowed: true, isLoading: false }) }));
vi.mock("@/modules/communication/hooks/useMessageLimits", () => ({ useMessageLimits: () => ({ data: null }) }));
vi.mock("@/modules/communication/components/chat/RealtimeStatusBadge", () => ({ RealtimeStatusBadge: () => null }));
vi.mock("@/modules/communication/components/chat/history-sync/SyncChatButton", () => ({ SyncChatDialog: () => null }));
vi.mock("@/modules/communication/components/voice/ChatCallButton", () => ({ ChatCallButton: () => null }));
// Painel de contexto: só o cabeçalho interessa; o resto vira nada.
vi.mock("@/modules/communication/hooks/useWhatsAppLeadIntegration", () => ({
  useLeadByPhone: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/modules/leads", () => ({
  useLeadById: () => ({ data: null, isLoading: false }),
  useLeadsDeals: () => ({ data: undefined }),
}));
vi.mock("@/modules/communication/components/chat/LeadContactModal", () => ({ LeadContactModal: () => null }));
vi.mock("@/modules/communication/components/chat/context-panel/ContextPanelTabInfo", () => ({ ContextPanelTabInfo: () => null }));
vi.mock("@/modules/communication/components/chat/context-panel/ContextPanelTabHistory", () => ({ ContextPanelTabHistory: () => null }));
vi.mock("@/modules/communication/components/chat/context-panel/ContextPanelTabAI", () => ({ ContextPanelTabAI: () => null }));
vi.mock("@/modules/communication/components/chat/context-panel/FalandoCom", () => ({ FalandoCom: () => null }));
vi.mock("@/modules/communication/components/chat/context-panel/CadastrosDoNumeroResumo", () => ({ CadastrosDoNumeroResumo: () => null }));
vi.mock("@/modules/communication/hooks/chat/useNomeCodContatoLead", () => ({
  useNomeCodContatoLead: () => false,
  useContatoDaConversa: () => ({ data: null }),
}));

import { ConversationListItem, type ConversationListItemProps } from "@/modules/communication/components/chat/list/ConversationListItem";
import { MobileConversationRow } from "@/modules/communication/components/chat/list/MobileConversationRow";
import { ChatHeader } from "@/modules/communication/components/chat/view/ChatHeader";
import { MobileChatThreadHeader } from "@/modules/communication/components/chat/view/MobileChatThreadHeader";
import { ContextPanel } from "@/modules/communication/components/chat/context-panel/ContextPanel";
import { ContactAvatarImage } from "@/modules/communication/components/chat/list/ContactAvatarImage";
import type { ChatContact } from "@/modules/communication/hooks/chat/types";

beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  avatar.calls = [];
  avatar.url = "https://proj.supabase.co/storage/v1/object/sign/contact-avatars/org/avatars/a.jpg?token=t";
});

const PHONE = "5548999000111";

function contact(over: Partial<ChatContact> = {}): ChatContact {
  return {
    channel: "whatsapp", instance_id: "inst-1", phone_number: PHONE, push_name: "Maria",
    last_message: "oi", last_message_time: "2026-07-23T00:00:00Z", last_message_direction: "incoming",
    last_message_sent_source: "manual", unread_count: 0, lead_id: "lead-1", lead_name: "Maria Silva",
    conversation_id: "conv-1", archived_at: null, tags: [], is_group: false, funnels: [], qualification_tier: null,
    ...over,
  };
}

function listProps(c: ChatContact): ConversationListItemProps {
  return {
    contact: c, isSelected: false, onSelect: vi.fn(), activeTab: "active", isAdmin: false,
    instanceId: "inst-1", organizationId: "org-1", allTags: [], onArchive: vi.fn(), onUnarchive: vi.fn(),
    onDelete: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(),
  };
}

const foto = (container: HTMLElement) =>
  container.querySelector<HTMLImageElement>('img[src*="contact-avatars"]');

describe("ContactAvatarImage", () => {
  it("lazy, async, sem referrer, invisível até carregar e some no erro", () => {
    const { container } = render(<div className="relative"><ContactAvatarImage url={avatar.url} /></div>);
    const img = foto(container)!;
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(img.className).toMatch(/absolute inset-0/);
    expect(img.className).toMatch(/opacity-0/);
    fireEvent.load(img);
    expect(img.className).toMatch(/opacity-100/);
    fireEvent.error(img);
    expect(foto(container)).toBeNull();
  });

  it("sem URL não desenha nada", () => {
    const { container } = render(<ContactAvatarImage url={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("lista de conversas (desktop)", () => {
  it("1:1 mostra a foto por cima do gradiente com a inicial", () => {
    const { container } = render(<ConversationListItem {...listProps(contact())} />);
    expect(avatar.calls).toContain(PHONE);
    const img = foto(container)!;
    expect(img).not.toBeNull();
    // o gradiente segue no DOM, embaixo: é o fallback
    expect(img.parentElement!.textContent).toContain("M");
  });

  it("foto que falha some e o gradiente fica", () => {
    const { container } = render(<ConversationListItem {...listProps(contact())} />);
    fireEvent.error(foto(container)!);
    expect(foto(container)).toBeNull();
    expect(screen.getAllByText("M").length).toBeGreaterThan(0);
  });

  it("grupo não consulta", () => {
    const { container } = render(<ConversationListItem {...listProps(contact({ is_group: true }))} />);
    expect(avatar.calls.every((p) => p == null)).toBe(true);
    expect(foto(container)).toBeNull();
  });

  it("sem foto no servidor: comportamento de sempre", () => {
    avatar.url = null;
    const { container } = render(<ConversationListItem {...listProps(contact())} />);
    expect(foto(container)).toBeNull();
  });
});

describe("lista de conversas (mobile)", () => {
  it("1:1 mostra a foto; grupo não consulta", () => {
    const { container, unmount } = render(<MobileConversationRow contact={contact()} isSelected={false} onPress={vi.fn()} />);
    expect(foto(container)).not.toBeNull();
    unmount();
    avatar.calls = [];
    const grupo = render(<MobileConversationRow contact={contact({ is_group: true })} isSelected={false} onPress={vi.fn()} />);
    expect(avatar.calls.every((p) => p == null)).toBe(true);
    expect(foto(grupo.container)).toBeNull();
  });
});

describe("cabeçalho da conversa", () => {
  const base: React.ComponentProps<typeof ChatHeader> = {
    phoneNumber: PHONE, contactName: "Maria", hasLead: true, leadId: "lead-1", instanceId: "inst-1",
    instanceName: "Comercial", szChatSession: null, organizationId: "org-1", onBack: vi.fn(),
    onOpenLeadModal: vi.fn(), onTransferToSzChatTeam: vi.fn(), transferPending: false,
    density: "comfortable", onDensityChange: vi.fn(),
  };
  const montar = (props: Partial<React.ComponentProps<typeof ChatHeader>> = {}) =>
    render(<TooltipProvider><ChatHeader {...base} {...props} /></TooltipProvider>);

  it("desktop: foto por cima do gradiente; grupo não consulta", () => {
    const { container, unmount } = montar();
    expect(foto(container)).not.toBeNull();
    unmount();
    avatar.calls = [];
    const grupo = montar({ isGroup: true });
    expect(avatar.calls.every((p) => p == null)).toBe(true);
    expect(foto(grupo.container)).toBeNull();
  });

  it("mobile: consulta pelo telefone; grupo passa null", () => {
    render(<MobileChatThreadHeader contactName="Maria" phoneNumber={PHONE} hasLead onBack={vi.fn()} />);
    expect(avatar.calls).toContain(PHONE);
    avatar.calls = [];
    render(<MobileChatThreadHeader isGroup contactName="Grupo" phoneNumber="120363000000000000" hasLead={false} onBack={vi.fn()} />);
    expect(avatar.calls.every((p) => p == null)).toBe(true);
  });
});

describe("painel de contexto", () => {
  it("consulta pelo telefone da conversa; grupo e Instagram (sem telefone) não", () => {
    const { unmount } = render(<TooltipProvider><ContextPanel phoneNumber={PHONE} pushName="Maria" /></TooltipProvider>);
    expect(avatar.calls).toContain(PHONE);
    unmount();
    avatar.calls = [];
    render(<TooltipProvider><ContextPanel phoneNumber={PHONE} ehGrupo /></TooltipProvider>);
    render(<TooltipProvider><ContextPanel leadId="lead-1" /></TooltipProvider>);
    expect(avatar.calls.every((p) => p == null)).toBe(true);
  });
});
