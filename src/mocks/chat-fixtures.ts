/**
 * chat-fixtures — dados estáticos para stories e testes.
 * Nenhuma chamada a Supabase ou rede aqui.
 */

import type {
  ChatContact,
  SocialContact,
} from "@/modules/communication/hooks/chat/types";
import type { AiTakeoverState } from "@/modules/communication/lib/chat-types";

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const mockContact: ChatContact = {
  channel: "whatsapp",
  instance_id: "instance-uuid-001",
  phone_number: "+5511999991001",
  push_name: "João Silva",
  lead_name: "João Silva",
  lead_id: "lead-uuid-001",
  last_message: "Olá, vi o anúncio e gostaria de mais informações",
  last_message_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  last_message_direction: "incoming",
  last_message_sent_source: null,
  unread_count: 2,
  archived_at: null,
  tags: [{ id: "tag-001", name: "Ouro", color: "#facc15" }],
  conversation_id: "conv-uuid-001",
  is_group: false,
};

export const mockContactUnread: ChatContact = {
  ...mockContact,
  phone_number: "+5511999991002",
  push_name: "Maria Oliveira",
  lead_name: "Maria Oliveira",
  lead_id: "lead-uuid-002",
  last_message: "Quando vocês podem me ligar?",
  last_message_time: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  unread_count: 5,
  conversation_id: "conv-uuid-002",
  tags: [],
};

export const mockContactArchived: ChatContact = {
  ...mockContact,
  phone_number: "+5511999991003",
  push_name: "Carlos Ferreira",
  lead_name: "Carlos Ferreira",
  lead_id: "lead-uuid-003",
  last_message: "Ok, obrigado",
  last_message_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  last_message_direction: "outgoing",
  unread_count: 0,
  archived_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  conversation_id: "conv-uuid-003",
  tags: [{ id: "tag-002", name: "Prata", color: "#94a3b8" }],
};

/**
 * Conversa de Instagram para as stories da lista.
 *
 * Sem telefone, sem lead e sem etiqueta — é assim que a linha nasce na fatia de
 * entrada, e a story precisa mostrar exatamente isso para que uma regressão de
 * layout (nome vazio, telefone renderizado em branco, ponto de "sem lead" aceso)
 * apareça no Storybook antes de aparecer em produção.
 */
export const mockSocialContact: SocialContact = {
  channel: "instagram",
  conversation_key: "instagram:ch-uuid-001:17841400000000001",
  messaging_channel_id: "ch-uuid-001",
  external_user_id: "17841400000000001",
  handle: null,
  display_name: "Ana Prado",
  avatar_url: null,
  last_message: "vi o reels de vocês, ainda tem pronta entrega?",
  last_message_time: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  last_message_direction: "incoming",
  unread_count: 1,
  lead_id: null,
  lead_name: null,
  tags: [],
};

// ─── AI States ────────────────────────────────────────────────────────────────

export const ALL_AI_STATES: AiTakeoverState[] = [
  "AI_ACTIVE",
  "AI_PAUSED_MANUAL",
  "WAITING_HUMAN",
  "HUMAN_ACTIVE",
  "HANDOFF_BACK",
];
