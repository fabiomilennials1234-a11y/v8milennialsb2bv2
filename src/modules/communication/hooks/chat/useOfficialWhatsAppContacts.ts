/**
 * useOfficialWhatsAppContacts — lista de conversas da caixa de WhatsApp oficial.
 *
 * Irmão de `useSocialContacts`, com a MESMA forma de retorno e outra RPC.
 *
 * ─── POR QUE NÃO É UM PARÂMETRO A MAIS NAQUELE HOOK ─────────────────────────
 *
 * `get_social_conversation_list` resolve o argumento contra `messaging_channels`
 * e o canal oficial mora em `whatsapp_instances`: passar o uuid da instância ali
 * levanta 42501 antes de ler mensagem nenhuma. Além do gate, a CTE daquela função
 * filtra `messaging_channel_id`, que é NULL em todas as linhas desta caixa. São
 * duas RPCs porque são dois eixos de leitura — não por gosto de simetria.
 *
 * ─── O QUE VEM DE GRAÇA ─────────────────────────────────────────────────────
 *
 * A queryKey usa a MESMA raiz da lista social (`social_contacts`), com o id da
 * instância na posição do canal. `useSocialRealtime` invalida por PREFIXO de raiz
 * e observa `channel_messages` — a tabela onde esta caixa recebe. Realtime,
 * portanto, não custa uma linha de código aqui (decisão Q10 do spec).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { chatQueryKeys } from "./shared/queryKeys";
import {
  toSocialContact,
  type SocialConversationRow,
} from "./social-conversation-row";
import type { SocialContact } from "./types";

export function useOfficialWhatsAppContacts(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: chatQueryKeys.socialContacts(organizationId, instanceId),
    queryFn: async (): Promise<SocialContact[]> => {
      if (!organizationId || !instanceId) return [];

      // Cast do CLIENTE: a RPC é nova e `src/integrations/supabase/types.ts` só a
      // conhece depois do regen contra o banco onde a migration entrou. O shape
      // continua declarado em `SocialConversationRow`, para que uma coluna
      // renomeada apareça como erro de tipo aqui e não como `undefined` na tela.
      const { data, error } = await (supabase as any).rpc(
        "get_official_whatsapp_conversation_list",
        {
          p_org: organizationId,
          p_instance: instanceId,
          p_limit: 200,
        },
      );
      if (error) throw error;

      return ((data ?? []) as SocialConversationRow[]).map((row) =>
        toSocialContact(row, "whatsapp_oficial", instanceId),
      );
    },
    enabled: !!organizationId && !!instanceId,
    staleTime: 30_000,
  });
}
