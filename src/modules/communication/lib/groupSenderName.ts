/**
 * Nome de quem escreveu, para o balão de uma mensagem de GRUPO.
 *
 * Só mensagem RECEBIDA de grupo tem remetente a identificar: na saída o autor
 * somos nós, e em 1:1 o interlocutor já é o título da conversa. Sem `push_name`
 * (cerca de 0,2% das mensagens de grupo) não se mostra nada: nunca "undefined",
 * nunca o telefone cru.
 *
 * O nome aparece só na PRIMEIRA mensagem de uma sequência do mesmo remetente —
 * como no WhatsApp. `anterior` é a mensagem imediatamente acima na thread (ou
 * `null` quando não há uma, ou quando um separador de dia as divide).
 */
export interface GroupSenderFields {
  direction: string;
  is_group?: boolean | null;
  push_name?: string | null;
}

function nomeLimpo(m: GroupSenderFields | null | undefined): string | null {
  if (!m || m.is_group !== true || m.direction !== "incoming") return null;
  const nome = typeof m.push_name === "string" ? m.push_name.trim() : "";
  return nome || null;
}

export function groupSenderName(
  mensagem: GroupSenderFields,
  anterior: GroupSenderFields | null,
): string | null {
  const nome = nomeLimpo(mensagem);
  if (!nome) return null;
  return nomeLimpo(anterior) === nome ? null : nome;
}
