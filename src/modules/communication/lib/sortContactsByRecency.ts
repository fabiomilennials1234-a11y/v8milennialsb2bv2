/**
 * Ordena a lista de conversas do inbox por recência — a MESMA ordem que o
 * servidor devolve.
 *
 * ── Por que isso existe ──
 * `get_whatsapp_conversation_list` termina com `ORDER BY p.last_message_time
 * DESC` (conferido em prod). O patch de realtime do inbox
 * (`useWhatsAppRealtime.ts`), porém, atualizava o contato com
 * `prev.map((c, idx) => idx !== existingIdx ? c : {...})`: gravava o
 * `last_message_time` novo NO MESMO ÍNDICE e devolvia o array na ordem antiga.
 *
 * O efeito no cliente é o chamado "o chat não atualiza": chega mensagem, a
 * conversa não sobe. E como a lista virtualiza acima de 50 conversas
 * (`ConversationList.tsx`), numa org com 130+ só ~10 linhas são renderizadas —
 * mensagem numa conversa fora da janela visível não mudava UM PIXEL. Só o
 * refetch de 20s reordenava, e com a aba em segundo plano nem isso
 * (`refetchIntervalInBackground` é false por padrão e `App.tsx` desliga o
 * `refetchOnWindowFocus`).
 *
 * A bolha flutuante nunca teve o bug porque reordena no próprio memo
 * (`ChatBubbleConversationList.tsx`). O inbox era o único que não.
 *
 * ── Contrato ──
 * Devolve SEMPRE um array novo (o cache do TanStack Query trata mutação in
 * place como "não mudou"). A ordenação é estável, então empate de
 * `last_message_time` — que tem precisão de segundo e empata de verdade —
 * preserva a ordem anterior em vez de embaralhar a lista a cada patch.
 * Timestamp ausente ou inválido vai para o fim, nunca para o topo: conversa
 * sem data não pode roubar o lugar de quem acabou de responder.
 */

export interface HasLastMessageTime {
  last_message_time: string | null | undefined;
}

function toEpoch(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export function sortContactsByRecency<T extends HasLastMessageTime>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) => toEpoch(b.last_message_time) - toEpoch(a.last_message_time));
}
