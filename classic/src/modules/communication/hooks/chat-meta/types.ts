// src/hooks/chat-meta/types.ts
//
// Shared types + query-key helpers for the Meta Chat (Messenger/Instagram)
// hooks.

import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type MetaChannel = "messenger" | "instagram";

export type MetaPage = Tables<"meta_pages">;
export type MetaConversation = Tables<"meta_conversations">;
export type MetaConversationInsert = TablesInsert<"meta_conversations">;
export type MetaConversationUpdate = TablesUpdate<"meta_conversations">;
export type ChannelMessage = Tables<"channel_messages">;

export interface MetaConversationWithLead extends MetaConversation {
  lead?: { id: string; name: string | null; phone: string | null } | null;
}

export interface SendMetaMessageInput {
  conversationId: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "file";
}

export interface MetaPagesByChannel {
  messenger: MetaPage[];
  instagram: MetaPage[];
}

export function isWithin24hWindow(lastInboundAt: string | null | undefined): boolean {
  if (!lastInboundAt) return false;
  const elapsed = Date.now() - new Date(lastInboundAt).getTime();
  return elapsed < 24 * 60 * 60 * 1000;
}

export function metaConversationsKey(
  orgId: string | null | undefined,
  pageId: string | null,
  channel: MetaChannel | null,
  tab: "active" | "archived" = "active",
) {
  return ["meta_conversations", orgId ?? null, pageId, channel, tab] as const;
}

export function metaMessagesKey(conversationId: string | null) {
  return ["meta_messages", conversationId] as const;
}

export function metaPagesKey(orgId: string | null | undefined) {
  return ["meta_pages_for_chat", orgId ?? null] as const;
}
