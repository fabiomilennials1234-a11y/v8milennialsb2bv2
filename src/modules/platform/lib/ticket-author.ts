/**
 * Quem escreveu uma mensagem num Chamado, do ponto de vista de quem lê.
 *
 * Não é "eu ou o suporte". Um admin da Organização lê os chamados dos seus
 * membros: para ele, a mensagem do membro não é dele nem da Torque. Deduzir
 * "suporte" de "não é você" etiquetaria o próprio colega como Torque.
 */
export type TicketMessageAuthor = "voce" | "autor" | "suporte";

/**
 * "Suporte" vem da ORIGEM (`fromStaff`, carimbado pelo console do master), nunca
 * de "não é você". Deduzir suporte por exclusão etiquetaria o admin da própria
 * Organização como Torque, e trocaria o papel de um master conforme ele escreve
 * pelo console (staff) ou pelo painel do cliente em shadow (org). A identidade
 * só separa "você" de "quem abriu" dentro da Organização.
 */
export function ticketMessageAuthor(
  fromStaff: boolean,
  commentAuthorId: string | null,
  viewerId: string | undefined | null,
): TicketMessageAuthor {
  if (fromStaff) return "suporte";
  if (commentAuthorId && viewerId && commentAuthorId === viewerId) return "voce";
  return "autor";
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
