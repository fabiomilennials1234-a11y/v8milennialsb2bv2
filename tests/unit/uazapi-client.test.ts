/**
 * Unit tests for UazapiClient
 *
 * fetch is mocked globally — no network calls are made.
 * Each test group resets circuit breaker state and fetch mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";
import type {
  UazapiError,
  UazapiMessageResponse,
  UazapiInstanceResponse,
} from "../../supabase/functions/_shared/uazapi-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

const OK_MESSAGE: UazapiMessageResponse = {
  id: "msg-abc-123",
  status: "sent",
  timestamp: 1_700_000_000,
};

const BASE_CONFIG = {
  baseUrl: "https://uazapi.example.com",
  token: "tok-instance-xyz",
  adminToken: "admin-secret-token",
  // Use very short backoff so retries don't slow tests
  timeoutMs: 200,
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Silence backoff delays in tests by replacing setTimeout in client's
  // backoff method — we replace globalThis.setTimeout with an immediate resolver.
  vi.useFakeTimers();
  UazapiClient._resetCircuitState();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  UazapiClient._resetCircuitState();
});

// Fast-forward all pending timers (backoff delays).
// Runs timers concurrently with the promise under test so the rejection
// handler is already installed before the promise rejects, preventing
// "PromiseRejectionHandledWarning" / unhandled rejection noise from Vitest.
async function withTimers<T>(promise: Promise<T>): Promise<T> {
  const [result] = await Promise.allSettled([
    promise,
    vi.runAllTimersAsync(),
  ]);
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

// ---------------------------------------------------------------------------
// sendText — success
// ---------------------------------------------------------------------------

describe("sendText — success", () => {
  it("returns parsed UazapiMessageResponse on 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient(BASE_CONFIG);
    const result = await client.sendText({ number: "5511999999999", text: "Hello" });

    expect(result).toEqual(OK_MESSAGE);
  });

  it("sends token header, not admintoken", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient(BASE_CONFIG);
    await client.sendText({ number: "5511999999999", text: "Hi" });

    const [_url, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["token"]).toBe("tok-instance-xyz");
    expect(headers["admintoken"]).toBeUndefined();
  });

  it("POSTs to /send/text with correct URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient(BASE_CONFIG);
    await client.sendText({ number: "5511999999999", text: "Hi" });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/send/text");
    expect(init?.method).toBe("POST");
  });

  it("includes track_source and track_id in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient(BASE_CONFIG);
    await client.sendText({
      number: "5511999999999",
      text: "Hi",
      track_source: "copilot-agent-abc",
      track_id: "my-idempotency-key",
    });

    const [_url, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.track_source).toBe("copilot-agent-abc");
    expect(body.track_id).toBe("my-idempotency-key");
  });

  it("resets circuit breaker failures on success", async () => {
    // Simulate 2 previous failures (below threshold)
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network error 1"))
      .mockRejectedValueOnce(new Error("network error 2"))
      .mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient({ ...BASE_CONFIG, timeoutMs: 100 });

    const result = await withTimers(
      client.sendText({ number: "5511999999999", text: "Hi" })
    );

    expect(result).toEqual(OK_MESSAGE);

    const state = UazapiClient._circuitState().get("token:[present]:default");
    expect(state?.failures ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sendText — 4xx: no retry, UazapiError thrown with provider_code
// ---------------------------------------------------------------------------

describe("sendText — 4xx error", () => {
  it("throws UazapiError immediately without retrying", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(422, {
        code: "invalid_phone",
        message: "Phone number is invalid",
      })
    );

    const client = new UazapiClient(BASE_CONFIG);
    await expect(
      client.sendText({ number: "invalid", text: "Hi" })
    ).rejects.toMatchObject<Partial<UazapiError>>({
      status: 422,
      provider_code: "invalid_phone",
      message: "Phone number is invalid",
    });

    // Only one fetch call — no retry
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("throws UazapiError with error_code fallback when code is absent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(403, { error_code: "token_expired", message: "Forbidden" })
    );

    const client = new UazapiClient(BASE_CONFIG);
    await expect(
      client.sendText({ number: "5511999999999", text: "Hi" })
    ).rejects.toMatchObject<Partial<UazapiError>>({
      status: 403,
      provider_code: "token_expired",
    });
  });

  it("does NOT increment circuit breaker on 4xx", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(401, { message: "Unauthorized" })
    );

    const client = new UazapiClient(BASE_CONFIG);
    for (let i = 0; i < 5; i++) {
      await expect(
        client.sendText({ number: "5511999999999", text: "Hi" })
      ).rejects.toMatchObject({ status: 401 });
    }

    const state = UazapiClient._circuitState().get("token:[present]:default");
    expect(state?.failures ?? 0).toBe(0);
    expect(state?.openUntil ?? 0).toBe(0);
  });

  it("exposes raw response body in UazapiError.raw", async () => {
    const rawBody = { code: "err_x", message: "Nope", extra: "data" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(400, rawBody));

    const client = new UazapiClient(BASE_CONFIG);
    let caught: UazapiError | undefined;
    try {
      await client.sendText({ number: "5511999999999", text: "Hi" });
    } catch (e) {
      caught = e as UazapiError;
    }
    expect(caught?.raw).toMatchObject(rawBody);
  });
});

// ---------------------------------------------------------------------------
// sendText — 5xx: retries 3x then throws
// ---------------------------------------------------------------------------

describe("sendText — 5xx retry", () => {
  it("retries MAX_RETRIES times then throws last error", async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(503, { message: "overloaded" }));

    const client = new UazapiClient({ ...BASE_CONFIG, timeoutMs: 100 });
    await expect(
      withTimers(client.sendText({ number: "5511999999999", text: "Hi" }))
    ).rejects.toMatchObject({ status: 503 });
    // 3 attempts total
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("succeeds on 3rd attempt after two 500s", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(500, { message: "err1" }))
      .mockResolvedValueOnce(makeResponse(500, { message: "err2" }))
      .mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient({ ...BASE_CONFIG, timeoutMs: 100 });
    const result = await withTimers(
      client.sendText({ number: "5511999999999", text: "Hi" })
    );

    expect(result).toEqual(OK_MESSAGE);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Timeout → AbortError → retry + circuit breaker
// ---------------------------------------------------------------------------

describe("timeout — AbortError handling", () => {
  it("retries on timeout and increments circuit breaker", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    vi.mocked(fetch).mockRejectedValue(abortErr);

    const client = new UazapiClient({ ...BASE_CONFIG, timeoutMs: 50 });
    await expect(
      withTimers(client.sendText({ number: "5511999999999", text: "Hi" }))
    ).rejects.toMatchObject({
      status: 504,
      provider_code: "timeout",
    });

    // 3 attempts
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("opens circuit breaker after CIRCUIT_BREAKER_THRESHOLD consecutive failures", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.mocked(fetch).mockRejectedValue(abortErr);

    const client = new UazapiClient({ ...BASE_CONFIG, timeoutMs: 50 });

    // First call: 3 retries = 3 failures → circuit opens
    await expect(
      withTimers(client.sendText({ number: "5511999999999", text: "Hi" }))
    ).rejects.toBeDefined();

    const state = UazapiClient._circuitState().get("token:[present]:default");
    expect(state?.openUntil).toBeGreaterThan(Date.now());
  });

  it("throws circuit_breaker_open immediately when breaker is open", async () => {
    // Force breaker open by setting state directly
    UazapiClient._circuitState().set("token:[present]:default", {
      failures: 0,
      openUntil: Date.now() + 120_000,
    });

    const client = new UazapiClient(BASE_CONFIG);
    await expect(
      client.sendText({ number: "5511999999999", text: "Hi" })
    ).rejects.toMatchObject<Partial<UazapiError>>({
      status: 503,
      provider_code: "circuit_breaker_open",
    });

    // Circuit is open — fetch must NOT be called at all
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// initInstance — uses admintoken header
// ---------------------------------------------------------------------------

describe("initInstance — admin token", () => {
  const INSTANCE_RESPONSE: UazapiInstanceResponse = {
    id: "inst-1",
    name: "my-instance",
    token: "tok-instance-new",
    status: "created",
  };

  it("sends admintoken header, not token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, INSTANCE_RESPONSE));

    const client = new UazapiClient(BASE_CONFIG);
    await client.initInstance({ name: "my-instance" });

    const [_url, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["admintoken"]).toBe("admin-secret-token");
    expect(headers["token"]).toBeUndefined();
  });

  it("POSTs to /instance/init", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, INSTANCE_RESPONSE));

    const client = new UazapiClient(BASE_CONFIG);
    await client.initInstance({ name: "my-instance" });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/instance/init");
    expect(init?.method).toBe("POST");
  });

  it("returns parsed UazapiInstanceResponse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, INSTANCE_RESPONSE));

    const client = new UazapiClient(BASE_CONFIG);
    const result = await client.initInstance({ name: "my-instance" });

    expect(result).toEqual(INSTANCE_RESPONSE);
  });

  it("propagates adminField01 in request body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, INSTANCE_RESPONSE));

    const client = new UazapiClient(BASE_CONFIG);
    await client.initInstance({
      name: "my-instance",
      adminField01: "org-uuid-123",
    });

    const [_url, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.adminField01).toBe("org-uuid-123");
  });
});

// ---------------------------------------------------------------------------
// sendText — missing token guard
// ---------------------------------------------------------------------------

describe("missing credentials guard", () => {
  it("throws immediately when token is missing and sendText is called", async () => {
    const client = new UazapiClient({
      baseUrl: "https://uazapi.example.com",
      // token intentionally omitted
      adminToken: "admin-secret-token",
    });

    await expect(
      client.sendText({ number: "5511999999999", text: "Hi" })
    ).rejects.toThrow(/token is required/i);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("throws immediately when adminToken is missing and initInstance is called", async () => {
    const client = new UazapiClient({
      baseUrl: "https://uazapi.example.com",
      token: "tok-instance-xyz",
      // adminToken intentionally omitted
    });

    await expect(
      client.initInstance({ name: "my-instance" })
    ).rejects.toThrow(/adminToken is required/i);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("throws on construction when baseUrl is empty string", () => {
    expect(
      () => new UazapiClient({ baseUrl: "" })
    ).toThrow(/baseUrl is required/i);
  });
});

// ---------------------------------------------------------------------------
// sendText — token not leaked in error context
// ---------------------------------------------------------------------------

describe("token not leaked", () => {
  it("does not include token value in thrown UazapiError message or raw", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(401, { message: "bad token" })
    );

    const client = new UazapiClient(BASE_CONFIG);
    let caught: UazapiError | undefined;
    try {
      await client.sendText({ number: "5511999999999", text: "Hi" });
    } catch (e) {
      caught = e as UazapiError;
    }

    const serialised = JSON.stringify(caught ?? {});
    expect(serialised).not.toContain("tok-instance-xyz");
    expect(serialised).not.toContain("admin-secret-token");
  });
});

// ---------------------------------------------------------------------------
// sendMedia — uses 60s timeout
// ---------------------------------------------------------------------------

describe("sendMedia — extended timeout", () => {
  it("calls fetch (media endpoint receives 60s timeout signal)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient(BASE_CONFIG);
    const result = await client.sendMedia({
      number: "5511999999999",
      type: "image",
      file: "data:image/png;base64,abc",
    });

    expect(result).toEqual(OK_MESSAGE);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/send/media");
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker — per-endpoint isolation
// ---------------------------------------------------------------------------

describe("circuit breaker — per-endpoint isolation", () => {
  it("media failures open the media circuit, not the default one", async () => {
    // All /send/media calls 500; one call exhausts 3 retries → 3 failures →
    // media circuit opens.
    vi.mocked(fetch).mockResolvedValue(makeResponse(500, { message: "boom" }));

    const client = new UazapiClient({ ...BASE_CONFIG, timeoutMs: 50 });
    await expect(
      withTimers(
        client.sendMedia({
          number: "5511999999999",
          type: "ptt",
          file: "https://cdn.example.com/audio.mp3",
        })
      )
    ).rejects.toMatchObject({ status: 500 });

    const mediaState = UazapiClient._circuitState().get("token:[present]:media");
    const defaultState = UazapiClient._circuitState().get(
      "token:[present]:default"
    );
    expect(mediaState?.openUntil ?? 0).toBeGreaterThan(Date.now());
    // Default circuit untouched — text sends must remain available.
    expect(defaultState?.openUntil ?? 0).toBe(0);
  });

  it("text still sends while the media circuit is open", async () => {
    // Pre-open the media circuit; default circuit is clean.
    UazapiClient._circuitState().set("token:[present]:media", {
      failures: 0,
      openUntil: Date.now() + 120_000,
    });
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient(BASE_CONFIG);
    const result = await client.sendText({
      number: "5511999999999",
      text: "Hi",
    });

    expect(result).toEqual(OK_MESSAGE);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("blocks further media calls while the media circuit is open", async () => {
    UazapiClient._circuitState().set("token:[present]:media", {
      failures: 0,
      openUntil: Date.now() + 120_000,
    });

    const client = new UazapiClient(BASE_CONFIG);
    await expect(
      client.sendMedia({
        number: "5511999999999",
        type: "ptt",
        file: "https://cdn.example.com/audio.mp3",
      })
    ).rejects.toMatchObject<Partial<UazapiError>>({
      status: 503,
      provider_code: "circuit_breaker_open",
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// senderGet — path parameter encoding
// ---------------------------------------------------------------------------

describe("senderGet — path encoding", () => {
  it("encodes sender_id in URL path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(200, {
        sender_id: "abc/def",
        status: "completed",
        total: 10,
        sent: 10,
        failed: 0,
      })
    );

    const client = new UazapiClient(BASE_CONFIG);
    await client.senderGet("abc/def");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/sender/abc%2Fdef");
  });
});

// ---------------------------------------------------------------------------
// trailingSlash normalisation
// ---------------------------------------------------------------------------

describe("baseUrl trailing slash normalisation", () => {
  it("strips trailing slash from baseUrl", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, OK_MESSAGE));

    const client = new UazapiClient({
      ...BASE_CONFIG,
      baseUrl: "https://uazapi.example.com/",
    });
    await client.sendText({ number: "5511999999999", text: "Hi" });

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/send/text");
  });
});
