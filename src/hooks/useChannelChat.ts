/**
 * Hook multi-canal para chat unificado (WhatsApp + Instagram + Messenger)
 * Substitui useWhatsAppChat.ts com suporte a channel_messages
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, isVirtualTeamMember } from "@/hooks/useTeamMembers";
import { formatPhoneForWhatsApp } from "@/lib/whatsapp";
import type { ChannelType } from "@/components/chat/ChannelBadge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelMessage {
  id: string;
  organization_id: string;
  channel: ChannelType;
  instance_id: string | null;
  page_id: string | null;
  external_id: string;
  remote_jid: string | null;
  phone_number: string | null;
  sender_id: string | null;
  sender_name: string | null;
  sender_profile_pic: string | null;
  direction: "incoming" | "outgoing";
  message_type: string;
  content: string | null;
  media_url: string | null;
  status: string;
  lead_id: string | null;
  timestamp: string;
  created_at: string;
}

export interface ChatContactTag {
  id: string;
  name: string;
  color: string;
}

export interface ChannelContact {
  /** Identificador unico do contato: phone_number (WhatsApp) ou sender_id (Meta) */
  contact_id: string;
  phone_number: string | null;
  sender_id: string | null;
  channel: ChannelType;
  display_name: string | null;
  profile_pic: string | null;
  last_message: string | null;
  last_message_time: string;
  last_message_direction: "incoming" | "outgoing" | null;
  unread_count: number;
  lead_id: string | null;
  lead_name: string | null;
  /** ID do registro em whatsapp_conversations (null para Meta ou se nunca teve acao) */
  conversation_id: string | null;
  archived_at: string | null;
  tags: ChatContactTag[];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista contatos/conversas de todos os canais (unificado)
 * Para WhatsApp: filtra por instanceId
 * Para Meta: mostra todos os contatos de paginas ativas
 */
