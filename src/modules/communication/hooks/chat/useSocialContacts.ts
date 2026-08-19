/**
 * useSocialContacts — lista de conversas de um canal social (Instagram).
 *
 * Irmão de `useWhatsAppContacts`, e deliberadamente MUITO menor.
 *
 * FONTE: a RPC `get_social_conversation_list`, que faz `DISTINCT ON
 * (contact_external_id)` direto em `channel_messages`. Não há tabela-resumo:
 * `whatsapp_conversation_summary` é alimentada por trigger em
 * `whatsapp_messages` e nunca verá uma linha de `channel_messages`. Com zero
 * mensagens de Instagram em produção hoje, montar resumo + trigger seria
 * mecanismo caro que precisa estar CERTO antes de existir tráfego que o ensine.
 *
 * SEM FANOUT DE ENRIQUECIMENTO. O irmão de WhatsApp dispara uma segunda leva de
 * queries para descobrir nome de lead e etiqueta; aqui o lead vem JUNTO, no
 * mesmo `RETURNS TABLE` — a RPC faz LEFT JOIN em `lead_social_identities` (a
 * fonte da verdade do vínculo) e devolve `lead_id` + `lead_name`. É por isso
 * que `lead_name` mora na linha da RPC em vez de virar uma segunda query: o
 * enriquecimento em lote é justamente o que produz a janela em que a lista
 * aparece sem nome.
 *
 * Etiqueta continua `[]`: hoje ela pendura em lead ou em conversa de WhatsApp.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { chatQueryKeys } from "./shared/queryKeys";
import { buildSocialConversationKey, type SocialContact } from "./types";

/** Linha crua da RPC. Espelha o RETURNS TABLE da função. */
interface SocialConversationRow {
  contact_external_id: string;
  sender_name: string | null;
  sender_profile_pic: string | null;
  /** @ do interlocutor — entra no RETURNS a partir de 20270818090000. */
  contact_handle: string | null;
  last_message: string | null;
  last_message_time: string;
  last_message_direction: string | null;
  unread_count: number | null;
  lead_id: string | null;
  lead_name: string | null;
}

function toSocialContact(
  row: SocialConversationRow,
  messagingChannelId: string,
): SocialContact {
  return {
    channel: "instagram",
    conversation_key: buildSocialConversationKey(
      "instagram",
      messagingChannelId,
      row.contact_external_id,
    ),
    messaging_channel_id: messagingChannelId,
    external_user_id: row.contact_external_id,
    // O @ do INTERLOCUTOR, agora em coluna própria (`contact_handle`, migration
    // 20270818090000). Até a primeira mensagem real chegar, este campo era `null`
    // com um comentário dizendo que o payload não trazia o handle — o corpo
    // provou o contrário: ele vem em `message.visitor.name`.
    //
    // ⚠️ NÃO confundir com `messaging_channels.handle`, que é o @ da NOSSA conta.
    // São entidades diferentes, e trocá-las poria o nosso @ no lugar do cliente.
    handle: row.contact_handle ?? null,
    display_name: row.sender_name ?? null,
    avatar_url: row.sender_profile_pic ?? null,
    last_message: row.last_message ?? null,
    last_message_time: row.last_message_time,
    // O CHECK do banco só aceita incoming|outgoing; qualquer outra coisa é dado
    // que não sabemos ler, e "não sei" é null — nunca "incoming" por default.
    last_message_direction:
      row.last_message_direction === "incoming" ||
      row.last_message_direction === "outgoing"
        ? row.last_message_direction
        : null,
    unread_count: row.unread_count ?? 0,
    lead_id: row.lead_id ?? null,
    lead_name: row.lead_name ?? null,
    tags: [],
  };
}

export function useSocialContacts(messagingChannelId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: chatQueryKeys.socialContacts(organizationId, messagingChannelId),
    queryFn: async (): Promise<SocialContact[]> => {
      if (!organizationId || !messagingChannelId) return [];

      // A RPC ainda não está em `src/integrations/supabase/types.ts` — o arquivo
      // é gerado do banco e só é regenerado depois do apply. O cast é do
      // CLIENTE; o shape devolvido continua declarado em `SocialConversationRow`
      // para que uma coluna renomeada apareça como erro de tipo aqui e não como
      // `undefined` na tela. Mesmo precedente de `useMessagingChannels.ts`.
      const { data, error } = await (supabase as any).rpc(
        "get_social_conversation_list",
        {
          p_org: organizationId,
          p_channel: messagingChannelId,
          p_limit: 200,
        },
      );
      if (error) throw error;

      return ((data ?? []) as SocialConversationRow[]).map((row) =>
        toSocialContact(row, messagingChannelId),
      );
    },
    enabled: !!organizationId && !!messagingChannelId,
    staleTime: 30_000,
  });
}
