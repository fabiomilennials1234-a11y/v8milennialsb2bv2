import { describe, expect, it } from "vitest";
import {
  connectionSnippet,
  daysLeft,
  MCP_CLIENTS,
  mcpEndpoint,
  revokeReasonLabel,
  tokenState,
} from "@/modules/platform/lib/mcp-connect";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const TOKEN = "tq_mcp_live_abcdefghijklmnopqrstuvwxyz0123ABCDEF";

describe("mcpEndpoint", () => {
  it("aponta para a edge function crm-mcp, sem barra dupla", () => {
    expect(mcpEndpoint("https://x.supabase.co/")).toBe("https://x.supabase.co/functions/v1/crm-mcp");
  });
});

describe("connectionSnippet", () => {
  const url = "https://x.supabase.co/functions/v1/crm-mcp";

  it("cobre todo cliente listado, e cada snippet leva o token inteiro e o endereço", () => {
    for (const c of MCP_CLIENTS) {
      const s = connectionSnippet(c.id, url, TOKEN);
      expect(s).toContain(TOKEN);
      expect(s).toContain(url);
    }
  });

  it("Claude Code: comando de uma linha com transporte http e cabeçalho Bearer", () => {
    expect(connectionSnippet("claude-code", url, TOKEN)).toBe(
      `claude mcp add --transport http torque-crm ${url} --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it("Cursor: JSON válido com url e headers", () => {
    const cfg = JSON.parse(connectionSnippet("cursor", url, TOKEN));
    expect(cfg.mcpServers["torque-crm"]).toEqual({ url, headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it("Claude Desktop: ponte stdio→HTTP pelo mcp-remote", () => {
    const cfg = JSON.parse(connectionSnippet("claude-desktop", url, TOKEN));
    expect(cfg.mcpServers["torque-crm"].command).toBe("npx");
    expect(cfg.mcpServers["torque-crm"].args).toEqual([
      "-y",
      "mcp-remote",
      url,
      "--header",
      `Authorization: Bearer ${TOKEN}`,
    ]);
  });
});

describe("tokenState / daysLeft", () => {
  it("revogado vence expirado; expirado no instante exato", () => {
    expect(tokenState({ expires_at: "2026-01-01T00:00:00Z", revoked_at: "2025-12-01T00:00:00Z" }, NOW)).toBe("revoked");
    expect(tokenState({ expires_at: "2026-11-23T12:00:00Z", revoked_at: null }, NOW)).toBe("expired");
    expect(tokenState({ expires_at: "2026-12-23T12:00:00Z", revoked_at: null }, NOW)).toBe("active");
  });

  it("dias restantes nunca negativos", () => {
    expect(daysLeft("2026-12-23T12:00:00Z", NOW)).toBe(30);
    expect(daysLeft("2026-11-23T20:00:00Z", NOW)).toBe(0);
    expect(daysLeft("2026-11-01T00:00:00Z", NOW)).toBe(0);
  });
});

describe("revokeReasonLabel", () => {
  it("traduz os motivos do banco e cai num rótulo neutro", () => {
    expect(revokeReasonLabel("offboarding")).toBe("revogado ao sair da organização");
    expect(revokeReasonLabel("auto_unused")).toBe("revogado após 90 dias sem uso");
    expect(revokeReasonLabel(null)).toBe("revogado");
    expect(revokeReasonLabel("???")).toBe("revogado");
  });
});

describe("escopos", () => {
  it("só oferece escopos de escrita que já têm ferramentas; rótulos em pt-BR com fallback", async () => {
    const { WRITE_SCOPE_OPTIONS, scopeLabel } = await import("@/modules/platform/lib/mcp-connect");
    expect(WRITE_SCOPE_OPTIONS.map((o) => o.id)).toEqual(["crm:write", "messages:send", "automations:write"]);
    expect(WRITE_SCOPE_OPTIONS.find((o) => o.id === "messages:send")?.adminOnly).toBe(true);
    expect(scopeLabel("read")).toBe("Ler");
    expect(scopeLabel("crm:write")).toBe("Organizar o funil");
    expect(scopeLabel("x:y")).toBe("x:y");
  });
});
