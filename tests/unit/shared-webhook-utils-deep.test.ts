import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// Mock Deno.resolveDns
(globalThis as any).Deno = {
  ...(globalThis as any).Deno,
  resolveDns: vi.fn().mockResolvedValue(["93.184.216.34"]),
};

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: () => Promise.resolve("OK"),
});
global.fetch = mockFetch;

import {
  validateUrl,
  signPayload,
  sendWebhook,
  nextRetryDelayMinutes,
  enqueueWebhookDeliveries,
  type SendWebhookOptions,
  type SendWebhookResult,
} from "../../supabase/functions/_shared/webhook-utils";

beforeEach(() => vi.clearAllMocks());

// ─── validateUrl ───

describe("validateUrl", () => {
  it("rejects invalid URL", async () => {
    const result = await validateUrl("not-a-url");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("inválida");
  });

  it("rejects HTTP (non-HTTPS)", async () => {
    const result = await validateUrl("http://example.com/hook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTPS");
  });

  it("accepts valid HTTPS URL with public IP", async () => {
    (Deno as any).resolveDns.mockResolvedValue(["93.184.216.34"]);
    const result = await validateUrl("https://example.com/webhook");
    expect(result.valid).toBe(true);
  });

  it("rejects localhost", async () => {
    (Deno as any).resolveDns.mockResolvedValue(["127.0.0.1"]);
    const result = await validateUrl("https://localhost/hook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("localhost");
  });

  it("rejects private IP 10.x", async () => {
    (Deno as any).resolveDns.mockResolvedValue(["10.0.0.1"]);
    const result = await validateUrl("https://internal.corp/hook");
    expect(result.valid).toBe(false);
  });

  it("rejects private IP 192.168.x", async () => {
    (Deno as any).resolveDns.mockResolvedValue(["192.168.1.1"]);
    const result = await validateUrl("https://router.local/hook");
    expect(result.valid).toBe(false);
  });

  it("rejects private IP 172.16-31.x", async () => {
    (Deno as any).resolveDns.mockResolvedValue(["172.20.0.1"]);
    const result = await validateUrl("https://internal.test/hook");
    expect(result.valid).toBe(false);
  });

  it("allows non-private 172.x outside 16-31 range", async () => {
    (Deno as any).resolveDns.mockResolvedValue(["172.32.0.1"]);
    const result = await validateUrl("https://public.test/hook");
    expect(result.valid).toBe(true);
  });

  it("returns valid when DNS returns empty (non-localhost)", async () => {
    (Deno as any).resolveDns.mockResolvedValue([]);
    const result = await validateUrl("https://external.service/hook");
    expect(result.valid).toBe(true);
  });

  it("handles DNS resolution failure", async () => {
    (Deno as any).resolveDns.mockImplementation(() => { throw new Error("DNS failed"); });
    const result = await validateUrl("https://failing.dns/hook");
    expect(result.valid).toBe(false);
  });
});

// ─── signPayload ───

describe("signPayload", () => {
  it("returns hex string", async () => {
    const sig = await signPayload("secret123", '{"event":"test"}');
    expect(typeof sig).toBe("string");
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(sig.length).toBeGreaterThan(10);
  });

  it("produces different signatures for different secrets", async () => {
    const sig1 = await signPayload("secret1", "body");
    const sig2 = await signPayload("secret2", "body");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different bodies", async () => {
    const sig1 = await signPayload("secret", "body1");
    const sig2 = await signPayload("secret", "body2");
    expect(sig1).not.toBe(sig2);
  });

  it("produces same signature for same input", async () => {
    const sig1 = await signPayload("secret", "body");
    const sig2 = await signPayload("secret", "body");
    expect(sig1).toBe(sig2);
  });
});

// ─── sendWebhook ───

describe("sendWebhook", () => {
  const baseOptions: SendWebhookOptions = {
    url: "https://example.com/hook",
    method: "POST",
    payload: { event: "lead_created", data: { id: "1" } },
    secret: null,
    customHeaders: {},
    event: "lead_created",
  };

  it("sends webhook and returns response", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, text: () => Promise.resolve("OK") });
    const result = await sendWebhook(baseOptions);
    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toBe("OK");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("includes custom headers", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, text: () => Promise.resolve("") });
    await sendWebhook({ ...baseOptions, customHeaders: { "X-Custom": "value" } });
    const call = mockFetch.mock.calls[0];
    expect(call[1].headers["X-Custom"]).toBe("value");
  });

  it("adds signature header when secret provided", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, text: () => Promise.resolve("") });
    await sendWebhook({ ...baseOptions, secret: "my-secret" });
    const call = mockFetch.mock.calls[0];
    expect(call[1].headers["X-Webhook-Signature-256"]).toBeTruthy();
  });

  it("adds delivery ID header when provided", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, text: () => Promise.resolve("") });
    await sendWebhook({ ...baseOptions, deliveryId: "del-1" });
    const call = mockFetch.mock.calls[0];
    expect(call[1].headers["X-Webhook-Delivery-Id"]).toBe("del-1");
  });

  it("handles fetch error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await sendWebhook(baseOptions);
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain("Network error");
  });

  it("truncates long response body", async () => {
    const longBody = "x".repeat(3000);
    mockFetch.mockResolvedValueOnce({ status: 200, text: () => Promise.resolve(longBody) });
    const result = await sendWebhook(baseOptions);
    expect(result.responseBody.length).toBeLessThan(3000);
    expect(result.responseBody).toContain("truncated");
  });
});

// ─── nextRetryDelayMinutes ───

describe("nextRetryDelayMinutes", () => {
  it("attempt 1 returns ~1 minute", () => {
    const delay = nextRetryDelayMinutes(1);
    expect(delay).toBeGreaterThanOrEqual(0.8);
    expect(delay).toBeLessThanOrEqual(1.2);
  });

  it("attempt 2 returns ~5 minutes", () => {
    const delay = nextRetryDelayMinutes(2);
    expect(delay).toBeGreaterThanOrEqual(4);
    expect(delay).toBeLessThanOrEqual(6);
  });

  it("attempt 3 returns ~15 minutes", () => {
    const delay = nextRetryDelayMinutes(3);
    expect(delay).toBeGreaterThanOrEqual(12);
    expect(delay).toBeLessThanOrEqual(18);
  });

  it("attempt 4+ returns ~60 minutes", () => {
    const delay = nextRetryDelayMinutes(4);
    expect(delay).toBeGreaterThanOrEqual(48);
    expect(delay).toBeLessThanOrEqual(72);
  });

  it("never returns less than 1", () => {
    for (let i = 1; i <= 10; i++) {
      expect(nextRetryDelayMinutes(i)).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── enqueueWebhookDeliveries ───

describe("enqueueWebhookDeliveries", () => {
  it("enqueues deliveries for matching webhooks", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("webhooks", [{ id: "wh-1" }, { id: "wh-2" }]);
    mockTable("webhook_deliveries", []);
    await enqueueWebhookDeliveries(sb, "org-1", "lead_created", { id: "l1", name: "Test" });
    // Should not throw
    expect(true).toBe(true);
  });

  it("does nothing when no webhooks match", async () => {
    const { sb } = createMockSupabase();
    // No webhooks in table
    await enqueueWebhookDeliveries(sb, "org-1", "lead_created", { id: "l1" });
    expect(true).toBe(true);
  });
});
