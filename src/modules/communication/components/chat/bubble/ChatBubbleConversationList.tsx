/**
 * Lista de conversas do Bubble — agrega contacts de TODAS instâncias permitidas.
 *
 * Compõe useWhatsAppContacts × N instâncias (cache compartilhado com /chat).
 * Filtragem local: search debounced sobre nome/phone (case-insensitive).
 * Virtualização: >50 items via @tanstack/react-virtual (mesma estratégia
 * do ConversationList canônico).
 *
 * Conversas arquivadas são filtradas (mostra apenas active).
 */
import { useMemo, useRef, useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { ChatBubbleConversationItem } from "./ChatBubbleConversationItem";
import { ChatBubbleEmptyState } from "./ChatBubbleEmptyState";
import { useCurrentTeamMember } from "@/modules/identity";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import { resolveChipInstanceIds } from "@/modules/communication/lib/chipInstanceIds";
import type { ChatContact, ChatContactTag, WhatsAppInstanceForUser } from "@/modules/communication/hooks/chat/types";

const VIRTUALIZE_THRESHOLD = 50;

interface ListEntry {
  contact: ChatContact;
  instanceId: string;
  instanceName: string;
}

interface ChatBubbleConversationListProps {
  instances: WhatsAppInstanceForUser[];
  searchQuery: string;
  selectedPhone: string | null;
  selectedInstanceId: string | null;
  /** Filtro visual por instância. "all" = sem filtro. */
  filterInstanceId: string | "all";
  onSelect: (phone: string, instanceId: string) => void;
  /** Reseta filtro pra "all" — usado pelo empty `filtered-empty`. */
  onResetFilter: () => void;
}

/**
 * Replica enxuta de useWhatsAppContacts mas inline aqui pra usar dentro de
 * useQueries (cada instância gera 1 query). Compartilha queryKey com o hook
 * canônico → cache reaproveitado quando o /chat já populou.
 */
async function fetchContactsForInstance(
  organizationId: string,
  instanceId: string,
): Promise<ChatContact[]> {
  // Chip, não instância: histórico de instância excluída some da bolha pelo
  // mesmo motivo que sumia do /chat. A varredura por chip depende da migration
  // (apply MANUAL); antes dela isto degrada pra instância viva, que é o
  // comportamento de hoje. Ver `chipInstanceIds.ts`.
  const instanceIds = await resolveChipInstanceIds(organizationId, instanceId);

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(`
      phone_number,
      push_name,
      content,
      timestamp,
      direction,
      instance_id,
      lead_id,
      leads(name)
    `)
    .eq("organization_id", organizationId)
    .in("instance_id", [...instanceIds])
    .order("timestamp", { ascending: false });
  if (error) throw error;

  const contactsMap = new Map<string, ChatContact>();
  for (const msg of data || []) {
    const key = normalizePhone(msg.phone_number) ?? msg.phone_number;
    if (!key) continue;
    const existing = contactsMap.get(key);
    const leadName = (msg.leads as { name?: string } | null)?.name ?? null;

    if (!existing) {
      contactsMap.set(key, {
        // A bolha continua WhatsApp-pura nesta fatia: ela lê `whatsapp_messages`
        // e nunca `channel_messages`. O discriminador é carimbado porque a
        // conversa que sai daqui atravessa os mesmos componentes de lista.
        channel: "whatsapp",
        // A bolha agrupa por TELEFONE atravessando caixas (W4 a migra para o
        // motor da caixa unificada). Enquanto isso, a origem carimbada é a da
        // mensagem mais recente — que é também a caixa que a linha abre.
        instance_id: msg.instance_id ?? null,
        phone_number: msg.phone_number,
        push_name: msg.direction === "incoming" ? msg.push_name : null,
        last_message: msg.content,
        last_message_time: msg.timestamp,
        last_message_direction:
          msg.direction === "incoming" || msg.direction === "outgoing"
            ? msg.direction
            : null,
        last_message_sent_source: null,
        unread_count: 0,
        lead_id: msg.lead_id,
        lead_name: leadName,
        conversation_id: null,
        archived_at: null,
        tags: [],
        is_group: false,
        funnels: [],
        qualification_tier: null,
      });
    } else {
      if (new Date(msg.timestamp) > new Date(existing.last_message_time)) {
        existing.last_message = msg.content;
        existing.last_message_time = msg.timestamp;
        existing.last_message_direction =
          msg.direction === "incoming" || msg.direction === "outgoing"
            ? msg.direction
            : existing.last_message_direction;
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

  // Resolve lead names by phone for contacts missing lead_name
  const phonesWithoutName = Array.from(contactsMap.entries())
    .filter(([, c]) => !c.lead_name && !c.push_name)
    .map(([, c]) => c.phone_number);

  if (phonesWithoutName.length > 0) {
    const { data: leads } = await supabase
      .from("leads")
      .select("name, phone")
      .eq("organization_id", organizationId)
      .in("phone", phonesWithoutName);

    if (leads) {
      const leadsByPhone = new Map(leads.map((l) => [normalizePhone(l.phone) ?? l.phone, l.name]));
      for (const contact of contactsMap.values()) {
        if (contact.lead_name || contact.push_name) continue;
        const k = normalizePhone(contact.phone_number) ?? contact.phone_number;
        const name = leadsByPhone.get(k);
        if (name) contact.lead_name = name;
      }
    }
  }

  // Unread count via localStorage last_seen
  const LAST_SEEN = "whatsapp_last_seen_";
  const lastSeen: Record<string, string> = {};
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LAST_SEEN)) {
        const p = k.slice(LAST_SEEN.length);
        lastSeen[p] = localStorage.getItem(k) || "";
      }
    }
  }

  const { data: incoming } = await supabase
    .from("whatsapp_messages")
    .select("phone_number, timestamp")
    .eq("organization_id", organizationId)
    .in("instance_id", [...instanceIds])
    .eq("direction", "incoming")
    .order("timestamp", { ascending: false });

  const unreadByPhone: Record<string, number> = {};
  for (const m of incoming || []) {
    const k = normalizePhone(m.phone_number) ?? "";
    if (!k) continue;
    const seen = lastSeen[k] ? new Date(lastSeen[k]).getTime() : 0;
    if (new Date(m.timestamp).getTime() > seen) {
      unreadByPhone[k] = (unreadByPhone[k] ?? 0) + 1;
    }
  }
  for (const c of contactsMap.values()) {
    const k = normalizePhone(c.phone_number) ?? "";
    c.unread_count = unreadByPhone[k] ?? 0;
  }

  // Conversation metadata pra filtrar arquivadas/deletadas. Segue na instância
  // viva: a FK de `whatsapp_conversations` é ON DELETE CASCADE, então instância
  // excluída não deixa linha pra varrer — não há chip a resolver aqui.
  const { data: convMeta } = await supabase
    .from("whatsapp_conversations")
    .select("id, phone_number, archived_at, deleted_at")
    .eq("organization_id", organizationId)
    .eq("instance_id", instanceId);

  const metaMap = new Map<
    string,
    { id: string; archived_at: string | null; deleted_at: string | null }
  >();
  for (const row of convMeta || []) {
    const k = normalizePhone(row.phone_number) ?? row.phone_number;
    metaMap.set(k, row);
  }

  const results: ChatContact[] = [];
  for (const contact of contactsMap.values()) {
    const k = normalizePhone(contact.phone_number) ?? contact.phone_number;
    const meta = metaMap.get(k);
    if (meta?.deleted_at) continue;
    if (meta?.archived_at) continue; // Bubble mostra apenas active
    contact.conversation_id = meta?.id ?? null;
    contact.archived_at = meta?.archived_at ?? null;
    // Tags ficam vazias no Bubble (compact); detalhamento fica em /chat.
    contact.tags = [] as ChatContactTag[];
    results.push(contact);
  }

  results.sort(
    (a, b) =>
      new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime(),
  );
  return results;
}

