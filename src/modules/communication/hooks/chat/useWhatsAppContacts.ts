/**
 * useWhatsAppContacts — lista de contatos/conversas do WhatsApp de uma instância.
 * Extraído de src/hooks/useWhatsAppChat.ts (C12).
 *
 * C21: remove refetchInterval — patches incrementais via useWhatsAppMessagesRealtime.
 * C22: performance — limit payload, compute unread from same dataset, staleTime cache.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { chatQueryKeys } from "./shared/queryKeys";
import type { ChatContact, ChatContactTag } from "./types";
import {
  UNFILTERED_PAGE_LIMIT,
  type InboxServerFilter,
} from "@/modules/communication/lib/inboxFilterServer";
import {
  selectInChunks,
  IN_CHUNK_SIZE,
  IN_CHUNK_SIZE_FANOUT,
} from "@/shared/supabase/selectInChunks";
import { resolveChipInstanceIds } from "@/modules/communication/lib/chipInstanceIds";
import { nomeDoLeadNaLista } from "@/modules/communication/lib/nomeDoLeadNaLista";
import {
  useWhatsAppRealtimeFallback,
  FALLBACK_POLL_INTERVAL_MS,
  JOINED_BACKSTOP_POLL_INTERVAL_MS,
} from "./useRealtimeFallback";

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
 *
 * `serverFilter` (issue #1277) empurra as dimensões do filtro do inbox pra RPC,
 * que as aplica ANTES do LIMIT. Sem ele a página de 500 mais recentes era todo o
 * universo que o filtro do cliente enxergava. Omitir mantém o comportamento e a
 * queryKey de antes — é o que fazem command palette e bolha de chat.
 */
