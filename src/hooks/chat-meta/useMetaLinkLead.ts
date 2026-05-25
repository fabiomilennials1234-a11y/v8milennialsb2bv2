// src/hooks/chat-meta/useMetaLinkLead.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMetaLinkLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, leadId }: { conversationId: string; leadId: string }) => {
      const { error } = await supabase.rpc("link_meta_conversation_to_lead", {
        p_conversation_id: conversationId,
        p_lead_id: leadId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["meta_conversations"] });
      qc.invalidateQueries({ queryKey: ["meta_messages", vars.conversationId] });
    },
  });
}
