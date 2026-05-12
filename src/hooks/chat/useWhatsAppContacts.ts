/**
 * useWhatsAppContacts — lista de contatos/conversas do WhatsApp de uma instância.
 * Extraído de src/hooks/useWhatsAppChat.ts (C12).
 *
 * C21: remove refetchInterval — patches incrementais via useWhatsAppMessagesRealtime.
 * C22: performance — limit payload, compute unread from same dataset, staleTime cache.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { chatQueryKeys } from "./shared/queryKeys";
import type { ChatContact, ChatContactTag } from "./types";

const normalizePhone = (p: string) => {
  let cleaned = p.replace(/\D/g, "");
  if (!cleaned) return p;
  if (cleaned.length >= 12 && cleaned.startsWith("55")) cleaned = cleaned.slice(2);
  if (cleaned.length === 10) cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  return cleaned;
};

const LAST_SEEN_KEY = "whatsapp_last_seen_";

function getLastSeenMap(): Record<string, number> {
  const map: Record<string, number> = {};
  if (typeof localStorage === "undefined") return map;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LAST_SEEN_KEY)) {
      const phone = k.slice(LAST_SEEN_KEY.length);
      const val = localStorage.getItem(k);
      map[phone] = val ? new Date(val).getTime() : 0;
    }
  }
  return map;
}

/**
 * Hook para listar contatos/conversas do WhatsApp de uma instância (inbox por número).
 * Se instanceId for null, não retorna conversas — usuário deve escolher um número primeiro.
 */
