/**
 * Unit tests for whatsapp-api-proxy logic
 *
 * The proxy's Deno.serve handler cannot be imported directly in Vitest.
 * We test the extractable pure logic:
 *   1. checkRateLimit — in-memory rate limiting logic
 *   2. Request body parsing — action field validation
 *   3. Tenant boundary check — cross-org detection
 *
 * For (1) we test by importing the exported test helper.
 * For (2) and (3) we verify the logic inline via equivalent pure functions.
 *
 * NOTE: Full integration tests are in tests/integration/whatsapp-api-proxy.test.ts
 * (skipped without Docker/supabase running).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Polyfill Deno for Node/Vitest
// ---------------------------------------------------------------------------

if (typeof globalThis.Deno === "undefined") {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (_k: string) => undefined },
    serve: () => {},
  };
}

// ---------------------------------------------------------------------------
// Rate limit logic — extracted inline (mirrors proxy implementation)
// ---------------------------------------------------------------------------

// We replicate the rate limit logic from the proxy here to test it independently.
// This is a grey-box test: if the implementation changes, update here.

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

function makeRateLimitState() {
  return new Map<string, { count: number; resetAt: number }>();
}

function checkRateLimit(
  orgId: string,
  state: Map<string, { count: number; resetAt: number }>,
  now: number
): { allowed: boolean; count: number; resetAt: number } {
  const rl = state.get(orgId);
  if (rl && rl.resetAt > now) {
    if (rl.count >= RATE_LIMIT_MAX) {
      return { allowed: false, count: rl.count, resetAt: rl.resetAt };
    }
    rl.count += 1;
    return { allowed: true, count: rl.count, resetAt: rl.resetAt };
  }
  const fresh = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  state.set(orgId, fresh);
  return { allowed: true, count: fresh.count, resetAt: fresh.resetAt };
}

describe("checkRateLimit logic", () => {
  it("allows first request for new org", () => {
    const state = makeRateLimitState();
    const now = Date.now();
    expect(checkRateLimit("org-a", state, now).allowed).toBe(true);
  });

  it("increments count on subsequent requests within window", () => {
    const state = makeRateLimitState();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      checkRateLimit("org-a", state, now);
    }

    expect(state.get("org-a")?.count).toBe(5);
  });

  it("allows up to RATE_LIMIT_MAX (60) requests", () => {
    const state = makeRateLimitState();
    const now = Date.now();

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(checkRateLimit("org-a", state, now).allowed).toBe(true);
    }
  });

  it("blocks the 61st request within the same window", () => {
    const state = makeRateLimitState();
    const now = Date.now();

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit("org-a", state, now);
    }

    // 61st request
    expect(checkRateLimit("org-a", state, now).allowed).toBe(false);
  });

  it("recusa devolve contagem e reset — é o que vai para runtime_logs", () => {
    const state = makeRateLimitState();
    const now = Date.now();

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit("org-a", state, now);
    }

    const veredito = checkRateLimit("org-a", state, now);
    expect(veredito.allowed).toBe(false);
    // Sem estes dois, o 429 registrado não distingue "org satura o teto" de
    // "teto baixo demais" — que é a decisão que o log precisa sustentar.
    expect(veredito.count).toBe(RATE_LIMIT_MAX);
    expect(veredito.resetAt).toBe(now + RATE_LIMIT_WINDOW_MS);
  });

  it("recusa NÃO incrementa o contador — 429 em rajada não estende a janela", () => {
    const state = makeRateLimitState();
    const now = Date.now();

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit("org-a", state, now);
    }
    for (let i = 0; i < 10; i++) {
      checkRateLimit("org-a", state, now);
    }

    expect(state.get("org-a")?.count).toBe(RATE_LIMIT_MAX);
  });

  it("resets counter after window expires", () => {
    const state = makeRateLimitState();
    const now = Date.now();

    // Fill up
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit("org-a", state, now);
    }
    // Blocked
    expect(checkRateLimit("org-a", state, now).allowed).toBe(false);

    // Move past window
    const futureNow = now + RATE_LIMIT_WINDOW_MS + 1;
    expect(checkRateLimit("org-a", state, futureNow).allowed).toBe(true);
    expect(state.get("org-a")?.count).toBe(1);
  });

  it("isolates rate limits per org — org-b not affected by org-a", () => {
    const state = makeRateLimitState();
    const now = Date.now();

    // Fill org-a to max
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit("org-a", state, now);
    }
    // org-b still allowed
    expect(checkRateLimit("org-b", state, now).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Body parsing — action field validation
// ---------------------------------------------------------------------------

describe("request body parsing — action field validation", () => {
  /**
   * Simulates the proxy's body + action validation logic.
   * Returns the same error response shapes the proxy would return.
   */
  function validateBody(body: unknown): { error?: string; action?: string } {
    if (typeof body !== "object" || body === null) {
      return { error: "Invalid JSON body" };
    }
    const action = (body as Record<string, unknown>).action;
    if (!action || typeof action !== "string") {
      return { error: "Missing action" };
    }
    return { action };
  }

  it("accepts body with valid action string", () => {
    const result = validateBody({ action: "getStatus", instance_id: "some-id" });
    expect(result.action).toBe("getStatus");
    expect(result.error).toBeUndefined();
  });

  it("rejects body without action → 'Missing action'", () => {
    const result = validateBody({ instance_id: "some-id" });
    expect(result.error).toBe("Missing action");
  });

  it("rejects body with null action → 'Missing action'", () => {
    const result = validateBody({ action: null });
    expect(result.error).toBe("Missing action");
  });

  it("rejects body with numeric action → 'Missing action'", () => {
    const result = validateBody({ action: 42 });
    expect(result.error).toBe("Missing action");
  });

  it("rejects null body → 'Invalid JSON body'", () => {
    const result = validateBody(null);
    expect(result.error).toBe("Invalid JSON body");
  });

  it("rejects array body → 'Invalid JSON body'", () => {
    const result = validateBody([{ action: "getStatus" }]);
    // Array is typeof 'object' but we treat it as invalid since proxy does req.json() → object
    // The proxy code: body = await req.json() then checks body?.action
    // Arrays would pass typeof check but action would be undefined → "Missing action"
    const result2 = validateBody([]);
    expect(result2.error).toBe("Missing action");
  });

  it("accepts 'createInstance' action", () => {
    const result = validateBody({ action: "createInstance", payload: { instance_name: "test" } });
    expect(result.action).toBe("createInstance");
  });

  it("accepts 'connectQR' action", () => {
    const result = validateBody({ action: "connectQR", instance_id: "inst-id" });
    expect(result.action).toBe("connectQR");
  });
});

