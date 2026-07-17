/**
 * Quem escreveu uma mensagem num Chamado, do ponto de vista de quem lê.
 *
 * Não é "eu ou o suporte". Um admin da Organização lê os chamados dos seus
 * membros: para ele, a mensagem do membro não é dele nem da Torque. Deduzir
 * "suporte" de "não é você" etiquetaria o próprio colega como Torque.
 */
export type TicketMessageAuthor = "voce" | "autor" | "suporte";

export function ticketMessageAuthor(
  commentAuthorId: string | null,
  ticketAuthorId: string | null,
  viewerId: string | undefined | null,
): TicketMessageAuthor {
  if (commentAuthorId && viewerId && commentAuthorId === viewerId) return "voce";
  if (commentAuthorId && ticketAuthorId && commentAuthorId === ticketAuthorId) return "autor";
  return "suporte";
}

export const TICKET_AUTHOR_LABELS: Record<TicketMessageAuthor, string> = {
  voce: "Você",
  autor: "Quem abriu o chamado",
  suporte: "Suporte Torque",
};

/** Mensagens da Organização alinham à direita; as da Torque, à esquerda. */
export function isFromOrganization(author: TicketMessageAuthor): boolean {
  return author !== "suporte";
}
