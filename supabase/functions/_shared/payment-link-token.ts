/**
 * O token vem da URL, sem filtro. Caractere de controle (`/checkout/%00`) faz o Postgres
 * recusar o parâmetro, e a porta pública responderia 500 em vez de "link não encontrado".
 * Token legítimo é `tq_pay_` + hex; a regra aceita qualquer ASCII visível para não amarrar
 * o formato, e recusa só o que nunca pode ser token.
 */
export function isPlausibleLinkToken(token: string): boolean {
  return /^[\x21-\x7e]{1,200}$/.test(token);
}
