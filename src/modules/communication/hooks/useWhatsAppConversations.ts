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
// Query: conversas excluídas (para restaurar)
// ============================================

export interface DeletedConversation {
  id: string;
  phone_number: string;
  deleted_at: string;
  /** Quantas mensagens a conversa tem hoje — o que volta a ficar visível. */
  message_count: number;
}

/**
 * Lista as conversas EXCLUÍDAS da instância.
 *
 * Não dá pra reaproveitar `get_whatsapp_conversation_list`: aquela RPC termina
 * com `WHERE conv.deleted_at IS NULL`, que é justamente o que esconde estas.
 * Aqui a leitura é direta na tabela — a policy de SELECT já escopa por org.
 *
 * A contagem de mensagens vem de `whatsapp_messages` porque é ela que responde
 * a pergunta que o admin faz na hora de decidir ("tem conversa aqui dentro ou
 * era lixo?"). Medido em prod: 5 conversas excluídas de uma org guardavam 709
 * mensagens, e a maior tinha 504 recebidas DEPOIS da exclusão.
 */
export function useDeletedConversations(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_conversations", "deleted", organizationId, instanceId],
    queryFn: async (): Promise<DeletedConversation[]> => {
      if (!organizationId || !instanceId) return [];

      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("id, phone_number, deleted_at")
        .eq("organization_id", organizationId)
        .eq("instance_id", instanceId)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        phone_number: string;
        deleted_at: string;
      }>;
      if (rows.length === 0) return [];

      // Uma contagem por conversa, com `head: true` — NÃO trazer as linhas e
      // contar no cliente. Um `.select()` de linhas seria cortado em 1000 pelo
      // `max_rows` do PostgREST e devolveria contagem errada justamente nas
      // conversas maiores, que são as que importam aqui (a maior medida em prod
      // tinha 529 mensagens, mas há threads de 17 mil na base).
      // N round-trips é aceitável: conversa excluída é rara — 12 em TODA a base
      // em 2026-08-06 — e a lista já está limitada a 200.
      const counted = await Promise.all(
        rows.map(async (r) => {
          const phone = normalizePhone(r.phone_number) || r.phone_number;
          const { count, error: countErr } = await supabase
            .from("whatsapp_messages")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("instance_id", instanceId)
            .eq("normalized_phone", phone);

          // A contagem é informativa: se falhar, a tela ainda serve pra restaurar.
          return { ...r, message_count: countErr ? 0 : (count ?? 0) };
        }),
      );

      return counted;
    },
    enabled: !!organizationId && !!instanceId,
  });
}

// ============================================
// Mutation: restaurar conversa excluída (RPC, admin only)
// ============================================

/**
 * Desfaz a exclusão. Vai por RPC, e não por `.update({ deleted_at: null })`,
 * porque a policy de UPDATE da tabela autoriza qualquer MEMBRO a escrever em
 * qualquer coluna — restaurar sairia mais barato que excluir, que é gated por
 * `is_user_admin()`. O portão tem que ser o mesmo dos dois lados, e no servidor.
 */
export function useRestoreConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string }) => {
      // `as never`: `types.ts` é gerado do schema de prod e a migration
      // 20270806000000 ainda não foi aplicada lá, então a função não existe no
      // tipo. Mesmo padrão de `useDashboardMetrics.ts:96`. Ao regerar os tipos
      // depois do apply, o cast pode cair.
      const { data, error } = await supabase.rpc("restore_whatsapp_conversation" as never, {
        p_conversation_id: conversationId,
      } as never);

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
