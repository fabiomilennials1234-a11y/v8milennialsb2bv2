// src/hooks/chat-meta/useMetaLinkLead.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMetaLinkLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, leadId }: { conversationId: string; leadId: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("link_meta_conversation_to_lead", {
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
