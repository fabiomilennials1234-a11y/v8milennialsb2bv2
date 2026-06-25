import { describe, expect, it } from "vitest";
import { buildMcpConfig, isExpired } from "@/modules/platform/lib/pat-display";

const NOW = Date.parse("2026-06-25T12:00:00Z");

describe("isExpired", () => {
  it("revoked token is treated as inactive, not 'expired'", () => {
    expect(isExpired({ expires_at: "2099-01-01T00:00:00Z", revoked_at: "2026-01-01T00:00:00Z" }, NOW))
      .toBe(false);
  });
  it("past expiry (and not revoked) → expired", () => {
    expect(isExpired({ expires_at: "2026-01-01T00:00:00Z", revoked_at: null }, NOW)).toBe(true);
  });
  it("future expiry (and not revoked) → not expired", () => {
    expect(isExpired({ expires_at: "2099-01-01T00:00:00Z", revoked_at: null }, NOW)).toBe(false);
  });
});

describe("buildMcpConfig", () => {
  it("produces a valid MCP client config with the endpoint and bearer token", () => {
    const cfg = JSON.parse(buildMcpConfig("https://ref.supabase.co/functions/v1/crm-mcp", "tq_mcp_live_abc"));
    expect(cfg.mcpServers["torque-crm"].url).toBe("https://ref.supabase.co/functions/v1/crm-mcp");
    expect(cfg.mcpServers["torque-crm"].headers.Authorization).toBe("Bearer tq_mcp_live_abc");
  });
});
