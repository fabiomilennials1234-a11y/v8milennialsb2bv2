/**
 * Payload que a fila do Copilot entrega ao `agent-message`.
 *
 * Existe como módulo próprio por um motivo só: é o ponto onde a identidade da
 * Instance entra na SEGUNDA porta de entrada do `agent-message`. A primeira é
 * o fetch direto do `whatsapp-webhook`; a fila é a que está sendo ligada por
 * org no rollout canário (`COPILOT_QUEUE_ENABLED_ORGS`).
 *
 * O gatilho `lead_replied` filtra por número de origem e dispara lá dentro do
 * `agent-message`. Se só uma das portas carregar a Instance, o filtro funciona
 * para umas orgs e falha em silêncio para as outras — o pior modo de falha
 * possível para uma automação.
 */

export interface EntradaDoPayload {
  phone: string;
  orgId: string;
  content: string;
  /** `null` quando a linha da fila não resolveu a Instance. */
  instanceId: string | null;
  /**
   * Mídia da mensagem mais recente do batch, já resolvida para a cópia no
   * Storage. Sem isto o `agent-message` chama `resolveMediaContent` com
   * `mediaUrl: null` e devolve placeholder — ou nada, quando a mensagem é só
   * áudio e `content` vem vazio.
   */
  mediaUrl?: string | null;
  /** Tipo REAL da mensagem (`ptt`, `image`, `document`…), não um palpite. */
  incomingMessageType?: string | null;
  messageContext?: { storage: "whatsapp_messages"; messageId: string; messageIds?: string[]; boxId: string; provider: string; participantId: string } | null;
}

export interface PayloadDoAgente {
  from: string;
  message: string;
  channel: "whatsapp";
  organization_id: string;
  incoming_message_type: string;
  media_url?: string | null;
  instance_id: string | null;
  message_context?: EntradaDoPayload["messageContext"];
}

export function montarPayloadDoAgente(entrada: EntradaDoPayload): PayloadDoAgente {
  return {
    from: entrada.phone,
    message: entrada.content,
    channel: "whatsapp",
    organization_id: entrada.orgId,
    // Fixar "text" aqui apagava TODA resposta em áudio/imagem/documento: o
    // `content` de um `ptt` vem vazio, o agente recebia string vazia e o turno
    // morria sem erro nenhum. Medido na Macerados em 16/11/2026 — a lead
    // respondeu a saudação com um áudio e ninguém nunca soube.
    incoming_message_type: entrada.incomingMessageType || "text",
    ...(entrada.mediaUrl ? { media_url: entrada.mediaUrl } : {}),
    // Nulo explícito, nunca um palpite: o batch é agrupado por telefone+org e
    // não por Instance. Sem a Instance o matcher reprova por fail-closed, que é
    // o comportamento certo — melhor não disparar do que disparar achando que
    // veio do número escolhido.
    instance_id: entrada.instanceId,
    ...(entrada.messageContext ? { message_context: entrada.messageContext } : {}),
  };
}
