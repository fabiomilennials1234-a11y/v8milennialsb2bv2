// src/hooks/chat-meta/useMetaConversationProfile.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMetaConversationProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await supabase.functions.invoke("meta-conversation-profile", {
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
