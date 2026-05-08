import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface RecentItem {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  viewed_at: string;
}

export function useRecentItems(limit = 10, entityType?: string) {
  const { user } = useAuth();

  return useQuery<RecentItem[]>({
    queryKey: ["recent-items", user?.id, limit, entityType],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_recent_items", {
        p_limit: limit,
        p_entity_type: entityType ?? null,
      });
      if (error) throw error;
      return (data ?? []) as RecentItem[];
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}
