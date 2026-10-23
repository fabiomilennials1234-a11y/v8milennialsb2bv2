/** Piloto solicitado pela Riofix; não libera a configuração para outras orgs. */
const RIOFIX_ORG_ID = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";

export const LOSS_REASON_NAME_MAX_LENGTH = 120;

export function canEditLossReasons(organizationId: string | null | undefined, isAdmin: boolean): boolean {
  return organizationId === RIOFIX_ORG_ID && isAdmin;
}
