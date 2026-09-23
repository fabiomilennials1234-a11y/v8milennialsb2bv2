/** Server-only release gate. Missing/invalid configuration must fail closed. */
export function quoteLiveSendEnabled(organizationId?: string): boolean {
  if (Deno.env.get("COPILOT_QUOTE_LIVE_SEND_ENABLED") === "true") return true;
  // Scoped production rollout: no need to open real sends for every tenant.
  if (!organizationId) return false;
  return (Deno.env.get("COPILOT_QUOTE_LIVE_SEND_ORG_IDS") ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(organizationId);
}
