/**
 * Desarquivamento otimista no cache quando o lead volta a falar.
 *
 * O banco já faz isso para todas as orgs: o trigger `trg_unarchive_on_inbound`
 * (migration 20271115000000, AFTER INSERT ON whatsapp_messages) zera
 * `whatsapp_conversations.archived_at` para mensagem `incoming`, fora de grupo,
 * fora de `history_sync`, com `timestamp >= archived_at`. O
 * cliente, porém, só via o efeito no próximo refetch (até 300 s) — o patch de
 * tempo real copiava o `archived_at` antigo e a conversa seguia em "Arquivadas"
 * com a mensagem nova dentro.
 *
 * Este predicado espelha PARTE da regra do trigger: resposta nossa
 * (`outgoing`) não reabre, grupo não reabre, e mensagem anterior ao
 * arquivamento (evento atrasado) não reabre. Data ilegível conta como "não
 * reabre" — errar para o lado de manter o estado do servidor, que o refetch
 * corrige, em vez de inventar um estado que o servidor não tem.
 *
 * O que o trigger exclui e este predicado NÃO vê: `received_via =
 * 'history_sync'`, `edited` e `deleted_at` — o tipo `WhatsAppMessage` não
 * carrega esses campos. Nesses casos o cache pode desarquivar otimista sem o
 * banco ter desarquivado; o próximo refetch devolve o estado do servidor.
 */
import type { ChatContact, WhatsAppMessage } from "../types";

type ContatoArquivavel = Pick<ChatContact, "archived_at" | "is_group">;
type MensagemRecebida = Pick<WhatsAppMessage, "direction" | "timestamp"> &
  Partial<Pick<WhatsAppMessage, "is_group" | "remote_jid">>;

const GROUP_JID_SUFFIX = "@g.us";

export function shouldUnarchiveOnInbound(
  contact: ContatoArquivavel,
  message: MensagemRecebida,
): boolean {
  if (!contact.archived_at) return false;
  if (message.direction !== "incoming") return false;
  if (contact.is_group || message.is_group) return false;
  if (message.remote_jid?.endsWith(GROUP_JID_SUFFIX)) return false;

  const archivedAt = Date.parse(contact.archived_at);
  const msgTime = Date.parse(message.timestamp);
  if (Number.isNaN(archivedAt) || Number.isNaN(msgTime)) return false;

  return msgTime >= archivedAt;
}
