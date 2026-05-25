// src/hooks/chat-meta/useMetaConversationProfile.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMetaConversationProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).functions.invoke("meta-conversation-profile", {
        body: { conversationId },
      });
      if (error) throw error;
      return data as { external_username: string | null; profile_pic_url: string | null; cached: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meta_conversations"] });
    },
  });
}
