/**
 * erp-code.ts — rótulo de identidade com o código do ERP na frente.
 *
 *   withErpCode("João da Silva", "1234")  ->  "1234 - João da Silva"
 *
 * 🔴 **É formatação de EXIBIÇÃO, não de dado.** `upsell_clients.name` e
 * `leads.name` continuam guardando o nome limpo, e é o nome limpo que alimenta
 * `{{nome}}` no disparo, a saudação do Copilot e os templates de campanha.
 * Compor o código dentro do `name` gravado faria o cliente receber
 * "Olá 1234 - João da Silva" no WhatsApp. Por isso esta função vive na camada de
 * apresentação e nunca é chamada por caminho de escrita.
 *
 * O código é o identificador do cliente no ERP de origem
 * (`upsell_clients.external_id`, espelhado em `leads.erp_code`) — o mesmo número
 * que o vendedor digita no Toth para achar a conta. Cliente sem ERP não tem
 * código, e aí o rótulo é só o nome: nenhuma tela precisa saber se a org tem
 * integração.
 */

/**
 * Compõe `"<código> - <nome>"`, degradando para o que existir.
 *
 *   ("João da Silva", "1234")   -> "1234 - João da Silva"
 *   ("João da Silva", null)     -> "João da Silva"      (org sem ERP)
 *   ("João da Silva", "  ")     -> "João da Silva"      (ERP preenche com espaço)
 *   (null, "1234")              -> "1234"               (nunca " - João")
 *   ("1234 - João", "1234")     -> "1234 - João"        (não duplica o prefixo)
 */
export function withErpCode(
  name: string | null | undefined,
  code: string | null | undefined,
): string {
  // O Toth devolve campo "preenchido" com espaço em branco (`complemento: "  "`);
  // sem o trim o rótulo viraria "   - João da Silva".
  const cleanName = (name ?? "").trim();
  const cleanCode = (code ?? "").trim();

  if (!cleanCode) return cleanName;
  if (!cleanName) return cleanCode;

  // Idempotente de propósito: o nome pode já ter chegado prefixado — de um
  // import de planilha, ou do dia em que alguém decidir compor o código na
  // origem. Prefixar de novo daria "1234 - 1234 - João da Silva".
  if (cleanName === cleanCode || cleanName.startsWith(`${cleanCode} - `)) {
    return cleanName;
  }

  return `${cleanCode} - ${cleanName}`;
}

/**
 * Linha que carrega nome e, talvez, o código do ERP.
 *
 * As duas grafias existem porque as duas entidades guardam o mesmo dado com
 * nomes diferentes: `upsell_clients.external_id` (identidade externa genérica,
 * anterior a esta feature) e `leads.erp_code` (espelho, criado por
 * `20270921000010`). Ambos são opcionais para que `Tables<"leads">` e
 * `Tables<"upsell_clients">` sejam aceitos sem cast — inclusive antes de o
 * `types.ts` ser regerado, quando `erp_code` ainda nem existe no tipo.
 */
export interface ErpLabeledRow {
  name?: string | null;
  erp_code?: string | null;
  external_id?: string | null;
}

/**
 * Rótulo de exibição de um lead ou de um cliente da carteira.
 *
 *   erpLabel(lead)    -> "1234 - João da Silva"   (lead.erp_code)
 *   erpLabel(cliente) -> "1234 - João da Silva"   (upsell_clients.external_id)
 *   erpLabel(manual)  -> "João da Silva"          (sem ERP)
 *
 * `erp_code` vem primeiro por ser o campo da entidade que o chamador está
 * exibindo; `external_id` é o recuo para as linhas da carteira.
 */
export function erpLabel(row: ErpLabeledRow | null | undefined): string {
  if (!row) return "";
  return withErpCode(row.name, row.erp_code ?? row.external_id);
}
