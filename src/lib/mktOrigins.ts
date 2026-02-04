/**
 * Origens de leads para dashboards MKT.
 * MKT Cal = origem Cal.com (agendamento direto).
 * MKT Cadastro = origens cadastro/LP (site, meta_ads, remarketing, google_ads).
 */

/** Origens que contam como cadastro/landing page (site, meta ads, remarketing, google ads) */
export const ORIGINS_CADASTRO_LP: string[] = ["site", "meta_ads", "remarketing", "google_ads"];

/** Origem Cal.com (agendamento direto) */
export const ORIGIN_CAL = "cal";

export function isOriginCadastroLp(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return ORIGINS_CADASTRO_LP.includes(origin);
}

export function isOriginCal(origin: string | null | undefined): boolean {
  return origin === ORIGIN_CAL;
}

/** Tipo de origem para o funil MKT (Cal vs Cadastro) */
export type MktOriginType = "cal" | "cadastro_lp";

/** Verifica se o lead entra no funil MKT Cal */
export function isMktCalOrigin(origin: string | null | undefined): boolean {
  return isOriginCal(origin);
}

/** Verifica se o lead entra no funil MKT Cadastro */
export function isMktCadastroOrigin(origin: string | null | undefined): boolean {
  return isOriginCadastroLp(origin);
}
