/**
 * Nome do lead na importação.
 *
 * `name` é obrigatório, mas a lista de prospecção de quem liga para comércios
 * tem só EMPRESA e telefone (Rafaeli, Café Jurerê, 13/10). Sem este fallback ela
 * repetia a empresa na coluna Nome — e a linha que esquecesse era rejeitada. Se
 * não há nome e há empresa, a empresa vira o nome, que é o que o Marcelo já
 * orientava fazer na mão.
 */
export function withNameFallback<T extends { name?: string | null; company?: string | null }>(
  lead: T,
): T & { name: string } {
  const name = lead.name?.trim();
  if (name) return { ...lead, name };
  const company = lead.company?.trim();
  return { ...lead, name: company ?? "" };
}
