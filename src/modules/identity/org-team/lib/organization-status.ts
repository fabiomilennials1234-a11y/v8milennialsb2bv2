/** Status administrativos que retiram a organização da seleção dos masters. */
export const INACTIVE_ORG_STATUSES = ["suspended", "cancelled", "expired"] as const;
export const INACTIVE_ORG_STATUS_FILTER = `(${INACTIVE_ORG_STATUSES.join(",")})`;

export function isOrganizationInactive(status: string): boolean {
  return INACTIVE_ORG_STATUSES.some((inactive) => inactive === status);
}
