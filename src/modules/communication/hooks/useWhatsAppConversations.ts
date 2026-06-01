import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { normalizePhone } from "@/lib/normalizePhone";
import type { Tag } from "@/modules/leads/hooks/useTags";

// ============================================
// Types
// ============================================

export interface ConversationMeta {
  id: string;
  instance_id: string;
  phone_number: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface ConversationTagLink {
  id: string;
  conversation_id: string;
  tag_id: string;
  tag: Tag;
}

// ============================================
// Query: metadados de conversas por instância
// ============================================

export function useWhatsAppConversationsMeta(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_conversations", organizationId, instanceId],
    queryFn: async () => {
      if (!organizationId || !instanceId) return new Map<string, ConversationMeta>();

      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("id, instance_id, phone_number, archived_at, deleted_at")
        .eq("organization_id", organizationId)
        .eq("instance_id", instanceId);

      if (error) throw error;

      const map = new Map<string, ConversationMeta>();
      for (const row of data || []) {
        // Index by normalized phone so format differences don't break lookup
        const key = normalizePhone(row.phone_number) || row.phone_number;
        map.set(key, row as ConversationMeta);
      }
      return map;
    },
    enabled: !!organizationId && !!instanceId,
  });
}

// ============================================
// Query: tags de conversas por instância
// ============================================

export function useWhatsAppConversationTags(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_conversation_tags", organizationId, instanceId],
    queryFn: async () => {
      if (!organizationId || !instanceId) return new Map<string, Tag[]>();

      // Buscar conversation_tags com JOIN na tag e conversa
      const { data, error } = await supabase
        .from("whatsapp_conversation_tags")
        .select(`
          id,
          conversation_id,
          tag_id,
          whatsapp_conversations!inner(phone_number, instance_id),
          tags!inner(id, name, color)
        `)
        .eq("whatsapp_conversations.instance_id", instanceId);

      if (error) throw error;

      // Agrupar tags por phone normalizado
      const map = new Map<string, Tag[]>();
      for (const row of data || []) {
        const conv = row.whatsapp_conversations as unknown as { phone_number: string };
        const tag = row.tags as unknown as Tag;
        const phone = normalizePhone(conv.phone_number) || conv.phone_number;
        const existing = map.get(phone) || [];
        existing.push(tag);
        map.set(phone, existing);
      }
      return map;
    },
    enabled: !!organizationId && !!instanceId,
  });
}

// ============================================
// Mutation: arquivar conversa
// ============================================

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      instanceId,
      phoneNumber,
    }: {
      instanceId: string;
      phoneNumber: string;
    }) => {
      const organizationId = teamMember?.organization_id;
      if (!organizationId) throw new Error("Sem organização");

      // UPSERT: cria registro se não existe, seta archived_at
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .upsert(
          {
            organization_id: organizationId,
            instance_id: instanceId,
            phone_number: phoneNumber,
            archived_at: new Date().toISOString(),
          },
          { onConflict: "instance_id,phone_number" }
        )
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_conversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    },
  });
}

// ============================================
// Mutation: desarquivar conversa
// ============================================

export function useUnarchiveConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string }) => {
      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({ archived_at: null })
        .eq("id", conversationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_conversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    },
  });
}

// ============================================
// Mutation: excluir conversa (soft delete via RPC, admin only)
// ============================================

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      instanceId,
      phoneNumber,
      organizationId,
    }: {
      instanceId: string;
      phoneNumber: string;
      organizationId: string;
    }) => {
      const { data, error } = await supabase.rpc(
        "soft_delete_whatsapp_conversation",
        {
          p_instance_id: instanceId,
          p_phone_number: phoneNumber,
          p_organization_id: organizationId,
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_conversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    },
  });
}

// ============================================
// Mutation: adicionar tag a conversa
// ============================================

export function useAddConversationTag() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      instanceId,
      phoneNumber,
      tagId,
    }: {
      instanceId: string;
      phoneNumber: string;
      tagId: string;
    }) => {
      const organizationId = teamMember?.organization_id;
      if (!organizationId) throw new Error("Sem organização");

      // Garantir que o registro de conversa existe (UPSERT)
      const { data: conv, error: convError } = await supabase
        .from("whatsapp_conversations")
        .upsert(
          {
            organization_id: organizationId,
            instance_id: instanceId,
            phone_number: phoneNumber,
          },
          { onConflict: "instance_id,phone_number" }
        )
        .select("id")
        .single();

      if (convError) throw convError;

      // Inserir tag
      const { error } = await supabase
        .from("whatsapp_conversation_tags")
        .insert({
          conversation_id: conv.id,
          tag_id: tagId,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_conversation_tags"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    },
  });
}

// ============================================
// Mutation: remover tag de conversa
// ============================================

export function useRemoveConversationTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      tagId,
    }: {
      conversationId: string;
      tagId: string;
    }) => {
      const { error } = await supabase
        .from("whatsapp_conversation_tags")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("tag_id", tagId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_conversation_tags"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    },
  });
}
