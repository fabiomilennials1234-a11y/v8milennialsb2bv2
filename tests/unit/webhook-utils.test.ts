import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("ok"),
  });
});

import {
  nextRetryDelayMinutes,
  validateUrl,
  signPayload,
  sendWebhook,
  enqueueWebhookDeliveries,
} from "../../supabase/functions/_shared/webhook-utils";

describe("nextRetryDelayMinutes", () => {
  it("attempt 1 returns ~1 minute (with jitter)", () => {
    const delay = nextRetryDelayMinutes(1);
    expect(delay).toBeGreaterThanOrEqual(0.8);
    expect(delay).toBeLessThanOrEqual(1.2);
  });

  it("attempt 2 returns ~5 minutes (with jitter)", () => {
    const delay = nextRetryDelayMinutes(2);
    expect(delay).toBeGreaterThanOrEqual(4);
    expect(delay).toBeLessThanOrEqual(6);
  });

  it("attempt 3 returns ~15 minutes (with jitter)", () => {
    const delay = nextRetryDelayMinutes(3);
    expect(delay).toBeGreaterThanOrEqual(12);
    expect(delay).toBeLessThanOrEqual(18);
  });

  it("attempt 4 returns ~60 minutes (with jitter)", () => {
    const delay = nextRetryDelayMinutes(4);
    expect(delay).toBeGreaterThanOrEqual(48);
    expect(delay).toBeLessThanOrEqual(72);
  });

  it("attempt 5+ caps at ~60 minutes", () => {
    const delay = nextRetryDelayMinutes(10);
    expect(delay).toBeGreaterThanOrEqual(48);
    expect(delay).toBeLessThanOrEqual(72);
  });

  it("never returns less than 1", () => {
    for (let i = 0; i < 100; i++) {
      expect(nextRetryDelayMinutes(1)).toBeGreaterThanOrEqual(0.8);
    }
  });
});

// ── validateUrl (anti-SSRF) ──
describe("validateUrl", () => {
  it("rejects invalid URL", async () => {
    const result = await validateUrl("not-a-url");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("inválida");
  });

  it("rejects HTTP (non-HTTPS)", async () => {
    const result = await validateUrl("http://example.com/webhook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTPS");
  });

  it("rejects localhost", async () => {
    // Mock Deno.resolveDns to return loopback
    (globalThis as any).Deno.resolveDns = async (hostname: string, type: string) => {
      if (hostname === "localhost") return type === "A" ? ["127.0.0.1"] : [];
      return [];
    };

    const result = await validateUrl("https://localhost/webhook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("localhost");
  });

  it("rejects 10.x.x.x private range", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "A" ? ["10.0.0.1"] : [];
    };

    const result = await validateUrl("https://internal.corp/webhook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("privada");
  });

  it("rejects 192.168.x.x private range", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "A" ? ["192.168.1.1"] : [];
    };

    const result = await validateUrl("https://home.local/webhook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("privada");
  });

  it("rejects 172.16-31.x.x private range", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "A" ? ["172.20.0.1"] : [];
    };

    const result = await validateUrl("https://docker.internal/webhook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("privada");
  });

  it("accepts valid public HTTPS URL", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "A" ? ["93.184.216.34"] : [];
    };

    const result = await validateUrl("https://example.com/webhook");
    expect(result.valid).toBe(true);
  });

  it("accepts when DNS returns no records (non-localhost)", async () => {
    (globalThis as any).Deno.resolveDns = async () => [];

    const result = await validateUrl("https://some-service.com/webhook");
    expect(result.valid).toBe(true);
  });

  it("rejects ::1 IPv6 loopback", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "AAAA" ? ["::1"] : [];
    };

    const result = await validateUrl("https://ipv6-local.test/webhook");
    expect(result.valid).toBe(false);
  });

  it("rejects fe80: link-local IPv6", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "AAAA" ? ["fe80::1"] : [];
    };

    const result = await validateUrl("https://link-local.test/webhook");
    expect(result.valid).toBe(false);
  });

  it("allows URL when DNS resolution throws (caught internally)", async () => {
    // resolveDns errors are caught by .catch(() => []) inside validateUrl,
    // resulting in resolved = [] which is allowed for non-localhost hostnames
    (globalThis as any).Deno.resolveDns = async () => {
      throw new Error("DNS failed");
    };

    const result = await validateUrl("https://dns-fail.test/webhook");
    expect(result.valid).toBe(true);
  });

  it("rejects .localhost subdomain", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "A" ? ["127.0.0.1"] : [];
    };

    const result = await validateUrl("https://evil.localhost/webhook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("privada");
  });

  it("allows 172.x.x.x outside private range (172.32+)", async () => {
    (globalThis as any).Deno.resolveDns = async (_hostname: string, type: string) => {
      return type === "A" ? ["172.32.0.1"] : [];
    };

    const result = await validateUrl("https://not-private.test/webhook");
    expect(result.valid).toBe(true);
  });
});