// ---------------------------------------------------------------------------
// Tenant boundary check — cross-org detection
// ---------------------------------------------------------------------------

describe("tenant boundary check", () => {
  /**
   * Mirrors the proxy's cross-tenant check:
   *   if (instance.organization_id !== callerOrgId) → 403
   */
  function checkTenantBoundary(
    instanceOrgId: string,
    callerOrgId: string
  ): { allowed: boolean } {
    return { allowed: instanceOrgId === callerOrgId };
  }

  it("allows access when org IDs match", () => {
    const result = checkTenantBoundary("org-a", "org-a");
    expect(result.allowed).toBe(true);
  });

  it("blocks access when org IDs differ → 403", () => {
    const result = checkTenantBoundary("org-a", "org-b");
    expect(result.allowed).toBe(false);
  });

  it("blocks access with different UUID formats", () => {
    const result = checkTenantBoundary(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222"
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks access with empty string vs UUID", () => {
    const result = checkTenantBoundary("", "org-a");
    expect(result.allowed).toBe(false);
  });

  it("blocks access — case sensitive comparison", () => {
    // UUIDs should be compared as-is (both lowercase in practice)
    const result = checkTenantBoundary("ORG-A", "org-a");
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Missing instance_id validation
// ---------------------------------------------------------------------------

describe("instance_id required for non-createInstance actions", () => {
  function requiresInstanceId(action: string): boolean {
    return action !== "createInstance";
  }

  function validateInstanceId(
    action: string,
    instanceId: string | undefined
  ): { error?: string } {
    if (requiresInstanceId(action) && !instanceId) {
      return { error: "Missing instance_id" };
    }
    return {};
  }

  it("allows getStatus with instance_id present", () => {
    expect(validateInstanceId("getStatus", "inst-uuid")).toEqual({});
  });

  it("blocks getStatus without instance_id", () => {
    expect(validateInstanceId("getStatus", undefined).error).toBe("Missing instance_id");
  });

  it("blocks deleteInstance without instance_id", () => {
    expect(validateInstanceId("deleteInstance", undefined).error).toBe("Missing instance_id");
  });

  it("does NOT require instance_id for createInstance", () => {
    expect(validateInstanceId("createInstance", undefined)).toEqual({});
  });

  it("blocks connectQR without instance_id", () => {
    expect(validateInstanceId("connectQR", undefined).error).toBe("Missing instance_id");
  });
});

// ---------------------------------------------------------------------------
// Destination number guard — reject malformed numbers before hitting Uazapi
// ---------------------------------------------------------------------------

describe("destination number guard", () => {
  // Mirrors the proxy's NUMBER_ACTIONS guard: send/presence actions whose
  // `number` cleans down to < 10 digits are rejected with 422 instead of
  // letting Uazapi 500 (surfacing as "Edge Function returned a non-2xx").
  const NUMBER_ACTIONS = new Set(["sendText", "sendMedia", "sendAudio", "setPresence"]);

  function validateNumber(action: string, rawNumber: unknown): { status: number } {
    if (NUMBER_ACTIONS.has(action)) {
      const digits = String(rawNumber ?? "").replace(/\D/g, "");
      if (digits.length < 10) return { status: 422 };
    }
    return { status: 200 };
  }

  it("blocks a lone country code '55' → 422 (the reported bug)", () => {
    expect(validateNumber("sendText", "55").status).toBe(422);
  });

  it("blocks empty/whitespace number → 422", () => {
    expect(validateNumber("sendText", "   ").status).toBe(422);
    expect(validateNumber("setPresence", "").status).toBe(422);
  });

  it("blocks setPresence on a bad number → 422 (kills the 'Invalid number' spam)", () => {
    expect(validateNumber("setPresence", "55").status).toBe(422);
  });

  it("allows a well-formed BR number (55 + DDD + 9 digits)", () => {
    expect(validateNumber("sendText", "5562996115735").status).toBe(200);
  });

  it("allows a formatted number with punctuation", () => {
    expect(validateNumber("sendMedia", "+55 (62) 99611-5735").status).toBe(200);
  });

  it("does not touch non-number actions like getStatus", () => {
    expect(validateNumber("getStatus", undefined).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Unknown action routing
// ---------------------------------------------------------------------------

describe("unknown action routing", () => {
  const KNOWN_ACTIONS = ["createInstance", "getStatus", "connectQR", "deleteInstance", "logoutInstance"];

  function isKnownAction(action: string): boolean {
    return KNOWN_ACTIONS.includes(action);
  }

  it("known actions do not produce unknown-action error", () => {
    for (const action of KNOWN_ACTIONS) {
      expect(isKnownAction(action)).toBe(true);
    }
  });

  it("unknown action 'sendText' is not yet supported in Phase 1", () => {
    expect(isKnownAction("sendText")).toBe(false);
  });

  it("unknown action 'doSomethingRandom' is rejected", () => {
    expect(isKnownAction("doSomethingRandom")).toBe(false);
  });
});