export function useWhatsAppContacts(
  instanceId: string | null,
  serverFilter?: InboxServerFilter,
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const { shouldPoll } = useWhatsAppRealtimeFallback(organizationId);

  const filterArgs = serverFilter?.args ?? null;
  const pageLimit = serverFilter?.limit ?? UNFILTERED_PAGE_LIMIT;

  return useQuery({
    queryKey: chatQueryKeys.contacts(organizationId, instanceId, serverFilter?.cacheKey),
    queryFn: async () => {
      if (!organizationId || !instanceId) return [];

      // Falha de enriquecimento NÃO derruba a lista: a lista é o payload, nome e
      // etiqueta são acessórios e degradam. Mas degradar em silêncio foi o que
      // escondeu o incidente — agora deixa rastro no console.
      const soft = <T,>(p: Promise<T[]>, label: string): Promise<T[]> =>
        p.catch((e) => {
          console.error(`[inbox] enriquecimento "${label}" falhou`, e);
          return [] as T[];
        });

      /**
       * Etiqueta é a única coisa enriquecida AQUI que o filtro do inbox avalia
       * (`matchesTags`). Com filtro de etiqueta ativo, degradar pra `[]` não é
       * degradar: é reencenar o incidente por outra porta — o predicado reprova
       * a página inteira e a tela mostra "Total: 0" como se fosse resposta.
       *
       * Então a política inverte quando a dimensão está em uso: a falha SOBE, a
       * query vai a `isError`, e o gate (`inboxFilterGate`) acende o aviso em vez
       * do empty state. Sem filtro de etiqueta, a lista vale mais que os chips e
       * o comportamento é o de sempre.
       */
      const tagsAreFilterCritical = filterArgs?.p_tags != null;
      const softTags = <T,>(p: Promise<T[]>, label: string): Promise<T[]> =>
        tagsAreFilterCritical ? p : soft(p, label);

      // ── V3: lista server-side via RPC (DEFAULT ON; escape hatch localStorage '0') ──
      // get_whatsapp_conversation_list lê da tabela-resumo whatsapp_conversation_summary
      // (1 linha/conversa, mantida por trigger): ~85x mais rápida que o fetch de 8000
      // linhas + dedup-em-JS (2906ms → ~34ms p/ 500 conversas). Unread continua do
      // localStorage até conversation_read_state popular (evita badge explodir).
      // Desligar por device: localStorage.setItem('v3_server_contacts','0').
      const useServerList =
        typeof localStorage === "undefined" ||
        localStorage.getItem("v3_server_contacts") !== "0";

      if (useServerList) {
        const { data: rows, error: rpcError } = await supabase.rpc(
          "get_whatsapp_conversation_list",
          {
            p_org: organizationId,
            p_instance: instanceId,
            p_limit: pageLimit,
            ...(filterArgs ?? {}),
          } as any
        );
        if (rpcError) throw rpcError;

        // unread: server-side (read_state) por padrão; localStorage coarse no escape hatch.
        const useServerUnread =
          typeof localStorage === "undefined" || localStorage.getItem("v3_server_unread") !== "0";
        const lastSeen = useServerUnread ? {} : getLastSeenMap();
        // `normalized_phone` é o que a RPC já devolve e o que `leads` indexa
        // (`idx_leads_org_normalized_phone`). Guardar aqui evita re-normalizar
        // depois com uma função do cliente que pode divergir da do banco.
        const normalizadoPorTelefone = new Map<string, string>();
        const contacts: ChatContact[] = (rows ?? []).map((r: any) => {
          if (r.normalized_phone) normalizadoPorTelefone.set(r.phone_number, r.normalized_phone);
          const key = normalizePhone(r.phone_number);
          const unread = useServerUnread
            ? (r.unread_count ?? 0)
            : (r.last_message_direction === "incoming" &&
               new Date(r.last_message_time).getTime() > (lastSeen[key] ?? 0)
                ? Math.max(r.unread_count ?? 1, 1)
                : 0);
          return {
            channel: "whatsapp",
            phone_number: r.phone_number,
            unread_count: unread,
            push_name: r.push_name,
            last_message: r.last_message,
            last_message_time: r.last_message_time,
            last_message_direction:
              r.last_message_direction === "incoming" || r.last_message_direction === "outgoing"
                ? r.last_message_direction
                : null,
            last_message_sent_source: r.last_message_sent_source ?? null,
            lead_id: r.lead_id,
            lead_name: null,
            conversation_id: r.conversation_id,
            archived_at: r.archived_at,
            tags: [],
            is_group: r.is_group === true,
            funnels: [],
            qualification_tier: null,
          } as ChatContact;
        });

        // Enriquecimento (lead names + tags) — em LOTES. Com filtro ativo a página
        // vai a 1000 conversas e um `.in()` com 1000 uuids passa de 39 KB de URL:
        // o gateway responde 400. Antes o código lia só `.data`, sem checar `error`,
        // então esse 400 apagava nome e etiqueta de todas as conversas em silêncio.
        const leadIds = [...new Set(contacts.map((c) => c.lead_id).filter((id): id is string => !!id))];
        const convIds = [
          ...new Set(contacts.map((c) => c.conversation_id).filter((id): id is string => !!id)),
        ];

        /**
         * Conversa SEM `lead_id` no resumo também precisa do nome do CRM.
         *
         * `whatsapp_conversation_summary.lead_id` só é gravado quando a mensagem
         * entrou já sabendo o lead, ou quando `trg_leads_adopt_orphan_messages`
         * adotou a conversa (INSERT do lead, ou UPDATE do telefone dele). Fora
         * desses dois momentos — lead que ganhou telefone por outro caminho,
         * conversa cujo vínculo nunca foi refeito — o resumo fica NULL para
         * sempre, e a linha exibiria `push_name` ou o número enquanto o
         * CABEÇALHO da mesma conversa mostra o nome do lead: o cabeçalho tem
         * `useLeadByPhone`, a lista não tinha nada equivalente. É a mesma
         * divergência que este arquivo acabou de fechar, entrando por outra porta.
         *
         * O caminho de escape (`v3_server_contacts='0'`, adiante) já resolvia por
         * telefone — só o caminho servidor, que é o DEFAULT, não resolvia.
         *
         * Custa uma consulta a mais, e só quando existe linha sem lead. Bate no
         * índice parcial `idx_leads_org_normalized_phone (organization_id,
         * normalized_phone)`, e `idx_leads_org_phone_unique` garante no máximo um
         * lead vivo por telefone na org — sem ambiguidade de qual nome usar.
         */
        const telefonesSemLead = [
          ...new Set(
            contacts
              .filter((c) => !c.lead_id)
              .map((c) => normalizadoPorTelefone.get(c.phone_number))
              .filter((p): p is string => !!p),
          ),
        ];

        const [leadNameRows, leadsPorTelefone, leadTagRows, convTagRows] = await Promise.all([
          soft(
            selectInChunks<{ id: string; name: string | null }>(
              leadIds,
              (chunk) => supabase.from("leads").select("id, name").in("id", chunk),
              IN_CHUNK_SIZE,
            ),
            "leads",
          ),
          telefonesSemLead.length > 0
            ? soft(
                selectInChunks<{ name: string | null; normalized_phone: string | null }>(
                  telefonesSemLead,
                  (chunk) =>
                    supabase
                      .from("leads")
                      .select("name, normalized_phone")
                      .eq("organization_id", organizationId)
                      .is("deleted_at", null)
                      .in("normalized_phone", chunk),
                  IN_CHUNK_SIZE,
                ),
                "leads_por_telefone",
              )
            : Promise.resolve([] as { name: string | null; normalized_phone: string | null }[]),
          softTags(
            selectInChunks<any>(
              leadIds,
              (chunk) =>
                supabase
                  .from("lead_tags")
                  .select("lead_id, tags!inner(id, name, color)")
                  .in("lead_id", chunk),
              IN_CHUNK_SIZE_FANOUT,
            ),
            "lead_tags",
          ),
          softTags(
            selectInChunks<any>(
              convIds,
              (chunk) =>
                supabase
                  .from("whatsapp_conversation_tags")
                  .select("conversation_id, tags!inner(id, name, color)")
                  .in("conversation_id", chunk),
              IN_CHUNK_SIZE_FANOUT,
            ),
            "conversation_tags",
          ),
        ]);

        const leadNameMap = new Map<string, string>();
        for (const row of leadNameRows) if (row.name) leadNameMap.set(row.id, row.name);
        const nomePorTelefone = new Map<string, string>();
        for (const row of leadsPorTelefone) {
          if (row.normalized_phone && row.name) nomePorTelefone.set(row.normalized_phone, row.name);
        }
        const leadTagsMap = new Map<string, ChatContactTag[]>();
        for (const row of leadTagRows as any[]) {
          const tag = (row as { tags: ChatContactTag }).tags;
          leadTagsMap.set(row.lead_id, [...(leadTagsMap.get(row.lead_id) || []), tag]);
        }
        const convTagsMap = new Map<string, ChatContactTag[]>();
        for (const row of convTagRows as any[]) {
          const tag = (row as { tags: ChatContactTag }).tags;
          convTagsMap.set(row.conversation_id, [...(convTagsMap.get(row.conversation_id) || []), tag]);
        }

        for (const c of contacts) {
          // Só o NOME sai daqui — `lead_id` continua sendo o que o servidor disse.
          // A RPC filtra `p_lead_presence='sem'` por `s.lead_id IS NULL`; preencher
          // o id no cliente faria a linha aparecer como vinculada dentro do filtro
          // que pediu justamente as não-vinculadas, e apagaria a bolinha "Novo"
          // que existe pra alguém ir lá vincular.
          c.lead_name = nomeDoLeadNaLista(c, {
            porId: leadNameMap,
            porTelefone: nomePorTelefone,
            normalizadoPorTelefone,
          });
          const tagIds = new Set<string>();
          const merged: ChatContactTag[] = [];
          for (const t of (c.lead_id ? leadTagsMap.get(c.lead_id) : undefined) || [])
            if (!tagIds.has(t.id)) { tagIds.add(t.id); merged.push(t); }
          for (const t of (c.conversation_id ? convTagsMap.get(c.conversation_id) : undefined) || [])
            if (!tagIds.has(t.id)) { tagIds.add(t.id); merged.push(t); }
          c.tags = merged;
        }

        return contacts;
      }

      // ── Escape hatch (v3_server_contacts='0'): monta a lista de whatsapp_messages ──
      // Não empurra `serverFilter`: aqui o universo já são todas as conversas com
      // mensagem recente, então o filtro do cliente sozinho não trunca.
      //
      // No caminho server a resolução do chip fica dentro da RPC
      // (`get_whatsapp_conversation_list`, redefinida pela migration
      // `20270811000011_whatsapp_historico_por_chip.sql` — apply MANUAL); aqui
      // ela é explícita, senão o escape hatch esconderia justamente as conversas
      // que ficaram numa instância excluída. Antes do apply os dois caminhos
      // degradam pra instância viva — ver `chipInstanceIds.ts`.
      const instanceIds = await resolveChipInstanceIds(organizationId, instanceId);

      // Query 1: mensagens recentes (limitadas) + metadados de conversas em paralelo
      const [{ data: msgData, error: msgError }, { data: convMeta }] = await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select("phone_number, push_name, content, timestamp, direction, lead_id, sent_source, is_group")
          .eq("organization_id", organizationId)
          .in("instance_id", [...instanceIds])
          .is("deleted_at", null)
          // Grupo sai do produto (#1632). O recorte é no servidor, não depois
          // do .limit(8000): grupo é 40% das mensagens, então baixá-lo para
          // descartar no navegador gastava 40% do payload e ainda empurrava
          // conversa individual para fora da janela.
          .eq("is_group", false)
          .order("timestamp", { ascending: false })
          .limit(8000),
        // `whatsapp_conversations` fica na instância viva de propósito: a FK dela
        // é ON DELETE CASCADE, então instância excluída não deixa linha órfã pra
        // varrer. Arquivamento e etiqueta da instância morta morreram com ela.
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
            channel: "whatsapp",
            phone_number: msg.phone_number,
            push_name: msg.direction === "incoming" ? msg.push_name : null,
            last_message: msg.content,
            last_message_time: msg.timestamp,
            last_message_direction: msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : null,
            last_message_sent_source: (msg as any).sent_source ?? null,
            unread_count: 0,
            lead_id: msg.lead_id,
            lead_name: null,
            conversation_id: null,
            archived_at: null,
            tags: [],
            is_group: (msg as any).is_group === true,
            funnels: [],
            qualification_tier: null,
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

      // Aqui os ids saem de até 8000 mensagens, então passam de 641 fácil em org
      // grande — mesmo estouro de URL do caminho server. Vai em lotes, e falha
      // deixa rastro em vez de sumir com nome/etiqueta em silêncio. `soft` e
      // `softTags` são os mesmos do caminho server (declarados no topo do queryFn).

      // Query 2: lead names (by id + by phone) + lead_tags + conversation_tags em paralelo
      const [leadNameRows, leadsByPhoneResult, leadTagRows, convTagRows] = await Promise.all([
        soft(
          selectInChunks<{ id: string; name: string | null; phone: string | null }>(
            leadIds,
            (chunk) => supabase.from("leads").select("id, name, phone").in("id", chunk),
            IN_CHUNK_SIZE,
          ),
          "leads",
        ),
        phonesWithoutLead.length > 0
          ? supabase.from("leads").select("id, name, phone")
              .eq("organization_id", organizationId)
              .not("phone", "is", null)
          : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null }[] }),
        softTags(
          selectInChunks<any>(
            leadIds,
            (chunk) =>
              supabase
                .from("lead_tags")
                .select("lead_id, tags!inner(id, name, color)")
                .in("lead_id", chunk),
            IN_CHUNK_SIZE_FANOUT,
          ),
          "lead_tags",
        ),
        softTags(
          selectInChunks<any>(
            convIds,
            (chunk) =>
              supabase
                .from("whatsapp_conversation_tags")
                .select("conversation_id, tags!inner(id, name, color)")
                .in("conversation_id", chunk),
            IN_CHUNK_SIZE_FANOUT,
          ),
          "conversation_tags",
        ),
      ]);

      // Index lead names by id
      const leadNameMap = new Map<string, string>();
      for (const row of leadNameRows) {
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
      for (const row of leadTagRows as any[]) {
        const tag = (row as unknown as { tags: ChatContactTag }).tags;
        const existing = leadTagsMap.get(row.lead_id) || [];
        existing.push(tag);
        leadTagsMap.set(row.lead_id, existing);
      }

      // Index conversation tags
      const convTagsByConvId = new Map<string, ChatContactTag[]>();
      for (const row of convTagRows as any[]) {
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
        const extraTags = await softTags(
          selectInChunks<any>(
            extraLeadIds,
            (chunk) =>
              supabase
                .from("lead_tags")
                .select("lead_id, tags!inner(id, name, color)")
                .in("lead_id", chunk),
            IN_CHUNK_SIZE_FANOUT,
          ),
          "lead_tags(phone-resolved)",
        );
        for (const row of extraTags as any[]) {
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
    // A lista lê da tabela-resumo `whatsapp_conversation_summary`, que NÃO está
    // na publicação realtime — depende do evento de `whatsapp_messages` disparar
    // o invalidate embutido. Se esse evento é dropado (apply_rls sob carga), a
    // conversa nova só aparece no F5. Backstop reconcilia mesmo com canal saudável.
    refetchInterval: shouldPoll
      ? FALLBACK_POLL_INTERVAL_MS
      : JOINED_BACKSTOP_POLL_INTERVAL_MS,
  });
}