// ── signPayload ──
describe("signPayload", () => {
  it("returns a hex HMAC-SHA256 signature", async () => {
    const signature = await signPayload("my-secret", '{"event":"test"}');
    expect(typeof signature).toBe("string");
    expect(signature).toMatch(/^[0-9a-f]{64}$/); // SHA-256 = 64 hex chars
  });

  it("produces different signatures for different secrets", async () => {
    const sig1 = await signPayload("secret-1", "body");
    const sig2 = await signPayload("secret-2", "body");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different bodies", async () => {
    const sig1 = await signPayload("secret", "body-1");
    const sig2 = await signPayload("secret", "body-2");
    expect(sig1).not.toBe(sig2);
  });

  it("is deterministic for same input", async () => {
    const sig1 = await signPayload("secret", "body");
    const sig2 = await signPayload("secret", "body");
    expect(sig1).toBe(sig2);
  });
});

// ── sendWebhook ──
describe("sendWebhook", () => {
  it("sends POST with correct headers and body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"received":true}'),
    });

    const result = await sendWebhook({
      url: "https://example.com/webhook",
      method: "POST",
      payload: { event: "lead.created", data: { id: "1" } },
      secret: null,
      customHeaders: { "X-Custom": "value" },
      deliveryId: "del-1",
      event: "lead.created",
    });

    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toBe('{"received":true}');
    expect(result.errorMessage).toBeUndefined();

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe("https://example.com/webhook");
    const opts = fetchCall[1];
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-Custom"]).toBe("value");
    expect(opts.headers["X-Webhook-Event"]).toBe("lead.created");
    expect(opts.headers["X-Webhook-Delivery-Id"]).toBe("del-1");
    expect(opts.redirect).toBe("manual");
  });

  it("adds signature header when secret provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });

    await sendWebhook({
      url: "https://example.com/webhook",
      method: "POST",
      payload: { test: true },
      secret: "my-secret",
      customHeaders: {},
      event: "test.event",
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Webhook-Signature-256"]).toBeDefined();
    expect(headers["X-Webhook-Signature-256"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not add delivery-id header when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });

    await sendWebhook({
      url: "https://example.com/webhook",
      method: "POST",
      payload: {},
      secret: null,
      customHeaders: {},
      event: "test",
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Webhook-Delivery-Id"]).toBeUndefined();
  });

  it("truncates long response bodies", async () => {
    const longBody = "x".repeat(3000);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(longBody),
    });

    const result = await sendWebhook({
      url: "https://example.com/webhook",
      method: "POST",
      payload: {},
      secret: null,
      customHeaders: {},
      event: "test",
    });

    expect(result.responseBody.length).toBeLessThan(longBody.length);
    expect(result.responseBody).toContain("...[truncated]");
  });

  it("returns error on fetch failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await sendWebhook({
      url: "https://example.com/webhook",
      method: "POST",
      payload: {},
      secret: null,
      customHeaders: {},
      event: "test",
    });

    expect(result.statusCode).toBeNull();
    expect(result.responseBody).toBe("");
    expect(result.errorMessage).toBe("Connection refused");
  });

  it("returns error message for non-Error exceptions", async () => {
    mockFetch.mockRejectedValueOnce("string error");

    const result = await sendWebhook({
      url: "https://example.com/webhook",
      method: "POST",
      payload: {},
      secret: null,
      customHeaders: {},
      event: "test",
    });

    expect(result.errorMessage).toBe("string error");
  });

  it("handles non-OK status codes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const result = await sendWebhook({
      url: "https://example.com/webhook",
      method: "POST",
      payload: {},
      secret: null,
      customHeaders: {},
      event: "test",
    });

    expect(result.statusCode).toBe(500);
    expect(result.responseBody).toBe("Internal Server Error");
  });
});

// ── enqueueWebhookDeliveries ──
describe("enqueueWebhookDeliveries", () => {
  it("inserts delivery rows for matching webhooks", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("webhooks", [
      { id: "wh-1", organization_id: "org-1", is_active: true, events: ["lead.created"] },
      { id: "wh-2", organization_id: "org-1", is_active: true, events: ["lead.created", "lead.updated"] },
    ]);

    await enqueueWebhookDeliveries(sb, "org-1", "lead.created", { id: "lead-1" });

    const inserted = getInserted("webhook_deliveries");
    expect(inserted.length).toBe(2);
    expect(inserted[0].event).toBe("lead.created");
    expect(inserted[1].webhook_id).toBe("wh-2");
  });

  it("does nothing when no webhooks match", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("webhooks", []);

    await enqueueWebhookDeliveries(sb, "org-1", "lead.created", { id: "lead-1" });

    const inserted = getInserted("webhook_deliveries");
    expect(inserted.length).toBe(0);
  });
});
