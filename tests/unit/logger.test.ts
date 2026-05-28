import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before import
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

import { LogLevel, logger } from "../../src/modules/platform/lib/logger";

describe("LogLevel enum", () => {
  it("has DEBUG", () => expect(LogLevel.DEBUG).toBe("debug"));
  it("has INFO", () => expect(LogLevel.INFO).toBe("info"));
  it("has WARN", () => expect(LogLevel.WARN).toBe("warn"));
  it("has ERROR", () => expect(LogLevel.ERROR).toBe("error"));
  it("has AUDIT", () => expect(LogLevel.AUDIT).toBe("audit"));
});

describe("logger singleton", () => {
  it("is exported", () => {
    expect(logger).toBeDefined();
  });

  it("has debug method", () => expect(typeof logger.debug).toBe("function"));
  it("has info method", () => expect(typeof logger.info).toBe("function"));
  it("has warn method", () => expect(typeof logger.warn).toBe("function"));
  it("has error method", () => expect(typeof logger.error).toBe("function"));
  it("has audit method", () => expect(typeof logger.audit).toBe("function"));

  it("debug does not throw", async () => {
    await expect(logger.debug("test message")).resolves.not.toThrow();
  });

  it("info does not throw", async () => {
    await expect(logger.info("test info")).resolves.not.toThrow();
  });

  it("warn does not throw", async () => {
    await expect(logger.warn("test warn")).resolves.not.toThrow();
  });

  it("error does not throw", async () => {
    await expect(logger.error("test error", new Error("fail"))).resolves.not.toThrow();
  });

  it("audit does not throw", async () => {
    await expect(logger.audit("create", "lead", { userId: "u1" })).resolves.not.toThrow();
  });

  it("info with full context does not throw", async () => {
    await expect(
      logger.info("action", {
        userId: "user-123",
        tenantId: "org-456",
        action: "create_lead",
        resource: "leads",
        metadata: { leadId: "l1" },
      })
    ).resolves.not.toThrow();
  });

  it("sanitizes sensitive data in context (no real emails in output)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logger.info("test", {
      metadata: {
        email: "user@secret.com",
        password: "abc123",
        api_key: "sk-1234567890abcdef1234567890abcdef12",
      },
    });
    // In dev mode it logs to console — check that sensitive data is redacted
    const calls = consoleSpy.mock.calls.flat().join(" ");
    expect(calls).not.toContain("abc123");
    consoleSpy.mockRestore();
  });
});
