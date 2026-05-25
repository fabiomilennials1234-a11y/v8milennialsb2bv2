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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = (supabase as any)
        .from("meta_conversations")
        .select("*, lead:leads(id, name, phone)")
        .eq("organization_id", organizationId)
        .eq("meta_page_id", pageId)
        .eq("channel", channel);

      if (tab === "active") {
        query = query.is("archived_at", null);
      } else {
        query = query.not("archived_at", "is", null);
      }

      const { data, error } = await query.order("last_message_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MetaConversationWithLead[];
    },
    enabled: !!organizationId && !!pageId && !!channel,
  });
}
