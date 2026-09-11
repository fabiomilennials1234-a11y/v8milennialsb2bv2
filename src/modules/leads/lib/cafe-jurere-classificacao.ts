/** Piloto da página de Leads; não altera importação nem a lei de outras orgs. */
export const CAFE_JURERE_ORGANIZATION_ID = "4922638c-4909-494e-ba10-12282ec0b161";
export const CAFE_JURERE_CLASSIFICACAO_FLAG = "leads_cafe_jurere_cadastro_erp";

export function usaClassificacaoCafeJurere(organizationId: string | null | undefined, flag: unknown): boolean {
  return organizationId === CAFE_JURERE_ORGANIZATION_ID && flag === true;
}

/** Visões antigas podem guardar Indefinido, que não existe neste piloto. */
export function normalizarAbaCafeJurere(value: string): string {
  return ["all", "lead", "cliente", "perdido"].includes(value) ? value : "all";
}
