/**
 * support-unread — quantas respostas do suporte o usuário ainda não viu.
 *
 * `notifications` é uma tabela compartilhada: reuniões do dia, leads
 * transferidos, respostas de Chamado. O `type` é o que separa, e `entity_id`
 * aponta para o Chamado (ADR-0018, migration 20270118).
 *
 * Lógica pura: sem React, sem rede.
 */

export const SUPPORT_REPLY_TYPE = "support_ticket_reply";
/** Notificação endereçada ao staff quando o cliente responde (ADR-0021, S3). */
export const SUPPORT_CUSTOMER_REPLY_TYPE = "support_ticket_customer_reply";

export interface UnreadNotificationRow {
  type: string;
  entity_id: string | null;
}

export interface UnreadSummary {
  /** Contagem por `support_tickets.id`. */
  byTicket: Record<string, number>;
  /** Soma das contagens — não o número de chamados. */
  total: number;
}

export function summarizeUnreadReplies(
  rows: UnreadNotificationRow[],
  type: string = SUPPORT_REPLY_TYPE,
): UnreadSummary {
  const byTicket: Record<string, number> = {};
  let total = 0;

  for (const row of rows) {
    if (row.type !== type) continue;
    // `entity_id` é nullable: uma linha antiga ou malformada não vira uma chave
    // "null" no mapa.
    if (!row.entity_id) continue;

    byTicket[row.entity_id] = (byTicket[row.entity_id] ?? 0) + 1;
    total += 1;
  }

  return { byTicket, total };
}
