import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
export interface ConversationNote {
  id: string;
  organization_id: string;
  lead_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function useConversationNotes(leadId: string | undefined | null) {
  return useQuery({
    queryKey: ["conversation-notes", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("conversation_notes")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as ConversationNote[];
    },
    enabled: !!leadId,
  });
}

export function useCreateConversationNote() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { leadId: string; content: string }) => {
      if (!organizationId || !user?.id)
        throw new Error("Sem organização ou usuário");

      const { data, error } = await supabase
        .from("conversation_notes")
        .insert({
          organization_id: organizationId,
          lead_id: input.leadId,
          author_id: user.id,
          content: input.content.trim(),
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ConversationNote;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-notes", variables.leadId],
      });
    },
  });
}

export function useUpdateConversationNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      leadId: string;
      content: string;
    }) => {
      const { data, error } = await supabase
        .from("conversation_notes")
        .update({ content: input.content.trim() } as any)
        .eq("id", input.id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ConversationNote;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-notes", variables.leadId],
      });
    },
  });
}

export function useDeleteConversationNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; leadId: string }) => {
      const { error } = await supabase
        .from("conversation_notes")
        .delete()
        .eq("id", input.id);

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-notes", variables.leadId],
      });
    },
  });
}
