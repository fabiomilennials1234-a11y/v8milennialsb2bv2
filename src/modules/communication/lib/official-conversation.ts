/**
 * A conversa que ainda NÃO existe — primeiro contato pela caixa de WhatsApp
 * oficial.
 *
 * ─── POR QUE PRECISA DE CÓDIGO ──────────────────────────────────────────────
 *
 * No WhatsApp por QR, abrir uma conversa nova é trivial: a tela trabalha com o
 * TELEFONE, e telefone sempre existe. Na caixa oficial a identidade da conversa é
 * `(instância, interlocutor)` e a lista vem de uma RPC que só devolve quem JÁ
 * trocou mensagem — quem nunca trocou não tem linha, e sem linha não há o que
 * selecionar.
 *
 * Resultado medido em produção (19/08): clicar em "Iniciar conversa por → Chiquê"
 * no funil levava ao chat e não abria nada. A conversa não estava "escondida":
 * ela não existia em lugar nenhum, e o produto não tinha como representá-la.
 *
 * Este módulo cria essa representação — um contato SINTÉTICO, que existe só na
 * tela até a primeira mensagem sair. Quando ela sai, o provider grava a linha e o
 * contato real toma o lugar deste, com a mesma `conversation_key`.
 */
import { formatPhoneForWhatsApp } from "./whatsapp";
import {
  buildSocialConversationKey,
  type SocialContact,
} from "../hooks/chat/types";

/**
 * A chave da conversa a partir de um telefone qualquer do CRM.
 *
 * `null` quando o telefone não é um celular brasileiro válido — o mesmo critério
 * do resto do produto (`formatPhoneForWhatsApp`), e não um mais frouxo: abrir uma
 * conversa para um número que a Meta vai recusar é empurrar a falha para depois
 * do texto digitado.
 */
export function chaveDeConversaOficial(
  instanceId: string | null | undefined,
  telefone: string | null | undefined,
): string | null {
  if (!instanceId) return null;
  const normalizado = formatPhoneForWhatsApp(telefone ?? undefined);
  if (!normalizado) return null;
  return buildSocialConversationKey("whatsapp_oficial", instanceId, normalizado);
}

/**
 * O contato sintético de uma conversa que ainda não tem mensagem.
 *
 * Devolve `null` quando a chave não é desta caixa — e essa checagem é o ponto:
 * sem ela, uma chave de Instagram (ou de outra instância) produziria uma conversa
 * fantasma endereçada ao canal errado.
 */
export function contatoDeConversaNova(
  conversationKey: string | null | undefined,
  instanceId: string | null | undefined,
  /** Nome do lead, quando quem abriu a conversa o conhece. */
  nome?: string | null,
): SocialContact | null {
  if (!conversationKey || !instanceId) return null;

  const prefixo = `whatsapp_oficial:${instanceId}:`;
  if (!conversationKey.startsWith(prefixo)) return null;

  const interlocutor = conversationKey.slice(prefixo.length).trim();
  if (!interlocutor) return null;

  return {
    channel: "whatsapp_oficial",
    conversation_key: conversationKey,
    messaging_channel_id: instanceId,
    external_user_id: interlocutor,
    handle: null,
    display_name: nome?.trim() || null,
    avatar_url: null,
    // Sem mensagem, sem prévia. `null` é a resposta honesta — inventar "Nova
    // conversa" aqui faria a lista lateral exibir isso como se fosse a última
    // mensagem trocada.
    last_message: null,
    last_message_time: new Date().toISOString(),
    last_message_direction: null,
    unread_count: 0,
    lead_id: null,
    lead_name: nome?.trim() || null,
    tags: [],
  };
}
