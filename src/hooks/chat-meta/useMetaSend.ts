// src/hooks/chat-meta/useMetaSend.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SendMetaMessageInput } from "./types";
import { metaMessagesKey } from "./types";

export function useMetaSend() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: SendMetaMessageInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: conv, error: convErr } = await (supabase as any)
        .from("meta_conversations")
        .select("organization_id, channel, external_user_id, meta_page_id")
        .eq("id", input.conversationId)
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
      const { data, error } = await (supabase as any).functions.invoke("send-meta-message", {
        body: {
          recipientId: conv.external_user_id,
          channel: conv.channel,
          message: input.text,
          pageId: page.page_id,
          mediaUrl: input.mediaUrl,
          mediaType: input.mediaType,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: metaMessagesKey(vars.conversationId) });
      qc.invalidateQueries({ queryKey: ["meta_conversations"] });
    },
  });
}
