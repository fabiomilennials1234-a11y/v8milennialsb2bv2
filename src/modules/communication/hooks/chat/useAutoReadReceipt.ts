/**
 * useAutoReadReceipt — manda o read receipt (tique azul) para o contato quando
 * o operador abre a conversa no CRM.
 *
 * ── Por que existe ─────────────────────────────────────────────────────────
 * Abrir a conversa só gravava `conversation_read_state` via a RPC
 * `mark_conversation_read` — que é o badge INTERNO do CRM e não faz nenhuma
 * chamada HTTP. Ou seja: o CRM nunca avisava o WhatsApp. O único caminho que
 * falava com a Uazapi era o botão manual por mensagem, e ele mandava payload
 * inválido (400). Resultado: o contato nunca via os dois tiques azuis, em
 * nenhuma das orgs.
 *
 * ── Cuidados ───────────────────────────────────────────────────────────────
 * - Só instâncias Uazapi (Evolution e Meta Cloud lançam NotSupportedError).
 * - Nunca em grupo — marcar grupo inteiro como lido é ruidoso e não é o pedido.
 * - Dedupe por (instância, message_id) num Set de módulo: o efeito rearma a
 *   cada troca de conversa e a cada chegada de mensagem nova via realtime.
 * - Fire-and-forget: falhar em marcar como lida NUNCA pode quebrar o chat.
 * - Teto por lote — thread antiga tem centenas de mensagens e não faz sentido
 *   mandar tudo; as mais recentes bastam (o WhatsApp marca em cascata).
 */
import { useEffect, useRef } from "react";
import { markMessageRead } from "../../lib/whatsappApi";
import { useInstanceCapabilities } from "../useInstanceCapabilities";

/** Teto de ids por chamada — thread longa não precisa ir inteira. */
const MAX_IDS_POR_LOTE = 30;

/**
 * Ids já enviados nesta sessão de browser. Fora do componente de propósito:
 * o chat remonta ao trocar de conversa e um ref por instância reenviaria tudo.
 */
const jaEnviados = new Set<string>();

/** Só para teste — zera o dedupe entre casos. */
export function _resetReadReceiptCache(): void {
  jaEnviados.clear();
}

export interface AutoReadReceiptMessage {
  message_id: string | null;
  direction: string;
  /** Guarda por mensagem — vale mesmo quando o chamador não sabe se é grupo. */
  is_group?: boolean | null;
}

export function useAutoReadReceipt(params: {
  instanceId: string | null | undefined;
  /** Telefone da conversa aberta — só serve para rearmar o efeito na troca. */
  phone: string | null | undefined;
  messages: AutoReadReceiptMessage[] | undefined;
  /** `true` quando a conversa aberta é um grupo — não marca. */
  isGroup?: boolean;
  enabled?: boolean;
}): void {
  const { instanceId, phone, messages, isGroup = false, enabled = true } = params;
  const { canUseUazapiActions } = useInstanceCapabilities(instanceId);

  // Evita corrida: se o efeito rodar de novo antes da chamada anterior voltar,
  // os ids já estão no Set, então não há envio duplicado.
  const enviando = useRef(false);

  useEffect(() => {
    if (!enabled || !instanceId || !phone || isGroup) return;
    if (!canUseUazapiActions) return;
    if (!messages || messages.length === 0) return;
    if (enviando.current) return;

    const pendentes: string[] = [];
    // De trás pra frente: as mais recentes são as que importam.
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.direction !== "incoming") continue;
      if (m.is_group) continue;
      if (!m.message_id) continue;
      const chave = `${instanceId}:${m.message_id}`;
      if (jaEnviados.has(chave)) continue;
      pendentes.push(m.message_id);
      if (pendentes.length >= MAX_IDS_POR_LOTE) break;
    }
    if (pendentes.length === 0) return;

    // Marca ANTES de enviar: se a chamada falhar, não reenviamos em loop a cada
    // render. O botão manual e a próxima mensagem cobrem o caso raro de perda.
    for (const id of pendentes) jaEnviados.add(`${instanceId}:${id}`);

    enviando.current = true;
    void markMessageRead(instanceId, pendentes)
      .catch(() => {
        /* tique azul é acessório — nunca quebra o chat */
      })
      .finally(() => {
        enviando.current = false;
      });
  }, [enabled, instanceId, phone, messages, isGroup, canUseUazapiActions]);
}
