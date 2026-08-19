/**
 * A linha das RPCs de lista das caixas que leem `channel_messages`, e o mapeamento
 * dela para `SocialContact`. PURO — sem rede, sem React.
 *
 * ─── POR QUE UMA FORMA SÓ PARA DUAS RPCs ────────────────────────────────────
 *
 * `get_social_conversation_list` (Instagram, eixo `messaging_channel_id`) e
 * `get_official_whatsapp_conversation_list` (canal oficial, eixo `instance_id`)
 * são funções distintas porque o GATE de tenancy delas resolve tabelas
 * diferentes — a social recusa com 42501 o uuid de uma instância de WhatsApp.
 * Mas o `RETURNS TABLE` das duas é o MESMO, de propósito: é o que permite uma
 * lista, uma view e um mapeamento só.
 *
 * Duas cópias deste mapeamento divergiriam na primeira coluna nova — foi assim
 * que `contact_handle` chegou torto em 18/08, com a normalização existindo e não
 * sendo chamada no ponto que decide.
 */
import { buildSocialConversationKey, type SocialContact } from "./types";

/** Linha crua da RPC. Espelha o RETURNS TABLE das duas funções. */
export interface SocialConversationRow {
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

export function toSocialContact(
  row: SocialConversationRow,
  channel: SocialContact["channel"],
  /**
   * O id da CAIXA: `messaging_channels.id` no Instagram,
   * `whatsapp_instances.id` no canal oficial.
   */
  boxId: string,
): SocialContact {
  return {
    channel,
    conversation_key: buildSocialConversationKey(
      channel,
      boxId,
      row.contact_external_id,
    ),
    messaging_channel_id: boxId,
    external_user_id: row.contact_external_id,
    // O @ do INTERLOCUTOR, em coluna própria (`contact_handle`, migration
    // 20270818090000). Até a primeira mensagem real chegar, este campo era `null`
    // com um comentário dizendo que o payload não trazia o handle — o corpo
    // provou o contrário: ele vem em `message.visitor.name`.
    //
    // ⚠️ NÃO confundir com `messaging_channels.handle`, que é o @ da NOSSA conta.
    // São entidades diferentes, e trocá-las poria o nosso @ no lugar do cliente.
    //
    // No canal oficial a coluna é NULA por desenho: WhatsApp não tem @, e ali o
    // mesmo campo do fornecedor carrega o NOME — que o `pickContact` do #1651
    // manda para `sender_name`.
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
