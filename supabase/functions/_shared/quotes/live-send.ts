/** Server-only release gate. Missing/invalid configuration must fail closed. */
export function quoteLiveSendEnabled(): boolean {
  return Deno.env.get("COPILOT_QUOTE_LIVE_SEND_ENABLED") === "true";
}
