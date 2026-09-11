import type { CanonicalClient } from "./types.ts";

export const CAFE_JURERE_ORG_ID = "4922638c-4909-494e-ba10-12282ec0b161";
export const CAFE_JURERE_IMPORT_FLAG = "toth_clientes_ativos_inconsistentes_com_representante";

export function cafeJurereScopeEnabled(orgId: string, flags: Record<string, unknown> | null): boolean {
  return orgId === CAFE_JURERE_ORG_ID && flags?.[CAFE_JURERE_IMPORT_FLAG] === true;
}

/** Fail closed: a mapping must point to a member registered in this organization. */
export function cafeJurereClientExclusion(
  client: Pick<CanonicalClient, "erpStatus" | "ownerExternalId">,
  ownerMap: ReadonlyMap<string, string | null>,
  registeredMembers: ReadonlySet<string>,
): "situacao" | "representante" | null {
  if (client.erpStatus !== "0" && client.erpStatus !== "3") return "situacao";
  const memberId = ownerMap.get(client.ownerExternalId?.trim() ?? "");
  return memberId && registeredMembers.has(memberId) ? null : "representante";
}