export function ChatBubbleConversationList({
  instances,
  searchQuery,
  selectedPhone,
  selectedInstanceId,
  filterInstanceId,
  onSelect,
  onResetFilter,
}: ChatBubbleConversationListProps) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const showInstanceDot = instances.length > 1;

  const queries = useQueries({
    queries: instances.map((inst) => ({
      queryKey: chatQueryKeys.contacts(organizationId, inst.id),
      queryFn: () => fetchContactsForInstance(organizationId!, inst.id),
      enabled: !!organizationId && !!inst.id,
      staleTime: 5 * 60_000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading) && !queries.some((q) => q.data);
  const allEntries: ListEntry[] = useMemo(() => {
    const out: ListEntry[] = [];
    queries.forEach((q, idx) => {
      const inst = instances[idx];
      if (!inst || !q.data) return;
      for (const contact of q.data) {
        out.push({ contact, instanceId: inst.id, instanceName: inst.instance_name });
      }
    });
    out.sort(
      (a, b) =>
        new Date(b.contact.last_message_time).getTime() -
        new Date(a.contact.last_message_time).getTime(),
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join("|"), instances]);

  // Filtro por instância (visual, client-side). Aplicado ANTES de search/empty
  // pra que o empty state filtered-empty fale do contexto correto.
  const instanceFiltered: ListEntry[] = useMemo(() => {
    if (filterInstanceId === "all") return allEntries;
    return allEntries.filter((e) => e.instanceId === filterInstanceId);
  }, [allEntries, filterInstanceId]);

  const filtered: ListEntry[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return instanceFiltered;
    return instanceFiltered.filter((e) => {
      const name = (e.contact.lead_name || e.contact.push_name || "").toLowerCase();
      const phone = (e.contact.phone_number || "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [instanceFiltered, searchQuery]);

  // Nome da instância filtrada (pro empty state `filtered-empty`)
  const filteredInstanceName = useMemo(() => {
    if (filterInstanceId === "all") return null;
    return instances.find((i) => i.id === filterInstanceId)?.instance_name ?? null;
  }, [filterInstanceId, instances]);

  // Virtualização
  const scrollRef = useRef<HTMLDivElement>(null);
  const useVirtual = filtered.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: useVirtual ? filtered.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 px-3 py-3" aria-label="Carregando conversas">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (instances.length === 0) {
    return <ChatBubbleEmptyState variant="no-instance" />;
  }

  if (filtered.length === 0) {
    if (searchQuery.trim()) {
      return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-2">
          <p className="text-sm text-muted-foreground">
            Nenhum resultado pra "{searchQuery.trim()}"
          </p>
        </div>
      );
    }
    if (filterInstanceId !== "all" && filteredInstanceName) {
      return (
        <ChatBubbleEmptyState
          variant="filtered-empty"
          instanceName={filteredInstanceName}
          onReset={onResetFilter}
        />
      );
    }
    return <ChatBubbleEmptyState variant="no-conversations" />;
  }

  // ── Lista renderizada ──────────────────────────────────────────────────────
  return (
    <ScrollArea className="flex-1 min-h-0">
      <div ref={scrollRef} className="relative">
        {useVirtual ? (
          <ul
            role="list"
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const entry = filtered[vi.index];
              if (!entry) return null;
              return (
                <div
                  key={`${entry.instanceId}::${entry.contact.phone_number}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <ChatBubbleConversationItem
                    contact={entry.contact}
                    instanceId={entry.instanceId}
                    instanceName={entry.instanceName}
                    showInstanceDot={showInstanceDot}
                    isSelected={
                      selectedPhone === entry.contact.phone_number &&
                      selectedInstanceId === entry.instanceId
                    }
                    onSelect={() => onSelect(entry.contact.phone_number, entry.instanceId)}
                  />
                </div>
              );
            })}
          </ul>
        ) : (
          <ul role="list">
            {filtered.map((entry) => (
              <ChatBubbleConversationItem
                key={`${entry.instanceId}::${entry.contact.phone_number}`}
                contact={entry.contact}
                instanceId={entry.instanceId}
                instanceName={entry.instanceName}
                showInstanceDot={showInstanceDot}
                isSelected={
                  selectedPhone === entry.contact.phone_number &&
                  selectedInstanceId === entry.instanceId
                }
                onSelect={() => onSelect(entry.contact.phone_number, entry.instanceId)}
              />
            ))}
          </ul>
        )}

        {queries.some((q) => q.isFetching) && !isLoading && (
          <div className="absolute top-2 right-2 text-muted-foreground/60">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
