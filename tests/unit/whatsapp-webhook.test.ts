/**
 * Unit tests for whatsapp-webhook pure logic (no Deno.serve invocation).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const envStub: Record<string, string> = {
  SUPABASE_URL: "https://local.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  UAZAPI_WEBHOOK_SECRET: "test-secret-never-used-in-prod",
};

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => envStub[k] ?? undefined,
    toObject: () => ({ ...envStub }),
  },
  serve: (_handler: unknown) => {},
});

vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_name: string, fn: unknown) => fn,
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));

const mod = await import(
  "../../supabase/functions/whatsapp-webhook/index.ts"
);
const {
  timingSafeEqual,
  checkRateLimit,
  normalizeMessage,
  rateLimitState,
  RATE_LIMIT_MAX,
  REPLAY_WINDOW_MS,
} = mod as unknown as {
  timingSafeEqual: (a: string, b: string) => boolean;
  checkRateLimit: (ip: string) => { allowed: boolean; remaining: number };
  normalizeMessage: (data: unknown, instance: unknown) => Record<string, unknown>;
  rateLimitState: Map<string, unknown>;
  RATE_LIMIT_MAX: number;
  REPLAY_WINDOW_MS: number;
};

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });
  it("returns false for different strings of same length", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });
  it("returns false for different-length strings", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
  it("returns false when compared string is empty", () => {
    expect(timingSafeEqual("secret", "")).toBe(false);
  });
  it("returns true for two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
  it("handles long realistic secret", () => {
    const a = "a".repeat(64);
    const b = "a".repeat(63) + "b";
    expect(timingSafeEqual(a, b)).toBe(false);
    expect(timingSafeEqual(a, a)).toBe(true);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    rateLimitState.clear();
  });
  it("allows first request", () => {
    const r = checkRateLimit("1.2.3.4");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(RATE_LIMIT_MAX - 1);
  });
  it("decrements remaining on each request", () => {
    checkRateLimit("1.2.3.4");
    const r = checkRateLimit("1.2.3.4");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(RATE_LIMIT_MAX - 2);
  });
  it("blocks after RATE_LIMIT_MAX requests", () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit("1.2.3.4");
    const r = checkRateLimit("1.2.3.4");
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
  it("isolates counts per IP", () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit("1.1.1.1");
    expect(checkRateLimit("1.1.1.1").allowed).toBe(false);
    expect(checkRateLimit("2.2.2.2").allowed).toBe(true);
  });
  it("resets after window expires", () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit("9.9.9.9");
    expect(checkRateLimit("9.9.9.9").allowed).toBe(false);
    const rec = rateLimitState.get("9.9.9.9") as { resetAt: number } | undefined;
    if (rec) rec.resetAt = Date.now() - 1;
    const after = checkRateLimit("9.9.9.9");
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(RATE_LIMIT_MAX - 1);
  });
});

describe("normalizeMessage", () => {
  const instance = {
    id: "inst-uuid-001",
    organization_id: "org-uuid-001",
    instance_name: "test-instance",
  };
  it("normalizes incoming text message", () => {
    const n = normalizeMessage(
      {
        id: "msg-001",
        chatid: "5511999999999@c.us",
        fromMe: false,
        type: "text",
        text: "hello",
        timestamp: 1700000000,
        pushName: "Fabio",
      },
      instance
    );
    expect(n.organization_id).toBe("org-uuid-001");
    expect(n.instance_id).toBe("inst-uuid-001");
    expect(n.message_id).toBe("msg-001");
    expect(n.direction).toBe("incoming");
    expect(n.message_type).toBe("text");
    expect(n.content).toBe("hello");
    expect(n.phone_number).toBe("5511999999999");
    expect(n.status).toBe("received");
    expect(n.push_name).toBe("Fabio");
  });
  it("normalizes outgoing message (fromMe=true)", () => {
    const n = normalizeMessage(
      { id: "m", chatid: "x@c.us", fromMe: true, text: "x" },
      instance
    );
    expect(n.direction).toBe("outgoing");
    expect(n.status).toBe("sent");
  });
  it("handles media message", () => {
    const n = normalizeMessage(
      {
        id: "m",
        chatid: "x@c.us",
        fromMe: false,
        type: "image",
        mediaUrl: "https://cdn/x.jpg",
        caption: "p",
      },
      instance
    );
    expect(n.message_type).toBe("image");
    expect(n.media_url).toBe("https://cdn/x.jpg");
    expect(n.content).toBe("p");
  });
  it("falls back to remoteJid when chatid absent", () => {
    const n = normalizeMessage(
      { id: "m", remoteJid: "5511@c.us", fromMe: false },
      instance
    );
    expect(n.remote_jid).toBe("5511@c.us");
  });
  it("returns null message_id when not present", () => {
    expect(normalizeMessage({ chatid: "x", fromMe: false }, instance).message_id).toBeNull();
  });
  it("infers message_type", () => {
    expect(normalizeMessage({ id: "a", text: "hi" }, instance).message_type).toBe("text");
    expect(normalizeMessage({ id: "b", media: { url: "x" } }, instance).message_type).toBe("media");
    expect(normalizeMessage({ id: "c" }, instance).message_type).toBe("unknown");
  });
  it("uses key.id as fallback for message_id", () => {
    expect(normalizeMessage({ key: { id: "legacy" }, fromMe: false }, instance).message_id).toBe("legacy");
  });
  it("converts unix seconds to ISO", () => {
    const n = normalizeMessage({ id: "m", fromMe: false, timestamp: 1700000000 }, instance);
    expect(String(n.timestamp)).toMatch(/^2023-11-14/);
  });
  it("preserves raw_payload", () => {
    const data = { id: "m", fromMe: false, custom: "xyz" };
    expect(normalizeMessage(data, instance).raw_payload).toEqual(data);
  });
});

describe("constants", () => {
  it("RATE_LIMIT_MAX is 1000", () => {
    expect(RATE_LIMIT_MAX).toBe(1000);
  });
  it("REPLAY_WINDOW_MS is 5min", () => {
    expect(REPLAY_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
