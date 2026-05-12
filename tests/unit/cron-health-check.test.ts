/**
 * Unit tests for cron-health-check pure logic.
 *
 * The logic in `health-check.ts` is intentionally decoupled from Deno globals
 * so it can run in vitest. The probe + table-secret fetchers are injected.
 */

import { describe, it, expect, vi } from "vitest";
import { runHealthCheck } from "../../supabase/functions/cron-health-check/health-check.ts";

describe("cron-health-check — runHealthCheck", () => {
  it("reports unhealthy when neither env nor table secret are present", async () => {
    const report = await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue(null),
      envSecret: "",
      probe: vi.fn(),
    });

    expect(report.healthy).toBe(false);
    expect(report.env_secret_present).toBe(false);
    expect(report.table_secret_present).toBe(false);
    expect(report.message).toMatch(/No CRON secret/i);
  });

  it("reports healthy when probe returns 200 and secrets match", async () => {
    const probe = vi.fn().mockResolvedValue(200);
    const report = await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue("same-secret"),
      envSecret: "same-secret",
      probe,
    });

    expect(report.healthy).toBe(true);
    expect(report.secrets_match).toBe(true);
    expect(report.edge_probe_status).toBe(200);
    expect(probe).toHaveBeenCalledWith("same-secret");
    expect(report.message).toMatch(/Healthy/i);
  });

  it("reports unhealthy with drift message when probe returns 401", async () => {
    const report = await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue("table-value"),
      envSecret: "env-value-different",
      probe: vi.fn().mockResolvedValue(401),
    });

    expect(report.healthy).toBe(false);
    expect(report.secrets_match).toBe(false);
    expect(report.edge_probe_status).toBe(401);
    expect(report.message).toMatch(/drift/i);
  });

  it("flags mismatch when probe succeeds but env/table secrets differ", async () => {
    const report = await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue("table-value"),
      envSecret: "env-value-different",
      probe: vi.fn().mockResolvedValue(200),
    });

    expect(report.healthy).toBe(true);
    expect(report.secrets_match).toBe(false);
    expect(report.message).toMatch(/differ/i);
  });

  it("reports unhealthy when probe is unreachable (returns null)", async () => {
    const report = await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue("any"),
      envSecret: "any",
      probe: vi.fn().mockResolvedValue(null),
    });

    expect(report.healthy).toBe(false);
    expect(report.edge_probe_status).toBeNull();
    expect(report.message).toMatch(/unreachable|timed out/i);
  });

  it("uses table secret for probe when available (matches pg_cron behavior)", async () => {
    const probe = vi.fn().mockResolvedValue(200);
    await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue("table-secret"),
      envSecret: "env-secret",
      probe,
    });
    expect(probe).toHaveBeenCalledWith("table-secret");
  });

  it("falls back to env secret when table is empty", async () => {
    const probe = vi.fn().mockResolvedValue(200);
    await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue(null),
      envSecret: "env-only-secret",
      probe,
    });
    expect(probe).toHaveBeenCalledWith("env-only-secret");
  });

  it("reports unhealthy when probe returns 500 (server error)", async () => {
    const report = await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue("ok"),
      envSecret: "ok",
      probe: vi.fn().mockResolvedValue(500),
    });
    expect(report.healthy).toBe(false);
    expect(report.edge_probe_status).toBe(500);
  });
});
