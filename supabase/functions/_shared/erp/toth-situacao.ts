/**
 * Situação do parceiro no Toth (`situacaoParceiro`), com a legenda da ficha do lead
 * (`src/modules/leads/lib/erp-situacao.ts`, autorizada pelo CTO em 10/09/2026).
 *
 * De onde ler: o cadastro do ERP (`erp_metadata.cadastro`) primeiro, a coluna
 * `upsell_clients.erp_status` depois — a mesma ordem da ficha. O sync de clientes da
 * Café Jurerê só regrava a coluna de quem está no recorte (Ativo/Inconsistente); quem
 * sai dele congela no último valor, enquanto o refresh de cadastro (`cadastro_visivel_only`)
 * segue renovando o snapshot. Em 26/11/2026, 31 clientes tinham a coluna em Ativo ou
 * Inconsistente e o cadastro em Inativo.
 */

export const TOTH_SITUACAO_LABEL: Readonly<Record<string, string>> = {
  "0": "Ativo",
  "1": "Inativo",
  "2": "Bloqueado",
  "3": "Inconsistente",
};

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

/** Código cru da situação: cadastro do ERP › raiz do metadata › coluna. */
export function tothSituacao(fromCadastro: unknown, fromMetadata: unknown, fromColumn: unknown): string | null {
  return text(fromCadastro) ?? text(fromMetadata) ?? text(fromColumn);
}

/** "Inativo"; código sem legenda aparece como veio, para não esconder o que o ERP disse. */
export function tothSituacaoLabel(code: string | null | undefined): string | null {
  const c = text(code);
  if (!c) return null;
  return TOTH_SITUACAO_LABEL[c] ?? `Situação ${c}`;
}
