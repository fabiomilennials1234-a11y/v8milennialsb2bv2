/**
 * Pure display helpers for the Personal Access Tokens panel (crm-mcp DESIGN §7.5).
 * Kept out of the component so they are unit-testable without a render harness.
 */

/** A token is "inactive" when revoked OR past its expiry. */
export function isExpired(t: { expires_at: string; revoked_at: string | null }, nowMs: number): boolean {
  return !t.revoked_at && Date.parse(t.expires_at) < nowMs;
}

/** The MCP client config snippet a customer pastes into Claude Desktop (or any MCP client). */
export function buildMcpConfig(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "torque-crm": {
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}
