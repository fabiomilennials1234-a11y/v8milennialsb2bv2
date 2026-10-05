import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { runConversationBatch, type BatchContact, type ConversationBatchAction } from "../../lib/conversationBatch";

export function useConversationBatch(organizationId: string, isAdmin: boolean) {
  const queryClient = useQueryClient();
  const { data: member } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async ({ action, contacts }: { action: ConversationBatchAction; contacts: BatchContact[] }) => {
      if (member?.organization_id !== organizationId) throw new Error("A organização mudou. Selecione as conversas novamente.");
      return runConversationBatch(organizationId, action, contacts, isAdmin, async contact => {
        if (action === "delete") {
          const { data, error } = await supabase.rpc("soft_delete_whatsapp_conversation", {
            p_organization_id: organizationId,
            p_instance_id: contact.instance_id,
            p_phone_number: contact.phone_number,
          });
          if (error) throw error;
          if (!data) throw new Error("Conversa não excluída");
        } else if (action === "unarchive") {
          if (!contact.conversation_id) throw new Error("Conversa arquivada não encontrada");
          const { error } = await supabase.from("whatsapp_conversations")
            .update({ archived_at: null })
            .eq("organization_id", organizationId)
            .eq("instance_id", contact.instance_id)
            .eq("id", contact.conversation_id)
            .is("deleted_at", null)
            .select("id").single();
          if (error) throw error;
        } else {
          const { error } = await supabase.from("whatsapp_conversations").upsert({
            organization_id: organizationId,
            instance_id: contact.instance_id,
            phone_number: contact.phone_number,
            archived_at: new Date().toISOString(),
          }, { onConflict: "instance_id,phone_number" }).select("id").single();
          if (error) throw error;
        }
      });
    },
    // One refresh per batch, scoped to its original org, including partial failures.
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["whatsapp_conversations", organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts", organizationId] }),
    ]).then(() => undefined),
  });
}
