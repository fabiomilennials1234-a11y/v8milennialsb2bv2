// src/hooks/chat-meta/useMetaConversations.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { metaConversationsKey, type MetaChannel, type MetaConversationWithLead } from "./types";

interface UseMetaConversationsParams {
  pageId: string | null;
  channel: MetaChannel | null;
  tab?: "active" | "archived";
}

export function useMetaConversations({ pageId, channel, tab = "active" }: UseMetaConversationsParams) {
  const { organizationId } = useOrganization();

  return useQuery<MetaConversationWithLead[]>({
    queryKey: metaConversationsKey(organizationId, pageId, channel, tab),
    queryFn: async () => {
      if (!organizationId || !pageId || !channel) return [];

      let query = supabase
        .from("meta_conversations")
        .select("*, lead:leads(id, name, phone)")
        .eq("organization_id", organizationId)
        .eq("meta_page_id", pageId)
        .eq("channel", channel);

      query = tab === "active"
        ? query.is("archived_at", null)
        : query.not("archived_at", "is", null);

      const { data, error } = await query.order("last_message_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MetaConversationWithLead[];
    },
    enabled: !!organizationId && !!pageId && !!channel,
  });
}
