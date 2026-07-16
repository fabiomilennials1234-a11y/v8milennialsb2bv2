// @vitest-environment node
/**
 * reputation-signal + uazapi-client 4xx wiring (anti-ban Onda 0 QW4).
 *
 * Two things under test:
 *  1. The pure classifier (status ∈ {403,429,463} OR body ~ ban/block/spam/
 *     rate/forbidden) and the in-isolate counter.
 *  2. The CHAT-SAFETY invariant on the wire: a ban-ish 4xx through
 *     UazapiClient records a signal but the circuit breaker stays UNTOUCHED —
 *     no open cooldown, and the next request still reaches fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  classifyBanSignal,
  recordBanSignal,
  instanceKeyFromToken,
  _banSignalCounts,
  _resetBanSignalCounts,
} = await import("../../supabase/functions/_shared/reputation-signal.ts");

const { UazapiClient } = await import(
  "../../supabase/functions/_shared/uazapi-client.ts"
);

function makeResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("classifyBanSignal — pure classifier", () => {
  it.each([
    [463, {}, "status"],
    [429, {}, "status"],
    [403, {}, "status"],
  ] as const)("flags HTTP %s by status", (status, body, matchedBy) => {
    expect(classifyBanSignal(status, body)).toEqual({ isBanSignal: true, matchedBy });
  });

  it.each([
    [400, { error: "number banned by provider" }],
    [400, { error: "temporarily blocked" }],
    [422, { message: "detected as spam" }],
    [400, { error: "rate limit exceeded" }],
    [401, { error: "forbidden operation" }],
  ])("flags HTTP %s by body content %o", (status, body) => {
    const out = classifyBanSignal(status, body);
    expect(out.isBanSignal).toBe(true);
    expect(out.matchedBy).toBe("body");
  });

  it("matches the hint in the message when the body is empty", () => {
    expect(classifyBanSignal(400, {}, "recipient blocked you").isBanSignal).toBe(true);
  });

  it("does NOT flag a mundane 4xx", () => {
    expect(classifyBanSignal(400, { error: "invalid number format" })).toEqual({ isBanSignal: false });
    expect(classifyBanSignal(404, { error: "instance not found" })).toEqual({ isBanSignal: false });
    expect(classifyBanSignal(422, { error: "missing field text" })).toEqual({ isBanSignal: false });
  });

  it("survives circular/garbage bodies", () => {
    const circular: any = {};
    circular.self = circular;
    expect(classifyBanSignal(400, circular).isBanSignal).toBe(false);
  });
});

describe("instanceKeyFromToken", () => {
  it("is stable, short, and never the token itself", () => {
    const key = instanceKeyFromToken("super-secret-token-abc");
    expect(key).toBe(instanceKeyFromToken("super-secret-token-abc"));
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(key).not.toContain("secret");
  });

  it("distinguishes tokens and handles the missing case", () => {
    expect(instanceKeyFromToken("token-a")).not.toBe(instanceKeyFromToken("token-b"));
    expect(instanceKeyFromToken(undefined)).toBe("unknown");
  });
});

describe("recordBanSignal — counter + never-throw", () => {
  beforeEach(() => _resetBanSignalCounts());

  it("increments the per-instance-key counter", () => {
    const ev = { status: 463, matchedBy: "status" as const, path: "/send/text", instanceKey: "abc123" };
    recordBanSignal(ev);
    recordBanSignal(ev);
    expect(_banSignalCounts().get("abc123")).toBe(2);
  });

  it("never throws even with a broken console", () => {
    const orig = console.warn;
    console.warn = () => {
      throw new Error("console down");
    };
    try {
      expect(() =>
        recordBanSignal({ status: 429, matchedBy: "status", path: "/x", instanceKey: "k" }),
      ).not.toThrow();
    } finally {
      console.warn = orig;
    }
  });
});

describe("UazapiClient 4xx wire — signal recorded, breaker UNTOUCHED (chat safety)", () => {
  const realFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetBanSignalCounts();
    UazapiClient._resetCircuitState();
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
    UazapiClient._resetCircuitState();
  });

  it("a 463 on /send/text records a reputation signal but leaves the breaker closed", async () => {
    const client = new UazapiClient({ baseUrl: "https://uazapi.test", token: "tok-1" });
    mockFetch.mockResolvedValueOnce(makeResponse(463, { error: "temporarily restricted" }));

    await expect(
      client.sendText({ number: "5511999990000", text: "oi" }),
    ).rejects.toMatchObject({ status: 463 });

    // Signal recorded for this token's key.
    const key = instanceKeyFromToken("tok-1");
    expect(_banSignalCounts().get(key)).toBe(1);

    // Breaker state: nothing open, nothing counting.
    for (const state of UazapiClient._circuitState().values()) {
      expect(state.failures).toBe(0);
      expect(state.openUntil).toBe(0);
    }
  });

  it("even THREE consecutive 463s never open the breaker — the next send still reaches fetch", async () => {
    const client = new UazapiClient({ baseUrl: "https://uazapi.test", token: "tok-1" });
    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce(makeResponse(463, { error: "restricted" }));
      await expect(client.sendText({ number: "5511", text: "x" })).rejects.toMatchObject({ status: 463 });
    }

    // 3 x 5xx would have opened the breaker (threshold 3); 3 x 463 must not.
    mockFetch.mockResolvedValueOnce(makeResponse(200, { id: "msg-1" }));
    await expect(client.sendText({ number: "5511", text: "y" })).resolves.toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(4); // 4th request reached fetch — no circuit_breaker_open short-circuit
    expect(_banSignalCounts().get(instanceKeyFromToken("tok-1"))).toBe(3);
  });

  it("a mundane 400 records NO signal and stays no-retry", async () => {
    const client = new UazapiClient({ baseUrl: "https://uazapi.test", token: "tok-2" });
    mockFetch.mockResolvedValueOnce(makeResponse(400, { error: "invalid number format" }));

    await expect(client.sendText({ number: "x", text: "y" })).rejects.toMatchObject({ status: 400 });
    expect(mockFetch).toHaveBeenCalledTimes(1); // 4xx never retries
    expect(_banSignalCounts().size).toBe(0);
  });

  it("the 4xx error shape is unchanged (plain UazapiError object, provider_code preserved)", async () => {
    const client = new UazapiClient({ baseUrl: "https://uazapi.test", token: "tok-3" });
    mockFetch.mockResolvedValueOnce(makeResponse(429, { code: "RATE_LIMIT", error: "rate limited" }));

    await expect(client.sendText({ number: "5511", text: "z" })).rejects.toMatchObject({
      status: 429,
      provider_code: "RATE_LIMIT",
    });
  });
});
