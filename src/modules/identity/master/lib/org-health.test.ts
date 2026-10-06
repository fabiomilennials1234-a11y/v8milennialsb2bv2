import { describe, expect, it } from "vitest";
import { healthBand, orgHealth, type OrgHealthSignals } from "./org-health";

const NOW = new Date("2026-10-05T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const signals = (over: Partial<OrgHealthSignals> = {}): OrgHealthSignals => ({
  organization_id: "o1",
  members_active: 3,
  last_login_at: daysAgo(1),
  active_users_7d: 2,
  events_7d: 300,
  whatsapp_instances: 1,
  whatsapp_connected: 1,
  open_tickets: 0,
  reopen_alert_tickets: 0,
  quota_max_ratio: null,
  quota_max_resource: null,
  ...over,
});

describe("orgHealth", () => {
  it("org saudável tira 100 e não está em risco", () => {
    const h = orgHealth(signals(), NOW);
    expect(h.score).toBe(100);
    expect(h.atRisk).toBe(false);
  });

  it("OR-6: 14 dias sem login é risco mesmo com nota alta", () => {
    const h = orgHealth(signals({ last_login_at: daysAgo(14) }), NOW);
    expect(h.score).toBe(65);
    expect(h.atRisk).toBe(true);
    expect(h.riskReasons).toEqual(["14 dias sem login"]);
  });

  it("OR-6: nota abaixo de 45 é risco", () => {
    const h = orgHealth(
      signals({ last_login_at: daysAgo(10), events_7d: 0, whatsapp_connected: 0, open_tickets: 2 }),
      NOW,
    );
    expect(h.score).toBe(15);
    expect(h.atRisk).toBe(true);
  });

  it("nunca logou é risco", () => {
    expect(orgHealth(signals({ last_login_at: null }), NOW).riskReasons).toContain("nunca houve login");
  });

  it("chamado reaberto 3× zera os pontos de chamados", () => {
    const part = orgHealth(signals({ open_tickets: 1, reopen_alert_tickets: 1 }), NOW).parts.find(
      (p) => p.key === "chamados",
    );
    expect(part?.points).toBe(0);
  });

  it("chip parcialmente conectado vale meio", () => {
    const part = orgHealth(signals({ whatsapp_instances: 2, whatsapp_connected: 1 }), NOW).parts.find(
      (p) => p.key === "whatsapp",
    );
    expect(part?.points).toBe(12);
  });

  it("OR-7: aviso a partir de 90% de um limite", () => {
    expect(orgHealth(signals({ quota_max_ratio: 0.89, quota_max_resource: "max_users" }), NOW).quotaWarning).toBeNull();
    expect(orgHealth(signals({ quota_max_ratio: 0.9, quota_max_resource: "max_users" }), NOW).quotaWarning).toEqual({
      resource: "max_users",
      ratio: 0.9,
    });
  });
});

describe("healthBand", () => {
  it("faixas", () => {
    expect(healthBand(70)).toBe("good");
    expect(healthBand(45)).toBe("warn");
    expect(healthBand(44)).toBe("bad");
  });
});
