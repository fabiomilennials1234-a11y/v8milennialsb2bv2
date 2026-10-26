/** Empty or malformed allowlists fail closed. Keep pilot authorization server-side. */
export function metaPilotAllows(organizationId: string): boolean {
  const entries = (Deno.env.get("META_CRM_PILOT_ORGANIZATION_IDS") ?? "").split(",").map((id) => id.trim().toLowerCase());
  return entries.includes(organizationId.toLowerCase()) && organizationId.length > 0;
}
