/**
 * Query canônica de mensagens de uma conversa WhatsApp.
 *
 * Fonte única usada por `useWhatsAppMessages` (inbox + bubble) e por
 * `prefetchChatData` — qualquer divergência entre os dois causava refetch
 * duplicado E, historicamente, o bug de "mensagens somem".
 *
 * ── Por que filtrar por `normalized_phone` e não por `phone_number` ──
 * A mesma pessoa tem mensagens gravadas em MAIS DE UM formato de
 * `phone_number` na tabela: o webhook inbound grava o JID normalizado da
 * Uazapi (`55` + DDD + número), enquanto o primeiro outbound (copilot/manual,
 * antes do lead responder) grava o `lead.phone` cru — que muitas orgs guardam
 * SEM o `55`. Resultado: `.eq("phone_number", <um formato>)` só devolvia
 * metade da thread (a que casava o formato exato), e o realtime — que casa por
 * telefone NORMALIZADO — inseria mensagens que o refetch depois apagava.
 *
 * A coluna `normalized_phone` (trigger `normalize_brazilian_phone`, 100%
 * populada — 1.6M linhas, 0 nulos) colapsa todos os formatos numa identidade
 * única. Filtrar por ela devolve a thread inteira, independentemente do
 * formato de origem, e alinha o fetch ao realtime (que já usa `normalizePhone`
 * de `@/lib/normalizePhone`, espelho fiel da função do Postgres).
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import type { WhatsAppMessage } from "@/modules/communication/hooks/chat/types";

/** Colunas devolvidas pra o chat. Mantém em sync hook + prefetch. */
export const WHATSAPP_MESSAGE_COLUMNS =
  "id, organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, media_url, media_expired, push_name, status, lead_id, timestamp, created_at, sent_by_ai, sent_source";

export interface FetchConversationMessagesParams {
  organizationId: string;
  instanceId: string;
  /** Telefone em qualquer formato — é normalizado antes do filtro. */
  phoneNumber: string;
}

/**
 * Busca todas as mensagens de uma conversa (org + instância + telefone),
 * ordenadas por timestamp ascendente. Filtra por `normalized_phone` pra
 * capturar a thread inteira mesmo com formatos divergentes de `phone_number`.
 */
export async function fetchConversationMessages(
  params: FetchConversationMessagesParams,
): Promise<WhatsAppMessage[]> {
  const { organizationId, instanceId, phoneNumber } = params;

  const normalized = normalizePhone(phoneNumber);
  // Telefone impossível de normalizar (vazio/inválido) → sem conversa.
  if (!normalized) return [];

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(WHATSAPP_MESSAGE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("instance_id", instanceId)
    .eq("normalized_phone", normalized)
    .order("timestamp", { ascending: true });

  if (error) throw error;
  return data as WhatsAppMessage[];
}
