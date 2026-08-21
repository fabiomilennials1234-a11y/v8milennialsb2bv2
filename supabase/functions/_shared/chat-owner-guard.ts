/**
 * Gate de escrita do chat por responsável (PRD #1629, fatia #1635).
 *
 * O whatsapp-api-proxy já valida a fronteira de ORG. Este módulo acrescenta a
 * checagem de RESPONSÁVEL: com a política `chat_restrict_to_owner` ligada, o
 * membro não-admin só age sobre a conversa dos leads de que é responsável.
 *
 * Fechar leitura sem fechar escrita deixa o poaching de pé — e o caso concreto
 * é o vendedor que perdeu o lead na transferência e guardou o número.
 *
 * O veredito é do banco (`can_see_chat_target`), não daqui: normalização de
 * telefone e leitura do message_id moram junto do predicado, senão viram duas
 * regras que divergem. Este módulo só decide QUAIS ações têm alvo e ONDE ele
 * está em cada payload.
 *
 * A chamada usa o client do USUÁRIO — o predicado depende de auth.uid().
 */

// deno-lint-ignore-file no-explicit-any

/**
 * Ações que operam sobre uma conversa específica, e de onde sai o alvo.
 *
 * Fora desta lista, por não terem alvo: createInstance, deleteInstance,
 * getStatus, connectQR, reconfigureWebhook, logoutInstance, getMessageLimits.
 */
const TARGETED_ACTIONS = new Set([
  "sendText",
  "sendMedia",
  "sendAudio",
  "react",
  "editMessage",
  "pinMessage",
  "deleteMessage",
  "markRead",
  "sendMenu",
  "sendPixButton",
  "setPresence",
  "downloadMedia",
  "historySync",
]);

export interface ChatTarget {
  leadId: string | null;
  rawPhone: string | null;
  messageId: string | null;
}

/**
 * Extrai o alvo do payload. Devolve null quando a ação não toca conversa.
 *
 * `number` cobre os envios e as ações que mandam telefone junto do id.
 * `chat_jid` é do historySync. `message_id`/`message_ids` cobrem markRead e
 * downloadMedia, que mandam SÓ o id — são justamente os que um gate baseado em
 * telefone deixaria passar.
 */
export function extractChatTarget(
  action: string,
  payload: Record<string, unknown>,
): ChatTarget | null {
  if (!TARGETED_ACTIONS.has(action)) return null;

  const ids = payload.message_ids;
  const firstId = Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : null;

  return {
    leadId: (payload.lead_id as string | undefined) ?? null,
    rawPhone:
      (payload.number as string | undefined) ??
      (payload.chat_jid as string | undefined) ??
      null,
    messageId: (payload.message_id as string | undefined) ?? firstId,
  };
}

/**
 * Aplica o gate. `true` libera.
 *
 * Fail-closed: erro de RPC não vira liberação. Um gate que abre quando a rede
 * treme não é um gate.
 */
export async function isChatTargetAllowed(
  supabaseUser: any,
  orgId: string,
  instanceId: string | null,
  target: ChatTarget,
): Promise<boolean> {
  const { data, error } = await supabaseUser.rpc("can_see_chat_target", {
    p_org_id: orgId,
    p_lead_id: target.leadId,
    p_raw_phone: target.rawPhone,
    p_message_id: target.messageId,
    p_instance_id: instanceId,
  });

  if (error) {
    console.error(`[chat-owner-guard] RPC falhou, negando: ${error.message}`);
    return false;
  }
  return data === true;
}
