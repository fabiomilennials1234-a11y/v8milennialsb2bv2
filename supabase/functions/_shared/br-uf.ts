/**
 * As 27 UFs do Brasil — a regra de `leads.uf` do lado das edge functions.
 *
 * 🔴 A fonte é o banco. O CHECK `leads_uf_check` só aceita estas 27, e
 * `public.uf_brasileira(text)` (migration 20280111000600) é a mesma regra em
 * forma de função: `upper(btrim(valor))` dentro das 27, ou NULL. Este arquivo
 * espelha essa função. Se ela mudar, este arquivo muda junto. Os casos do pgTAP
 * (`supabase/tests/uf_do_erp_chega_ao_lead_test.sql`, U1–U3) se repetem em
 * `br-uf.test.ts`.
 *
 * 'EX' (exterior) NÃO é UF. O Toth cadastra cliente fora do Brasil assim, e na
 * Carteira (`upsell_clients.erp_uf`) isso é informação; no lead, estoura o CHECK.
 *
 * O front tem a mesma lista, com o nome de cada estado, em
 * `src/shared/format/br-uf.ts`. A lista mora aqui e não é importada de lá para
 * não cruzar a fronteira front/edge: importar de `src/` levaria arquivo do
 * front para o bundle da função.
 */
export const UFS_BRASILEIRAS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO",
] as const;

export type UfBrasileira = (typeof UFS_BRASILEIRAS)[number];

const UFS: ReadonlySet<string> = new Set(UFS_BRASILEIRAS);

/**
 * UF brasileira normalizada (`' sc '` → `'SC'`), ou `null`: 'EX', vazio,
 * não-texto e qualquer valor fora das 27.
 *
 * `trim()` tira qualquer espaço em branco, e o `btrim` do banco tira só o
 * espaço. A diferença só aceita a mais um valor que o CHECK aceita igual.
 */
export function ufBrasileira(valor: unknown): UfBrasileira | null {
  if (typeof valor !== "string") return null;
  const uf = valor.trim().toUpperCase();
  return UFS.has(uf) ? (uf as UfBrasileira) : null;
}
