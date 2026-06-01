import type { Meta, StoryObj } from "@storybook/react";
import { MessageBubble } from "./MessagePrimitives";
import { ConversationListItem } from "./list/ConversationListItem";
import { mockContact, mockContactUnread, mockContactArchived } from "@/mocks/chat-fixtures";
import type { WhatsAppMessage } from "../../hooks/useWhatsAppChat";

// Fábrica de mensagens fake (sem rede/Supabase) — só para preview visual.
let seq = 0;
function msg(p: Record<string, unknown>): WhatsAppMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    message_id: `wamid-${seq}`,
    instance_id: "inst-001",
    message_type: "text",
    media_url: null,
    status: "read",
    timestamp: new Date(Date.now() - (12 - seq) * 60 * 1000).toISOString(),
    remote_jid: "5511999991001@s.whatsapp.net",
    ...p,
  } as unknown as WhatsAppMessage;
}

function Thread() {
  return (
    <div className="mx-auto max-w-md p-4 space-y-1 bg-background rounded-xl border border-border/60">
      <MessageBubble message={msg({ direction: "incoming", content: "Oi Gabriel! Vi a apresentação ontem, adorei." })} onImagePreview={() => {}} />
      <MessageBubble message={msg({ direction: "outgoing", content: "Que bom, Marina! Posso te mandar a proposta personalizada agora?", status: "read" })} onImagePreview={() => {}} />
      <MessageBubble message={msg({ direction: "incoming", content: "Sim, pode mandar. Vou analisar com o time hoje." })} onImagePreview={() => {}} />
      <MessageBubble message={msg({ direction: "outgoing", content: "Perfeito, enviado! Qualquer dúvida estou por aqui. 🙌", status: "delivered" })} onImagePreview={() => {}} />
      <MessageBubble message={msg({ direction: "outgoing", content: "Olá! Sou o assistente e já adianto seu atendimento.", sent_source: "copilot" })} onImagePreview={() => {}} />
      <MessageBubble message={msg({ direction: "outgoing", content: "Disparo automático do funil de boas-vindas.", sent_source: "workflow" })} onImagePreview={() => {}} />
    </div>
  );
}

const meta: Meta<typeof MessageBubble> = {
  title: "Chat/Redesign Preview",
  component: MessageBubble,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Bolhas: cliente (translúcida), você (gradiente laranja), copilot, automação. */
export const Bolhas: Story = {
  render: () => (
    <div className="p-6">
      <Thread />
    </div>
  ),
};

const listActions = {
  onSelect: () => {},
  onArchive: () => {},
  onUnarchive: () => {},
  onDelete: () => {},
  onAddTag: () => {},
  onRemoveTag: () => {},
};

const listShared = {
  ...listActions,
  activeTab: "active" as const,
  isAdmin: false,
  instanceId: "inst-001",
  organizationId: "org-001",
  allTags: [
    { id: "tag-001", name: "Ouro", color: "#facc15" },
    { id: "tag-002", name: "Prata", color: "#94a3b8" },
  ],
};

/** Preview do chat: lista (avatares gradiente, ativo/não-lido laranja) + thread de bolhas. */
export const ChatCompleto: Story = {
  render: () => (
    <div className="flex h-[560px] w-full overflow-hidden">
      <div className="w-[320px] shrink-0 border-r border-border/60 bg-muted/20 divide-y divide-border/60 overflow-y-auto">
        <ConversationListItem {...listShared} contact={mockContact} isSelected />
        <ConversationListItem {...listShared} contact={mockContactUnread} isSelected={false} />
        <ConversationListItem {...listShared} contact={mockContactArchived} isSelected={false} />
        <ConversationListItem
          {...listShared}
          contact={{ ...mockContact, phone_number: "+5511999991004", push_name: "Felipe Souza", lead_name: "Felipe Souza", lead_id: "lead-004", unread_count: 0, last_message: "Vou avaliar e te retorno", tags: [] }}
          isSelected={false}
        />
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto bg-card/30">
        <Thread />
      </div>
    </div>
  ),
};
