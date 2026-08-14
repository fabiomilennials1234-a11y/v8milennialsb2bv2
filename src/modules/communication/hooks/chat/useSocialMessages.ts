/**
 * useSocialMessages — mensagens de uma conversa social (Instagram).
 *
 * SEM RPC: lê `channel_messages` direto, sob a RLS que já existe
 * (`channel_messages_org_access` + `master_all_channel_messages`). A LISTA
 * precisa de RPC porque faz `DISTINCT ON` e junta read-state; a THREAD é um
 * `select ... where` que a policy já recorta.
 *
 * ⚠️ O GATE DESTA THREAD É O MESMO DA LISTA — e isso é uma DEPENDÊNCIA, não uma
 * coincidência. `channel_messages_org_access` usava `get_user_organization_id()`
 * (singular, legado: `LIMIT 1` na org mais ANTIGA do usuário) enquanto a RPC da
 * lista usa `get_my_organization_ids() + is_master_user()`. Para usuário
 * multi-org operando fora da org mais antiga, a lista devolvia as conversas e
 * esta thread devolvia ZERO LINHAS — a conversa aparecia na lista e abria EM
 * BRANCO, sem erro (sucesso com zero linhas é indistinguível de conversa vazia).
 * `20270816110000_channel_messages_multi_org_read.sql` alinha a policy no mesmo
 * recorte da lista, e é por isso que o `select` direto aqui está correto.
 *
 * ⚠️ ESTE HOOK NÃO FUNCIONA SEM AQUELA MIGRATION. Ambiente onde ela não entrou
 * reproduz o sintoma acima para todo usuário multi-org — e só para ele, que é o
 * que torna isto invisível em teste feito com conta de uma org só.
 *
 * A mesma policy é o gate de `apply_rls()` no Realtime: consertá-la na policy,
 * e não transformando esta thread em RPC, é o que também desmuta
 * `useSocialRealtime` e `useIncomingMessageToast` para esse usuário. Uma RPC
 * aqui teria consertado a tela e deixado os dois cegos.
 *
 * O recorte é `(organization_id, messaging_channel_id, contact_external_id)`.
 * `contact_external_id` é o INTERLOCUTOR, independente de direção — e é por isso
 * que ele existe em vez de reaproveitar `sender_id`: o `chat-meta` casa thread
 * por `sender_id = external_user_id` e, com isso, mensagem de SAÍDA (onde o
 * sender é a nossa página) nunca aparece na conversa. Não copiar.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { chatQueryKeys } from "./shared/queryKeys";

/** Teto de linhas por thread. Paginação para trás é fatia própria. */
const THREAD_LIMIT = 500;

export interface SocialMessage {
  id: string;
  external_id: string;
  direction: "incoming" | "outgoing";
  message_type: string;
  content: string | null;
  media_url: string | null;
  status: string | null;
  sender_name: string | null;
  sender_profile_pic: string | null;
  timestamp: string;
  created_at: string | null;
}

export function useSocialMessages(
  messagingChannelId: string | null,
  contactExternalId: string | null,
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: chatQueryKeys.socialMessages(
      organizationId,
      messagingChannelId,
      contactExternalId,
    ),
    queryFn: async (): Promise<SocialMessage[]> => {
      if (!organizationId || !messagingChannelId || !contactExternalId) return [];

      // Cast do CLIENTE: `messaging_channel_id` e `contact_external_id` são
      // colunas novas e `types.ts` só as conhece depois do regen contra o banco
      // onde a migration entrou. O shape continua declarado em `SocialMessage`.
      const { data, error } = await (supabase as any)
        .from("channel_messages")
        .select(
          "id, external_id, direction, message_type, content, media_url, status, sender_name, sender_profile_pic, timestamp, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("messaging_channel_id", messagingChannelId)
        .eq("contact_external_id", contactExternalId)
        .order("timestamp", { ascending: true })
        .limit(THREAD_LIMIT);

      if (error) throw error;
      return (data ?? []) as SocialMessage[];
    },
    enabled: !!organizationId && !!messagingChannelId && !!contactExternalId,
  });
}
