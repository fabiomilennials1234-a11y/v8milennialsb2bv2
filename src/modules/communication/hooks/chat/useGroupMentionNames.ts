/**
 * `lid → nome` para as menções de uma conversa de GRUPO (Chamado 6885e65d).
 *
 * Primeiro das mensagens já carregadas: cada mensagem de grupo traz o LID de
 * quem escreveu (`uazapi_sender_lid`) e o `push_name` — de graça, sem rede. Só
 * o LID citado que não escreveu nas mensagens carregadas vai ao banco: uma
 * consulta por LID, `limit(1)`, a mensagem mais recente dele NESTE grupo
 * (índice `instance_id, remote_jid, timestamp`). Por LID e não um `in (...)`
 * com limite: um participante falante esgotaria o limite e esconderia o outro.
 *
 * Sem nome (participante que nunca escreveu, ou cujo `raw_payload` já saiu na
 * retenção de ~14 dias) a menção fica com o número — como antes.
 */
import { useCallback, useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildMentionNameMap,
  collectMentionedJids,
  type MentionNames,
} from "@/modules/communication/lib/groupMentions";
import type { WhatsAppMessage } from "./types";

/** Teto de consultas por conversa: o resto fica com o número. */
const MAX_LOOKUPS = 10;
const NAME_STALE_MS = 10 * 60_000;
const EMPTY: MentionNames = new Map();

interface GroupThread {
  organizationId: string;
  instanceId: string;
  remoteJid: string;
}

export async function fetchGroupSenderName(thread: GroupThread, lid: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("push_name")
    .eq("organization_id", thread.organizationId)
    .eq("instance_id", thread.instanceId)
    .eq("remote_jid", thread.remoteJid)
    .eq("raw_payload->>sender_lid", lid)
    .not("push_name", "is", null)
    .order("timestamp", { ascending: false })
    .limit(1);
  if (error) throw error;
  const name = (data as Array<{ push_name: string | null }> | null)?.[0]?.push_name?.trim();
  return name || null;
}

/** A conversa de grupo, pela mensagem mais recente que a identifica. */
function groupThreadOf(messages: readonly WhatsAppMessage[]): GroupThread | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.is_group === true && m.remote_jid?.endsWith("@g.us") && m.organization_id && m.instance_id) {
      return { organizationId: m.organization_id, instanceId: m.instance_id, remoteJid: m.remote_jid };
    }
  }
  return null;
}

export function useGroupMentionNames(messages: readonly WhatsAppMessage[]): MentionNames {
  const thread = useMemo(() => groupThreadOf(messages), [messages]);
  const local = useMemo(() => (thread ? buildMentionNameMap(messages) : EMPTY), [thread, messages]);
  const missing = useMemo(
    () =>
      thread
        ? collectMentionedJids(messages)
            .filter((jid) => jid.endsWith("@lid") && !local.has(jid))
            .slice(0, MAX_LOOKUPS)
        : [],
    [thread, messages, local],
  );

  // `combine` estável: o mapa só muda quando um nome chega ou a thread muda —
  // senão cada render daria um Map novo e a lista inteira re-renderizaria.
  const combine = useCallback(
    (results: Array<UseQueryResult<string | null>>): MentionNames => {
      if (!results.some((r) => r.data)) return local;
      const merged = new Map<string, string>();
      results.forEach((r, i) => {
        if (r.data) merged.set(missing[i], r.data);
      });
      // O que veio da thread carregada é o nome mais recente: vence.
      for (const [lid, name] of local) merged.set(lid, name);
      return merged;
    },
    [local, missing],
  );

  return useQueries({
    queries: missing.map((lid) => ({
      // Raiz própria: nada sob `whatsapp_messages`, que o Realtime patcha como array de linhas.
      queryKey: ["group_mention_name", thread?.organizationId, thread?.instanceId, thread?.remoteJid, lid] as const,
      queryFn: () => fetchGroupSenderName(thread as GroupThread, lid),
      enabled: !!thread,
      staleTime: NAME_STALE_MS,
      retry: 1,
    })),
    combine,
  });
}
