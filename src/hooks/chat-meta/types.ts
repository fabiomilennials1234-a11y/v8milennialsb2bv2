// src/hooks/chat-meta/types.ts
//
// Shared types + query-key helpers for the Meta Chat (Messenger/Instagram)
// hooks. `MetaConversationsRow` is exported as a plain interface from
// src/integrations/supabase/types.ts (manual augmentation — see the
// "Meta Chat FASE 0" block at the bottom of that file). The standard
// `Tables<"meta_conversations">` form will only work after the migrations
// land on dev and types regen runs. `meta_pages` and `channel_messages`
// are already in the generated Database type and use the generic form.

import type { Tables } from "@/integrations/supabase/types";
import type {
  MetaConversationsRow,
  MetaConversationsInsert,
  MetaConversationsUpdate,
} from "@/integrations/supabase/types";

export type MetaChannel = "messenger" | "instagram";

export type MetaPage = Tables<"meta_pages">;
export type MetaConversation = MetaConversationsRow;
export type ChannelMessage = Tables<"channel_messages">;

export type {
  MetaConversationsRow,
  MetaConversationsInsert,
  MetaConversationsUpdate,
};

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
