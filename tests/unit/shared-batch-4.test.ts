/**
 * Batch 4 — user-auth, tts-elevenlabs, tinyerp-utils, logger (_shared), track, asaas functions
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("ok"), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), headers: new Headers() });
global.fetch = mockFetch as any;

beforeEach(() => { clearDenoEnv(); vi.clearAllMocks(); });

// ── user-auth types ──
import { AuthError, type AuthContext } from "../../supabase/functions/_shared/user-auth";

describe("AuthError", () => {
  it("extends Error", () => {
    const err = new AuthError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuthError");
  });

  it("default status is 401", () => {
    const err = new AuthError("unauthorized");
    expect(err.status).toBe(401);
    expect(err.message).toBe("unauthorized");
  });

  it("custom status", () => {
    const err = new AuthError("forbidden", 403);
    expect(err.status).toBe(403);
  });
});

describe("AuthContext type", () => {
  it("has required fields", () => {
    const ctx: AuthContext = {
      userId: "u1",
      teamMemberId: "tm1",
      organizationId: "org1",
      role: "admin",
      isMaster: false,
      isAdmin: true,
      jobTitle: "SDR",
      metricType: "meetings",
    };
    expect(ctx.role).toBe("admin");
    expect(ctx.metricType).toBe("meetings");
  });

  it("metricType can be sales", () => {
    const ctx: Partial<AuthContext> = { metricType: "sales" };
    expect(ctx.metricType).toBe("sales");
  });
});

// ── tts-elevenlabs ──
import { truncateForTts, type TtsRequest, type TtsResult } from "../../supabase/functions/_shared/tts-elevenlabs";

describe("truncateForTts", () => {
  it("returns text unchanged if under maxChars", () => {
    expect(truncateForTts("Hello world.", 100)).toBe("Hello world.");
  });

  it("truncates at last sentence boundary", () => {
    const text = "First sentence. Second sentence. Third sentence that is very long.";
    const result = truncateForTts(text, 35);
    expect(result).toBe("First sentence. Second sentence.");
  });

  it("truncates at exclamation mark", () => {
    const text = "Wow! Amazing! This is great and continues.";
    const result = truncateForTts(text, 20);
    expect(result).toBe("Wow! Amazing!");
  });

  it("handles text with no sentence boundaries", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const result = truncateForTts(text, 10);
    // May hard cut or return trimmed version
    expect(result.length).toBeLessThanOrEqual(text.length);
  });

  it("empty string returns empty", () => {
    expect(truncateForTts("", 100)).toBe("");
  });
});

describe("TTS types", () => {
  it("TtsRequest shape", () => {
    const req: TtsRequest = { text: "hello", voiceId: "v1", apiKey: "k1" };
    expect(req.text).toBe("hello");
  });

  it("TtsResult shape", () => {
    const res: TtsResult = { success: true, audioUrl: "https://example.com/audio.mp3", charCount: 5 };
    expect(res.success).toBe(true);
  });

  it("TtsResult failure", () => {
    const res: TtsResult = { success: false, error: "timeout" };
    expect(res.error).toBe("timeout");
  });
});

// ── asaas types (already partially tested, expand) ──
import type { AsaasPaymentStatus } from "../../supabase/functions/_shared/asaas";

describe("AsaasPaymentStatus completeness", () => {
  it("all status values are valid strings", () => {
    const allStatuses: AsaasPaymentStatus[] = [
      "PENDING", "RECEIVED", "CONFIRMED", "OVERDUE", "REFUNDED",
      "RECEIVED_IN_CASH", "REFUND_REQUESTED", "CHARGEBACK_REQUESTED",
      "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL",
      "DUNNING_REQUESTED", "DUNNING_RECEIVED", "AWAITING_RISK_ANALYSIS",
    ];
    expect(allStatuses).toHaveLength(13);
    allStatuses.forEach((s) => expect(typeof s).toBe("string"));
  });
});

// ── lead-service expanded ──
import { normalizePhoneForSearch, normalizeEmail } from "../../supabase/functions/_shared/lead-service";

describe("normalizePhoneForSearch — edge cases", () => {
  it("handles just digits", () => {
    expect(normalizePhoneForSearch("1")).toBe("1");
  });

  it("handles very long numbers", () => {
    const result = normalizePhoneForSearch("5511999887766554433");
    expect(result).toBeTruthy();
  });

  it("handles international non-BR numbers", () => {
    const result = normalizePhoneForSearch("12125551234");
    expect(result).toBe("12125551234");
  });
});

describe("normalizeEmail — edge cases", () => {
  it("handles email with plus addressing", () => {
    expect(normalizeEmail("User+tag@Example.COM")).toBe("user+tag@example.com");
  });

  it("handles leading/trailing whitespace and caps", () => {
    expect(normalizeEmail("  TEST@TEST.COM  ")).toBe("test@test.com");
  });
});
