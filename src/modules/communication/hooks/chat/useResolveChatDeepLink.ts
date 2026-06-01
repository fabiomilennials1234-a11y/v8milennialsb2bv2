/**
 * useResolveChatDeepLink — resolver de `?phone=&instance=` para o chat WhatsApp.
 *
 * Dado um phone (raw da URL), encontra a instância correta dentro das instâncias
 * permitidas ao usuário onde existe conversa para esse telefone. Comparação
 * sempre por telefone normalizado (mesma lógica de `normalize_brazilian_phone`).
 *
 * Segurança:
 *   - Filtra por `organization_id` do usuário atual.
 *   - Restringe `instance_id` à lista permitida (`useWhatsAppInstancesForUser`).
 *   - Nunca seleciona instância fora dessa lista, mesmo se URL pedir.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { noRetryOnTimeout } from "@/integrations/supabase/noRetryOnTimeout";
import { useCurrentTeamMember } from "@/modules/identity";
import { normalizePhone } from "@/lib/normalizePhone";
import type { WhatsAppInstanceForUser } from "./types";

export interface ResolveChatDeepLinkResult {
  /** Instância onde a conversa existe (sempre dentro das permitidas) */
  instanceId: string;
  /** phone_number canônico encontrado em whatsapp_messages */
  phoneNumber: string;
}

interface UseResolveChatDeepLinkArgs {
  /** Telefone vindo da query string (?phone=) — pode estar com ou sem 55 */
  phone: string | null;
  /** Lista de instâncias permitidas ao usuário corrente */
  allowedInstances: WhatsAppInstanceForUser[];
  enabled?: boolean;
}

/**
 * Resolve qual instância (entre as permitidas) tem conversa para o phone alvo.
 * Retorna `null` quando não há mensagem para esse phone em nenhuma instância
 * permitida, ou quando faltam pré-requisitos (org/instâncias).
 */
export function useResolveChatDeepLink({
  phone,
  allowedInstances,
  enabled = true,
}: UseResolveChatDeepLinkArgs) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  const target = normalizePhone(phone ?? null);
  const allowedIds = allowedInstances.map((i) => i.id).sort();

  return useQuery<ResolveChatDeepLinkResult | null>({
    queryKey: [
      "chat-deep-link",
      organizationId,
      target,
      allowedIds.join(","),
    ],
    queryFn: async () => {
      if (!organizationId || !target || allowedIds.length === 0) return null;

      // Match exato contra coluna `normalized_phone` (preenchida via trigger
      // `normalize_whatsapp_message_phone` — migration 20260908200000).
      // Index `(organization_id, normalized_phone)` torna esse lookup O(log n)
      // em vez do seq scan que `LIKE '%last8%'` causava (timeout 8s em orgs
      // grandes).
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("instance_id, phone_number, timestamp")
        .eq("organization_id", organizationId)
        .eq("normalized_phone", target)
        .in("instance_id", allowedIds)
        .not("instance_id", "is", null)
        .order("timestamp", { ascending: false })
        .limit(1);

      if (error) throw error;
      if (!data?.length) return null;

      const row = data[0];
      // Defesa em profundidade: instância tem que estar na lista permitida,
      // mesmo após o filtro server-side.
      if (!row.instance_id || !allowedIds.includes(row.instance_id)) return null;
      return {
        instanceId: row.instance_id,
        phoneNumber: row.phone_number,
      };
    },
    enabled:
      enabled &&
      !!organizationId &&
      !!target &&
      allowedIds.length > 0,
    staleTime: 30_000,
    retry: noRetryOnTimeout,
  });
}
