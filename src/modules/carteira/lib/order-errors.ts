/**
 * Carteira — tradução dos erros da RPC de edição de pedido.
 *
 * `carteira_update_order` levanta mensagens estáveis em snake_case
 * (`order_erp_linked`, `order_state_changed`, …) em vez de texto para humano:
 * texto no banco não é traduzível, não é testável e vaza detalhe de schema.
 * A tradução vive aqui, num lugar só, e é o que o toast mostra.
 *
 * Sem este mapa o usuário veria o erro cru do Postgres — foi exatamente o que
 * acontecia com os CHECKs de `sale_value` antes desta fatia.
 */

const MESSAGES: Record<string, string> = {
  order_not_found:
    "Pedido não encontrado. Ele pode ter sido removido — atualize a lista.",
  // O gate é PROCEDÊNCIA, não nota fiscal: a mensagem nunca manda cancelar uma
  // NF-e, porque 232 dos pedidos bloqueados em prod não têm nota nenhuma.
  order_erp_linked:
    "Pedido sincronizado do ERP. Edite no sistema de origem — o CRM não altera pedidos do ERP.",
  order_state_changed:
    "O pedido mudou enquanto você editava. Atualize a lista e refaça a alteração.",
  order_not_approved:
    "Só pedidos aprovados podem ser editados. Atualize a lista.",
  invalid_patch_field:
    "Campo não editável enviado. Recarregue a página e tente de novo.",
  invalid_sale_value: "O valor da venda precisa ser maior que zero.",
  invalid_product_name: "Informe a descrição do pedido.",
  invalid_sold_at: "Informe a data da venda.",
  invalid_client: "Cliente inválido para esta organização.",
  invalid_closer: "Closer inválido para esta organização.",
  invalid_sale_responsible:
    "Responsável pela venda inválido para esta organização.",
  invalid_items:
    "Confira os itens: cada um precisa de descrição, quantidade maior que zero e preço válido.",
  items_required: "Um pedido com itens precisa de pelo menos um item.",
  access_denied: "Você não tem acesso a este pedido.",
};

/** Fallback único — nunca "Algo deu errado", nunca o texto cru do Postgres. */
export const ORDER_ERROR_FALLBACK =
  "Não foi possível concluir. Tente novamente em instantes";

/**
 * Extrai o código da RPC de dentro do erro do PostgREST e devolve a mensagem
 * em português. Cai no fallback (nunca no texto cru) quando o código é
 * desconhecido.
 */
export function orderErrorMessage(
  error: unknown,
  fallback: string = ORDER_ERROR_FALLBACK,
): string {
  const raw =
    typeof error === "string"
      ? error
      : ((error as { message?: string } | null)?.message ?? "");

  for (const code of Object.keys(MESSAGES)) {
    if (raw.includes(code)) return MESSAGES[code];
  }

  return fallback;
}

export const ORDER_ERROR_CODES = Object.keys(MESSAGES);
