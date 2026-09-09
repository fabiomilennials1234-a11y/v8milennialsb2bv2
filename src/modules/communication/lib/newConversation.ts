import { buildWhatsAppConversationKey, contactKey, type ChatContact, type InboxBox } from "../hooks/chat/types";
import { boxUsesChannelMessages } from "../hooks/chat/inbox-box-source";
import { formatPhoneForWhatsApp } from "./whatsappPhone";

export function hasEstablishedOutgoing(messages: readonly { direction: string; status: string }[]) {
  return messages.some((message) => message.direction === "outgoing" && ["sent", "delivered", "read"].includes(message.status));
}

export function newConversationUnavailableReason(box: InboxBox | null): string | undefined {
  if (!box || box.kind !== "whatsapp" || boxUsesChannelMessages(box)) {
    return "Selecione uma caixa de WhatsApp no seletor de caixas para iniciar a conversa.";
  }
  if (box.status !== "connected") return "Conecte esta caixa de WhatsApp antes de iniciar a conversa.";
}

/** Opening a draft is local only; the first normal send persists the conversation. */
export function prepareNewConversation(phone: string, box: InboxBox | null, contacts: readonly ChatContact[]) {
  if (!box || newConversationUnavailableReason(box)) return null;
  const formatted = /^[+\d\s().-]+$/.test(phone) ? formatPhoneForWhatsApp(phone) : null;
  if (!formatted) return null;
  const existing = contacts.find((contact) => contact.instance_id === box.id
    && !contact.is_group && formatPhoneForWhatsApp(contact.phone_number) === formatted);
  return {
    key: existing ? contactKey(existing) : buildWhatsAppConversationKey(box.id, formatted),
    isNew: !existing,
  };
}
