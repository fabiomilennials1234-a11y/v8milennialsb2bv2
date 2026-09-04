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
}

export interface PayloadDoAgente {
  from: string;
  message: string;
  channel: "whatsapp";
  organization_id: string;
  incoming_message_type: "text";
  instance_id: string | null;
}

export function montarPayloadDoAgente(entrada: EntradaDoPayload): PayloadDoAgente {
  return {
    from: entrada.phone,
    message: entrada.content,
    channel: "whatsapp",
    organization_id: entrada.orgId,
    incoming_message_type: "text",
    // Nulo explícito, nunca um palpite: o batch é agrupado por telefone+org e
    // não por Instance. Sem a Instance o matcher reprova por fail-closed, que é
    // o comportamento certo — melhor não disparar do que disparar achando que
    // veio do número escolhido.
    instance_id: entrada.instanceId,
  };
}