export function useChannelContacts(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["channel_contacts", organizationId, instanceId],
    queryFn: async () => {
      if (!organizationId) return [];

      // Buscar mensagens agrupadas por contato
      let query = supabase
        .from("channel_messages")
        .select(`
          phone_number,
          sender_id,
          sender_name,
          sender_profile_pic,
          channel,
          content,
          timestamp,
          direction,
          lead_id,
          leads(name)
        `)
        .eq("organization_id", organizationId)
        .order("timestamp", { ascending: false });

      // Para WhatsApp: filtrar por instance_id
      // Para Meta: mostrar todos (sem filtro de instance)
      if (instanceId) {
        // Mostrar WhatsApp dessa instancia + todos os Meta
        query = query.or(`instance_id.eq.${instanceId},channel.neq.whatsapp`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const normalizePhone = (p: string) => p.replace(/\D/g, "").slice(-10) || p;

      // Agrupar por contact_key (phone+channel para WhatsApp, sender_id+channel para Meta)
      const contactsMap = new Map<string, ChannelContact>();

      for (const msg of data || []) {
        const channel = msg.channel as ChannelType;
        let contactKey: string;
        let contactId: string;

        if (channel === "whatsapp") {
          const normalized = normalizePhone(msg.phone_number || "");
          contactKey = `whatsapp:${normalized}`;
          contactId = msg.phone_number || "";
        } else {
          contactKey = `${channel}:${msg.sender_id || msg.phone_number}`;
          contactId = msg.sender_id || msg.phone_number || "";
        }

        const leadName = (msg.leads as { name?: string } | null)?.name ?? null;
        const existing = contactsMap.get(contactKey);

        if (!existing) {
          contactsMap.set(contactKey, {
            contact_id: contactId,
            phone_number: msg.phone_number,
            sender_id: msg.sender_id,
            channel,
            display_name: msg.sender_name || leadName,
            profile_pic: msg.sender_profile_pic,
            last_message: msg.content,
            last_message_time: msg.timestamp,
            last_message_direction: msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : null,
            unread_count: 0,
            lead_id: msg.lead_id,
            lead_name: leadName,
            conversation_id: null,
            archived_at: null,
            tags: [],
          });
        } else {
          if (new Date(msg.timestamp) > new Date(existing.last_message_time)) {
            existing.last_message = msg.content;
            existing.last_message_time = msg.timestamp;
            existing.last_message_direction = msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : existing.last_message_direction;
          }
          if (msg.lead_id || leadName) {
            existing.lead_id = existing.lead_id || msg.lead_id;
            existing.lead_name = existing.lead_name || leadName;
          }
          if (msg.direction === "incoming" && msg.sender_name) {
            existing.display_name = existing.display_name || msg.sender_name;
          }
        }
      }

      // Contagem de nao lidos
      const LAST_SEEN_KEY = "channel_last_seen_";
      const lastSeenMap: Record<string, string> = {};
      if (typeof localStorage !== "undefined") {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(LAST_SEEN_KEY)) {
            lastSeenMap[k.slice(LAST_SEEN_KEY.length)] = localStorage.getItem(k) || "";
          }
        }
      }

      let incomingQuery = supabase
        .from("channel_messages")
        .select("phone_number, sender_id, channel, timestamp")
        .eq("organization_id", organizationId)
        .eq("direction", "incoming")
        .order("timestamp", { ascending: false });

      if (instanceId) {
        incomingQuery = incomingQuery.or(`instance_id.eq.${instanceId},channel.neq.whatsapp`);
      }

      const { data: incomingData } = await incomingQuery;

      const unreadByKey: Record<string, number> = {};
      for (const m of incomingData || []) {
        const ch = m.channel as ChannelType;
        let key: string;
        if (ch === "whatsapp") {
          key = `whatsapp:${normalizePhone(m.phone_number || "")}`;
        } else {
          key = `${ch}:${m.sender_id || m.phone_number}`;
        }
        const lastSeen = lastSeenMap[key] ? new Date(lastSeenMap[key]).getTime() : 0;
        if (new Date(m.timestamp).getTime() > lastSeen) {
          unreadByKey[key] = (unreadByKey[key] ?? 0) + 1;
        }
      }

      for (const [key, contact] of contactsMap.entries()) {
        contact.unread_count = unreadByKey[key] ?? 0;
      }

      // WhatsApp conversations metadata (archive, delete, tags)
      if (instanceId) {
        const [{ data: convMeta }, { data: convTagsData }] = await Promise.all([
          supabase
            .from("whatsapp_conversations")
            .select("id, phone_number, archived_at, deleted_at")
            .eq("organization_id", organizationId)
            .eq("instance_id", instanceId),
          supabase
            .from("whatsapp_conversation_tags")
            .select("conversation_id, tags!inner(id, name, color)"),
        ]);

        const convMetaMap = new Map<string, { id: string; archived_at: string | null; deleted_at: string | null }>();
        for (const row of convMeta || []) {
          convMetaMap.set(row.phone_number, row);
        }

        const convTagsByConvId = new Map<string, ChatContactTag[]>();
        for (const row of convTagsData || []) {
          const tag = row.tags as unknown as ChatContactTag;
          const existing = convTagsByConvId.get(row.conversation_id) || [];
          existing.push(tag);
          convTagsByConvId.set(row.conversation_id, existing);
        }

        // Lead tags
        const leadIds = Array.from(contactsMap.values())
          .map((c) => c.lead_id)
          .filter((id): id is string => !!id);

        const leadTagsMap = new Map<string, ChatContactTag[]>();
        if (leadIds.length > 0) {
          const { data: leadTagsData } = await supabase
            .from("lead_tags")
            .select("lead_id, tags!inner(id, name, color)")
            .in("lead_id", leadIds);

          for (const row of leadTagsData || []) {
            const tag = (row as unknown as { tags: ChatContactTag }).tags;
            const existing = leadTagsMap.get(row.lead_id) || [];
            existing.push(tag);
            leadTagsMap.set(row.lead_id, existing);
          }
        }

        // Enriquecer contatos WhatsApp com metadata
        for (const [key, contact] of contactsMap.entries()) {
          if (contact.channel !== "whatsapp") continue;

          const meta = convMetaMap.get(contact.phone_number || "");
          if (meta?.deleted_at) {
            contactsMap.delete(key);
            continue;
          }

          contact.conversation_id = meta?.id ?? null;
          contact.archived_at = meta?.archived_at ?? null;

          const tagIds = new Set<string>();
          const mergedTags: ChatContactTag[] = [];

          if (contact.lead_id) {
            for (const tag of leadTagsMap.get(contact.lead_id) || []) {
              if (!tagIds.has(tag.id)) { tagIds.add(tag.id); mergedTags.push(tag); }
            }
          }
          if (meta?.id) {
            for (const tag of convTagsByConvId.get(meta.id) || []) {
              if (!tagIds.has(tag.id)) { tagIds.add(tag.id); mergedTags.push(tag); }
            }
          }
          contact.tags = mergedTags;
        }
      }

      return Array.from(contactsMap.values());
    },
    enabled: !!organizationId,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Mensagens de um contato especifico em um canal
 */
export function useChannelMessages(
  contactId: string | null,
  channel: ChannelType | null,
  instanceId: string | null
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["channel_messages", organizationId, contactId, channel, instanceId],
    queryFn: async () => {
      if (!organizationId || !contactId || !channel) return [];

      let query = supabase
        .from("channel_messages")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("channel", channel)
        .order("timestamp", { ascending: true });

      if (channel === "whatsapp") {
        query = query.eq("phone_number", contactId);
        if (instanceId) query = query.eq("instance_id", instanceId);
      } else {
        // Meta: filtrar por sender_id (contatos incoming) ou o contato em outgoing
        query = query.eq("sender_id", contactId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ChannelMessage[];
    },
    enabled: !!organizationId && !!contactId && !!channel,
    refetchInterval: contactId && channel ? 20_000 : false,
    refetchIntervalInBackground: false,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Envia mensagem por qualquer canal
 */
export function useSendChannelMessage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      contactId,
      channel,
      message,
      instanceName,
      instanceId,
      pageId,
    }: {
      contactId: string;
      channel: ChannelType;
      message: string;
      instanceName?: string;
      instanceId?: string | null;
      pageId?: string | null;
    }) => {
      if (!teamMember?.organization_id) throw new Error("Organizacao nao encontrada");

      if (channel === "whatsapp") {
        // Enviar via Evolution API (mesmo fluxo existente)
        if (!instanceName) throw new Error("instanceName obrigatorio para WhatsApp");

        const formattedNumber = formatPhoneForWhatsApp(contactId);
        if (!formattedNumber) throw new Error("Número de telefone inválido");
        const { data, error } = await supabase.functions.invoke("evolution-api-proxy", {
          body: {
            endpoint: `/message/sendText/${instanceName}`,
            method: "POST",
            body: { number: formattedNumber, text: message },
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        // Salvar em channel_messages
        const messageId = data?.key?.id || `local_${Date.now()}`;
        await supabase.from("channel_messages").insert({
          organization_id: teamMember.organization_id,
          channel: "whatsapp",
          instance_id: instanceId || null,
          external_id: messageId,
          remote_jid: `${formattedNumber}@s.whatsapp.net`,
          phone_number: formattedNumber,
          direction: "outgoing",
          message_type: "text",
          content: message,
          status: "sent",
          timestamp: new Date().toISOString(),
        });

        return data;
      } else {
        // Enviar via Meta Graph API
        const { data, error } = await supabase.functions.invoke("send-meta-message", {
          body: {
            recipientId: contactId,
            channel,
            message,
            pageId,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data;
      }
    },
    onMutate: async (variables) => {
      const orgId = teamMember?.organization_id;
      const queryKey = ["channel_messages", orgId, variables.contactId, variables.channel, variables.instanceId];

      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ChannelMessage[]>(queryKey);

      const optimistic: ChannelMessage = {
        id: `optimistic_${Date.now()}`,
        organization_id: orgId || "",
        channel: variables.channel,
        instance_id: variables.instanceId || null,
        page_id: variables.pageId || null,
        external_id: `optimistic_${Date.now()}`,
        remote_jid: null,
        phone_number: variables.channel === "whatsapp" ? variables.contactId : null,
        sender_id: variables.channel !== "whatsapp" ? variables.contactId : null,
        sender_name: null,
        sender_profile_pic: null,
        direction: "outgoing",
        message_type: "text",
        content: variables.message,
        media_url: null,
        status: "pending",
        lead_id: null,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<ChannelMessage[]>(queryKey, (old) => [...(old || []), optimistic]);
      return { previous, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["channel_messages", teamMember?.organization_id, variables.contactId, variables.channel],
      });
      queryClient.invalidateQueries({ queryKey: ["channel_contacts"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

/**
 * Subscription em tempo real para channel_messages
 */
export function useChannelMessagesRealtime(contactId: string | null, channel: ChannelType | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!organizationId) return;

    const channelName = `channel-messages-${organizationId}${contactId ? `-${contactId}` : ""}`;

    const sub = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          // Refetch contacts list
          queryClient.refetchQueries({ queryKey: ["channel_contacts", organizationId] });

          // Refetch messages if viewing this contact
          const msg = (payload.new || payload.old) as ChannelMessage | undefined;
          if (contactId && msg) {
            const msgContact = msg.channel === "whatsapp" ? msg.phone_number : msg.sender_id;
            const normalizePhone = (p: string) => p.replace(/\D/g, "").slice(-10) || p;

            const match = msg.channel === "whatsapp"
              ? normalizePhone(msgContact || "") === normalizePhone(contactId)
              : msgContact === contactId;

            if (match) {
              queryClient.refetchQueries({
                queryKey: ["channel_messages", organizationId, contactId, channel],
              });
            }
          } else {
            queryClient.invalidateQueries({ queryKey: ["channel_messages", organizationId] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [organizationId, contactId, channel, queryClient]);
}

/**
 * Marca um contato como "visto" (para contagem de nao lidos)
 */
export function markContactAsSeen(contactKey: string) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(`channel_last_seen_${contactKey}`, new Date().toISOString());
  }
}
