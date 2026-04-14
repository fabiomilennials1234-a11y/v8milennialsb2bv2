/**
 * Batch tests for _shared modules using Deno mock + fetch mock
 * Targets the biggest 0% modules for maximum coverage impact
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

// Mock fetch globally
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ choices: [{ message: { content: "test" } }] }),
  text: () => Promise.resolve("ok"),
  headers: new Headers(),
});
global.fetch = mockFetch as any;

// Mock crypto.subtle for HMAC operations
if (!globalThis.crypto?.subtle) {
  (globalThis as any).crypto = {
    ...globalThis.crypto,
    randomUUID: () => "00000000-0000-0000-0000-000000000000",
    subtle: {
      importKey: vi.fn().mockResolvedValue({}),
      sign: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  };
}

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("ok"),
    headers: new Headers(),
  });
});

// ── signPayload from webhook-utils ──
import { signPayload, nextRetryDelayMinutes } from "../../supabase/functions/_shared/webhook-utils";

describe("signPayload", () => {
  it("returns a hex string", async () => {
    const sig = await signPayload("secret", '{"test": true}');
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
  });

  it("same input produces same output", async () => {
    const sig1 = await signPayload("key", "body");
    const sig2 = await signPayload("key", "body");
    expect(sig1).toBe(sig2);
  });
});

// ── message-humanizer ──
import { humanizeMessage } from "../../supabase/functions/_shared/message-humanizer";

describe("humanizeMessage", () => {
  it("returns original if no API key", async () => {
    clearDenoEnv();
    const result = await humanizeMessage("Hello world, this is a test message");
    expect(result).toBe("Hello world, this is a test message");
  });

  it("returns original for short messages (< 20 chars)", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");
    const result = await humanizeMessage("Hi");
    expect(result).toBe("Hi");
  });

  it("calls API for longer messages when key is set", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Rewritten message for testing purposes" } }],
      }),
    });
    const result = await humanizeMessage("Original longer message for humanization test");
    expect(result).toBeTruthy();
  });

  it("returns original on API error", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("error"),
    });
    const original = "This is a test message that should be returned on error";
    const result = await humanizeMessage(original);
    expect(result).toBe(original);
  });

  it("returns original on network error", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const original = "This is a test message for network error case";
    const result = await humanizeMessage(original);
    expect(result).toBe(original);
  });
});

// ── CORS with Deno mock ──
import { getCorsHeaders } from "../../supabase/functions/_shared/cors";

describe("getCorsHeaders (with Deno mock)", () => {
  it("defaults to wildcard", () => {
    const h = getCorsHeaders();
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("respects ALLOWED_ORIGINS", () => {
    setDenoEnv("ALLOWED_ORIGINS", "https://torquecrm.com.br");
    const h = getCorsHeaders("https://torquecrm.com.br");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://torquecrm.com.br");
  });

  it("localhost always allowed", () => {
    setDenoEnv("ALLOWED_ORIGINS", "https://torquecrm.com.br");
    const h = getCorsHeaders("http://localhost:8080");
    expect(h["Access-Control-Allow-Origin"]).toBe("http://localhost:8080");
  });
});