export function useWhatsAppContacts(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: chatQueryKeys.contacts(organizationId, instanceId),
    queryFn: async () => {
      if (!organizationId || !instanceId) return [];

      // Query 1: mensagens recentes (limitadas) + metadados de conversas em paralelo
      const [{ data: msgData, error: msgError }, { data: convMeta }] = await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select("phone_number, push_name, content, timestamp, direction, lead_id")
          .eq("organization_id", organizationId)
          .eq("instance_id", instanceId)
          .is("deleted_at", null)
          .order("timestamp", { ascending: false })
          .limit(8000),
        supabase
          .from("whatsapp_conversations")
          .select("id, phone_number, archived_at, deleted_at")
          .eq("organization_id", organizationId)
          .eq("instance_id", instanceId),
      ]);

      if (msgError) throw msgError;

      // Build contacts map + compute unread from same dataset
      const lastSeenMap = getLastSeenMap();
      const contactsMap = new Map<string, ChatContact>();
      const unreadByPhone: Record<string, number> = {};

      for (const msg of msgData || []) {
        const key = normalizePhone(msg.phone_number);
        const existing = contactsMap.get(key);

        // Count unread (incoming after last seen)
        if (msg.direction === "incoming") {
          const lastSeen = lastSeenMap[key] ?? 0;
          if (new Date(msg.timestamp).getTime() > lastSeen) {
            unreadByPhone[key] = (unreadByPhone[key] ?? 0) + 1;
          }
        }

        if (!existing) {
          contactsMap.set(key, {
            phone_number: msg.phone_number,
            push_name: msg.direction === "incoming" ? msg.push_name : null,
            last_message: msg.content,
            last_message_time: msg.timestamp,
            last_message_direction: msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : null,
            unread_count: 0,
            lead_id: msg.lead_id,
            lead_name: null,
            conversation_id: null,
            archived_at: null,
            tags: [],
          });
        } else {
          if (msg.lead_id && !existing.lead_id) {
            existing.lead_id = msg.lead_id;
          }
          if (msg.direction === "incoming" && msg.push_name && !existing.push_name) {
            existing.push_name = msg.push_name;
          }
        }
      }

      // Apply unread counts
      for (const contact of contactsMap.values()) {
        contact.unread_count = unreadByPhone[normalizePhone(contact.phone_number)] ?? 0;
      }

      // Conversation metadata index (by normalized phone)
      const convMetaMap = new Map<string, { id: string; archived_at: string | null; deleted_at: string | null }>();
      for (const row of convMeta || []) {
        convMetaMap.set(normalizePhone(row.phone_number), row);
      }

      // Collect unique lead_ids for batch fetch
      const leadIds = [...new Set(
        Array.from(contactsMap.values())
          .map((c) => c.lead_id)
          .filter((id): id is string => !!id)
      )];

      // Collect conversation_ids for tag fetch
      const convIds: string[] = [];
      for (const contact of contactsMap.values()) {
        const meta = convMetaMap.get(normalizePhone(contact.phone_number));
        if (meta?.id) convIds.push(meta.id);
      }

      // Contacts without lead_id — resolve by phone match
      const phonesWithoutLead = Array.from(contactsMap.entries())
        .filter(([, c]) => !c.lead_id)
        .map(([key]) => key);

      // Query 2: lead names (by id + by phone) + lead_tags + conversation_tags em paralelo
      const [leadNamesResult, leadsByPhoneResult, leadTagsResult, convTagsResult] = await Promise.all([
        leadIds.length > 0
          ? supabase.from("leads").select("id, name, phone").in("id", leadIds)
          : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null }[] }),
        phonesWithoutLead.length > 0
          ? supabase.from("leads").select("id, name, phone")
              .eq("organization_id", organizationId)
              .not("phone", "is", null)
          : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null }[] }),
        leadIds.length > 0
          ? supabase.from("lead_tags").select("lead_id, tags!inner(id, name, color)").in("lead_id", leadIds)
          : Promise.resolve({ data: [] as any[] }),
        convIds.length > 0
          ? supabase.from("whatsapp_conversation_tags").select("conversation_id, tags!inner(id, name, color)").in("conversation_id", convIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      // Index lead names by id
      const leadNameMap = new Map<string, string>();
      for (const row of leadNamesResult.data || []) {
        if (row.name) leadNameMap.set(row.id, row.name);
      }

      // Index leads by normalized phone for fallback resolution
      const leadByPhoneMap = new Map<string, { id: string; name: string }>();
      for (const row of leadsByPhoneResult.data || []) {
        if (row.phone && row.name) {
          leadByPhoneMap.set(normalizePhone(row.phone), { id: row.id, name: row.name });
        }
      }

      // Index lead tags
      const leadTagsMap = new Map<string, ChatContactTag[]>();
      for (const row of (leadTagsResult.data || []) as any[]) {
        const tag = (row as unknown as { tags: ChatContactTag }).tags;
        const existing = leadTagsMap.get(row.lead_id) || [];
        existing.push(tag);
        leadTagsMap.set(row.lead_id, existing);
      }

      // Index conversation tags
      const convTagsByConvId = new Map<string, ChatContactTag[]>();
      for (const row of (convTagsResult.data || []) as any[]) {
        const tag = row.tags as unknown as ChatContactTag;
        const existing = convTagsByConvId.get(row.conversation_id) || [];
        existing.push(tag);
        convTagsByConvId.set(row.conversation_id, existing);
      }

      // Pre-resolve phone-matched leads and collect extra lead_ids for tag fetch
      const extraLeadIds: string[] = [];
      for (const contact of contactsMap.values()) {
        if (!contact.lead_id) {
          const phoneLead = leadByPhoneMap.get(normalizePhone(contact.phone_number));
          if (phoneLead) {
            contact.lead_id = phoneLead.id;
            contact.lead_name = phoneLead.name;
            extraLeadIds.push(phoneLead.id);
          }
        } else {
          contact.lead_name = leadNameMap.get(contact.lead_id) ?? null;
        }
      }

      // Fetch tags for phone-resolved leads
      if (extraLeadIds.length > 0) {
        const { data: extraTags } = await supabase
          .from("lead_tags")
          .select("lead_id, tags!inner(id, name, color)")
          .in("lead_id", extraLeadIds);
        for (const row of (extraTags || []) as any[]) {
          const tag = (row as unknown as { tags: ChatContactTag }).tags;
          const existing = leadTagsMap.get(row.lead_id) || [];
          existing.push(tag);
          leadTagsMap.set(row.lead_id, existing);
        }
      }

      // Assemble final results
      const results: ChatContact[] = [];
      for (const contact of contactsMap.values()) {
        const normPhone = normalizePhone(contact.phone_number);
        const meta = convMetaMap.get(normPhone);

        if (meta?.deleted_at) continue;

        contact.conversation_id = meta?.id ?? null;
        contact.archived_at = meta?.archived_at ?? null;

        // Merge tags: lead_tags + conversation_tags (deduplicated by tag.id)
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
        results.push(contact);
      }

      return results;
    },
    enabled: !!organizationId && !!instanceId,
    staleTime: 30_000,
  });
}
