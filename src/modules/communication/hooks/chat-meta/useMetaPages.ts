// src/hooks/chat-meta/useMetaPages.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { MetaPage, MetaPagesByChannel } from "./types";
import { metaPagesKey } from "./types";

interface UseMetaPagesResult {
  pages: MetaPage[];
  byChannel: MetaPagesByChannel;
}

export function useMetaPages() {
  const { organizationId } = useOrganization();

  return useQuery<UseMetaPagesResult>({
    queryKey: metaPagesKey(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meta_pages")
        .select("id,meta_connection_id,organization_id,page_id,page_name,instagram_account_id,instagram_username,is_active,webhook_subscribed,created_at,updated_at")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .eq("webhook_subscribed", true)
        .order("page_name", { ascending: true });

      if (error) throw error;

      const pages = (data ?? []) as MetaPage[];
      const byChannel: MetaPagesByChannel = {
        messenger: pages,
        instagram: pages.filter((p) => p.instagram_account_id),
      };

      return { pages, byChannel };
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
