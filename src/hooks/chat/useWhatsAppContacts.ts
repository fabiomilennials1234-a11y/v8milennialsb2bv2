/**
 * useWhatsAppContacts — lista de contatos/conversas do WhatsApp de uma instância.
 * Extraído de src/hooks/useWhatsAppChat.ts (C12).
 *
 * C21: remove refetchInterval — patches incrementais via useWhatsAppMessagesRealtime.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { ChatContact, ChatContactTag } from "./types";

/**
 * Hook para listar contatos/conversas do WhatsApp de uma instância (inbox por número).
 * Se instanceId for null, não retorna conversas — usuário deve escolher um número primeiro.
 */
export function useWhatsAppContacts(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_contacts", organizationId, instanceId],
    queryFn: async () => {
      if (!organizationId || !instanceId) return [];

      // Buscar mensagens agrupadas por contato desta instância
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select(`
          phone_number,
          push_name,
          content,
          timestamp,
          direction,
          lead_id,
          leads(name)
        `)
        .eq("organization_id", organizationId)
        .eq("instance_id", instanceId)
        .order("timestamp", { ascending: false });

      if (error) throw error;

      // Normalizar telefone: usa a mesma lógica canônica do banco (normalize_brazilian_phone)
      const normalizePhone = (p: string) => {
        let cleaned = p.replace(/\D/g, "");
        if (!cleaned) return p;
        if (cleaned.length >= 12 && cleaned.startsWith("55")) cleaned = cleaned.slice(2);
        if (cleaned.length === 10) cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
        return cleaned;
      };

      // Agrupar por telefone normalizado; priorizar nome do lead quando existir
      const contactsMap = new Map<string, ChatContact>();

      for (const msg of data || []) {
        const key = normalizePhone(msg.phone_number);
        const existing = contactsMap.get(key);
        const leadName = (msg.leads as { name?: string } | null)?.name ?? null;

        if (!existing) {
          contactsMap.set(key, {
            phone_number: msg.phone_number,
            push_name: msg.direction === "incoming" ? msg.push_name : null,
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
          // Manter a mensagem mais recente; preferir lead_id/lead_name quando existir
          if (new Date(msg.timestamp) > new Date(existing.last_message_time)) {
            existing.last_message = msg.content;
            existing.last_message_time = msg.timestamp;
            existing.last_message_direction = msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : existing.last_message_direction;
          }
          if (msg.lead_id || leadName) {
            existing.lead_id = existing.lead_id || msg.lead_id;
            existing.lead_name = existing.lead_name || leadName;
          }
          if (msg.direction === "incoming" && msg.push_name) {
            existing.push_name = existing.push_name || msg.push_name;
          }
        }
      }

      // Buscar contagem de mensagens não lidas (incoming após último acesso)
      const LAST_SEEN_KEY = "whatsapp_last_seen_";
      const lastSeenMap: Record<string, string> = {};
      if (typeof localStorage !== "undefined") {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(LAST_SEEN_KEY)) {
            const phone = k.slice(LAST_SEEN_KEY.length);
            lastSeenMap[phone] = localStorage.getItem(k) || "";
          }
        }
      }

      // Buscar incoming messages, metadados de conversas e tags em paralelo
      const [{ data: incomingData }, { data: convMeta }, { data: convTagsData }] = await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select("phone_number, timestamp")
          .eq("organization_id", organizationId)
          .eq("instance_id", instanceId)
          .eq("direction", "incoming")
          .order("timestamp", { ascending: false }),
        supabase
          .from("whatsapp_conversations")
          .select("id, phone_number, archived_at, deleted_at")
          .eq("organization_id", organizationId)
          .eq("instance_id", instanceId),
        supabase
          .from("whatsapp_conversation_tags")
          .select(`
            conversation_id,
            tags!inner(id, name, color)
          `),
      ]);

      const unreadByPhone: Record<string, number> = {};
      for (const m of incomingData || []) {
        const key = normalizePhone(m.phone_number);
        const lastSeen = lastSeenMap[key] ? new Date(lastSeenMap[key]).getTime() : 0;
        if (new Date(m.timestamp).getTime() > lastSeen) {
          unreadByPhone[key] = (unreadByPhone[key] ?? 0) + 1;
        }
      }

      for (const contact of contactsMap.values()) {
        const key = normalizePhone(contact.phone_number);
        contact.unread_count = unreadByPhone[key] ?? 0;
      }

      // Mapear conversation tags por conversation_id
      const convTagsByConvId = new Map<string, ChatContactTag[]>();
      for (const row of convTagsData || []) {
        const tag = row.tags as unknown as ChatContactTag;
        const existing = convTagsByConvId.get(row.conversation_id) || [];
        existing.push(tag);
        convTagsByConvId.set(row.conversation_id, existing);
      }

      // Buscar lead_tags para leads associados
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

      // Enriquecer contatos com metadados de conversa e tags
      // Index by normalized phone so format differences don't break lookup
      const convMetaMap = new Map<string, { id: string; archived_at: string | null; deleted_at: string | null }>();
      for (const row of convMeta || []) {
        const normKey = normalizePhone(row.phone_number);
        convMetaMap.set(normKey, row);
      }

      const results: ChatContact[] = [];
      for (const contact of contactsMap.values()) {
        const meta = convMetaMap.get(normalizePhone(contact.phone_number));

        // Filtrar conversas excluídas
        if (meta?.deleted_at) continue;

        contact.conversation_id = meta?.id ?? null;
        contact.archived_at = meta?.archived_at ?? null;

        // Merge tags: lead_tags + conversation_tags (sem duplicatas por tag.id)
        const tagIds = new Set<string>();
        const mergedTags: ChatContactTag[] = [];

        // Lead tags primeiro
        if (contact.lead_id) {
          for (const tag of leadTagsMap.get(contact.lead_id) || []) {
            if (!tagIds.has(tag.id)) {
              tagIds.add(tag.id);
              mergedTags.push(tag);
            }
          }
        }

        // Conversation tags
        if (meta?.id) {
          for (const tag of convTagsByConvId.get(meta.id) || []) {
            if (!tagIds.has(tag.id)) {
              tagIds.add(tag.id);
              mergedTags.push(tag);
            }
          }
        }

        contact.tags = mergedTags;
        results.push(contact);
      }

      return results;
    },
    enabled: !!organizationId && !!instanceId,
    // C21: sem refetchInterval — realtime via useWhatsAppMessagesRealtime
    // aplica patches incrementais em last_message / unread_count sem refetch total.
  });
}
