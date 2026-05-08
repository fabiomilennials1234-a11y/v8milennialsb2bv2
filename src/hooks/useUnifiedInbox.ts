import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type InboxChannel = "whatsapp" | "email" | "sms" | "instagram" | "messenger";

export interface UnifiedConversation {
  lead_id: string;
  lead_name: string;
  lead_phone: string | null;
  lead_email: string | null;
  channel: InboxChannel;
  last_message: string | null;
  last_direction: string;
  last_sender: string | null;
  last_sent_at: string;
  unread_count: number;
}

export function useUnifiedConversations(channel?: InboxChannel | null, limit = 50) {
  const { user } = useAuth();

  return useQuery<UnifiedConversation[]>({
    queryKey: ["unified-conversations", user?.id, channel, limit],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_unified_conversations", {
        p_channel: channel ?? null,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as UnifiedConversation[];
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });
}
