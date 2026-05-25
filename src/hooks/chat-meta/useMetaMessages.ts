// src/hooks/chat-meta/useMetaMessages.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { metaMessagesKey, type ChannelMessage } from "./types";

const PAGE_LIMIT = 200;

export function useMetaMessages(conversationId: string | null) {
  return useQuery<ChannelMessage[]>({
    queryKey: metaMessagesKey(conversationId),
    queryFn: async () => {
      if (!conversationId) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: conv, error: convErr } = await (supabase as any)
        .from("meta_conversations")
        .select("organization_id, meta_page_id, channel, external_user_id")
        .eq("id", conversationId)
        .single();
      if (convErr || !conv) throw convErr ?? new Error("conversation_not_found");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: page, error: pageErr } = await (supabase as any)
        .from("meta_pages")
        .select("page_id")
        .eq("id", conv.meta_page_id)
        .single();
      if (pageErr || !page) throw pageErr ?? new Error("page_not_found");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("channel_messages")
        .select("*")
        .eq("organization_id", conv.organization_id)
        .eq("channel", conv.channel)
        .eq("page_id", page.page_id)
        .eq("sender_id", conv.external_user_id)
        .order("timestamp", { ascending: true })
        .limit(PAGE_LIMIT);

      if (error) throw error;
      return (data ?? []) as ChannelMessage[];
    },
    enabled: !!conversationId,
  });
}
