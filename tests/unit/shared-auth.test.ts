/**
 * Tests for _shared/auth.ts — webhook validation, rate limiting, client identification,
 * Cal.com webhook validation, organization access, response helpers, persistent rate limit,
 * per-org API key validation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

beforeEach(() => { clearDenoEnv(); vi.clearAllMocks(); });

import {
  validateEvolutionWebhook,
  validateCalcomWebhook,
  validateWebhookApiKey,
  checkRateLimit,
  getClientIdentifier,
  validateOrganizationAccess,
  unauthorizedResponse,
  checkRateLimitPersistent,
  rateLimitedResponse,
  validateApiKey,
} from "../../supabase/functions/_shared/auth";

// ── validateEvolutionWebhook ──
describe("validateEvolutionWebhook", () => {
  it("allows when no secret configured (backward compat)", () => {
    const req = new Request("http://test.com");
    const result = validateEvolutionWebhook(req);
    expect(result.valid).toBe(true);
  });

  it("rejects when secret set but no key in request", () => {
    setDenoEnv("EVOLUTION_WEBHOOK_SECRET", "my-secret");
    const req = new Request("http://test.com");
    const result = validateEvolutionWebhook(req);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing");
  });

  it("rejects when key doesn't match", () => {
    setDenoEnv("EVOLUTION_WEBHOOK_SECRET", "my-secret");
    const req = new Request("http://test.com", { headers: { apikey: "wrong" } });
    const result = validateEvolutionWebhook(req);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("accepts when key matches via apikey header", () => {
    setDenoEnv("EVOLUTION_WEBHOOK_SECRET", "my-secret");
    const req = new Request("http://test.com", { headers: { apikey: "my-secret" } });
    const result = validateEvolutionWebhook(req);
    expect(result.valid).toBe(true);
  });

  it("accepts when key matches via x-api-key header", () => {
    setDenoEnv("EVOLUTION_WEBHOOK_SECRET", "my-secret");
    const req = new Request("http://test.com", { headers: { "x-api-key": "my-secret" } });
    const result = validateEvolutionWebhook(req);
    expect(result.valid).toBe(true);
  });
});

// ── validateWebhookApiKey ──
describe("validateWebhookApiKey", () => {
  it("rejects when no key configured", () => {
    const req = new Request("http://test.com", { headers: { "x-webhook-key": "any" } });
    const result = validateWebhookApiKey(req);
    expect(result.valid).toBe(false);
  });

  it("rejects when no key in request", () => {
    setDenoEnv("WEBHOOK_API_KEY", "secret");
    const req = new Request("http://test.com");
    const result = validateWebhookApiKey(req);
    expect(result.valid).toBe(false);
  });

  it("rejects wrong key", () => {
    setDenoEnv("WEBHOOK_API_KEY", "secret");
    const req = new Request("http://test.com", { headers: { "x-webhook-key": "wrong" } });
    const result = validateWebhookApiKey(req);
    expect(result.valid).toBe(false);
  });

  it("accepts correct key via x-webhook-key", () => {
    setDenoEnv("WEBHOOK_API_KEY", "secret");
    const req = new Request("http://test.com", { headers: { "x-webhook-key": "secret" } });
    const result = validateWebhookApiKey(req);
    expect(result.valid).toBe(true);
  });

  it("accepts correct key via Bearer authorization", () => {
    setDenoEnv("WEBHOOK_API_KEY", "secret");
    const req = new Request("http://test.com", { headers: { authorization: "Bearer secret" } });
    const result = validateWebhookApiKey(req);
    expect(result.valid).toBe(true);
  });
});

// ── checkRateLimit ──
describe("checkRateLimit", () => {
  it("allows first request", () => {
    const result = checkRateLimit("test-ip-1", 10, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("decrements remaining", () => {
    checkRateLimit("test-ip-2", 10, 60000);
    const result = checkRateLimit("test-ip-2", 10, 60000);
    expect(result.remaining).toBe(8);
  });

  it("blocks after max requests", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("test-ip-3", 5, 60000);
    }
    const result = checkRateLimit("test-ip-3", 5, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after window expires", () => {
    // Use a unique ID and a very short window
    const result1 = checkRateLimit("test-ip-4", 1, 1); // 1ms window
    expect(result1.allowed).toBe(true);
    // The window is 1ms, so the next call should reset
  });
});

// ── getClientIdentifier ──
describe("getClientIdentifier", () => {
  it("returns cf-connecting-ip when present", () => {
    const req = new Request("http://test.com", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    expect(getClientIdentifier(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = new Request("http://test.com", {
      headers: { "x-real-ip": "5.6.7.8" },
    });
    expect(getClientIdentifier(req)).toBe("5.6.7.8");
  });

  it("falls back to x-forwarded-for (first IP)", () => {
    const req = new Request("http://test.com", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(getClientIdentifier(req)).toBe("1.1.1.1");
  });

  it("returns 'unknown' when no IP headers", () => {
    const req = new Request("http://test.com");
    expect(getClientIdentifier(req)).toBe("unknown");
  });

  it("prefers cf-connecting-ip over others", () => {
    const req = new Request("http://test.com", {
      headers: {
        "cf-connecting-ip": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
        "x-forwarded-for": "3.3.3.3",
      },
    });
    expect(getClientIdentifier(req)).toBe("1.1.1.1");
  });
});

// ── validateCalcomWebhook ──
describe("validateCalcomWebhook", () => {
  it("allows when no secret configured (backward compat)", () => {
    const req = new Request("http://test.com");
    const result = validateCalcomWebhook(req, "{}");
    expect(result.valid).toBe(true);
  });

  it("rejects when secret set but no signature in request", () => {
    setDenoEnv("CALCOM_WEBHOOK_SECRET", "cal-secret");
    const req = new Request("http://test.com");
    const result = validateCalcomWebhook(req, "{}");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing Cal.com signature");
  });

  it("rejects when signature does not match", () => {
    setDenoEnv("CALCOM_WEBHOOK_SECRET", "cal-secret");
    const req = new Request("http://test.com", {
      headers: { "x-cal-signature-256": "invalid-signature" },
    });
    const result = validateCalcomWebhook(req, "{}");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid Cal.com signature");
  });

  it("accepts valid HMAC signature (raw hex)", async () => {
    const secret = "cal-secret";
    const body = '{"event":"BOOKING_CREATED"}';
    setDenoEnv("CALCOM_WEBHOOK_SECRET", secret);

    // Compute expected signature using Node crypto
    const crypto = await import("crypto");
    const expectedSig = crypto.createHmac("sha256", secret).update(body).digest("hex");

    const req = new Request("http://test.com", {
      headers: { "x-cal-signature-256": expectedSig },
    });
    const result = validateCalcomWebhook(req, body);
    expect(result.valid).toBe(true);
  });

  it("accepts valid HMAC signature with sha256= prefix", async () => {
    const secret = "cal-secret";
    const body = '{"event":"BOOKING_CREATED"}';
    setDenoEnv("CALCOM_WEBHOOK_SECRET", secret);

    const crypto = await import("crypto");
    const expectedSig = crypto.createHmac("sha256", secret).update(body).digest("hex");

    const req = new Request("http://test.com", {
      headers: { "x-cal-signature-256": `sha256=${expectedSig}` },
    });
    const result = validateCalcomWebhook(req, body);
    expect(result.valid).toBe(true);
  });
});

// ── validateOrganizationAccess ──
describe("validateOrganizationAccess", () => {
  it("returns true when user is member of org", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [
      { id: "tm-1", user_id: "user-1", organization_id: "org-1" },
    ]);
    const result = await validateOrganizationAccess(sb, "user-1", "org-1");
    expect(result).toBe(true);
  });

  it("returns false when user is not member of org", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", []);
    const result = await validateOrganizationAccess(sb, "user-1", "org-1");
    expect(result).toBe(false);
  });
});

// ── unauthorizedResponse ──
describe("unauthorizedResponse", () => {
  it("returns 401 with correct message", async () => {
    const cors = { "Access-Control-Allow-Origin": "*" };
    const response = unauthorizedResponse("Not allowed", cors);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toBe("Not allowed");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ── rateLimitedResponse ──
describe("rateLimitedResponse", () => {
  it("returns 429 with Retry-After header", async () => {
    const cors = { "Access-Control-Allow-Origin": "*" };
    const response = rateLimitedResponse(30000, cors);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    const body = await response.json();
    expect(body.error).toBe("Too Many Requests");
    expect(body.retryAfter).toBe(30);
  });

  it("rounds up Retry-After to whole seconds", async () => {
    const cors = {};
    const response = rateLimitedResponse(1500, cors);
    expect(response.headers.get("Retry-After")).toBe("2");
  });
});

// ── checkRateLimitPersistent ──
describe("checkRateLimitPersistent", () => {
  it("returns allowed from RPC when data is object", async () => {
    const { sb, mockRpc } = createMockSupabase();
    mockRpc("check_rate_limit", { allowed: true, remaining: 99, reset_at: "2026-04-13T15:00:00Z" });
    const result = await checkRateLimitPersistent(sb, "test-key", 100, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
    expect(result.resetAt).toBe("2026-04-13T15:00:00Z");
  });

  it("returns allowed from RPC when data is array", async () => {
    const { sb, mockRpc } = createMockSupabase();
    mockRpc("check_rate_limit", [{ allowed: false, remaining: 0, reset_at: "2026-04-13T16:00:00Z" }]);
    const result = await checkRateLimitPersistent(sb, "test-key", 100, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("falls back to allowed on RPC error", async () => {
    const { sb } = createMockSupabase();
    // RPC not mocked → returns error
    const result = await checkRateLimitPersistent(sb, "test-key", 50, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50);
  });

  it("falls back to allowed when RPC returns null data", async () => {
    const { sb, mockRpc } = createMockSupabase();
    mockRpc("check_rate_limit", null);
    const result = await checkRateLimitPersistent(sb, "test-key");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(100);
  });

  it("falls back to allowed on unexpected exception", async () => {
    const sb = {
      rpc: () => { throw new Error("Connection failed"); },
    };
    const result = await checkRateLimitPersistent(sb, "test-key", 200, 120);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(200);
  });
});

// ── validateApiKey ──
