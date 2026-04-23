/**
 * Unit tests for redactSecrets() in logger.ts
 *
 * Run: npm run test:unit -- logger-redact
 *
 * Notes on over-redaction:
 * - Keys that CONTAIN a sensitive substring are redacted even if the full
 *   key name is not exactly sensitive (e.g. "user_token_count" contains
 *   "token" and will be redacted). This is intentional per security policy.
 */

import { describe, it, expect } from "vitest";

// ─── Stub Deno so the module loads in Node/Vitest ────────────────────────────
// logger.ts imports from Deno namespaces only at runtime inside async functions,
// but the module-level code doesn't touch Deno. We stub the global just in case.
if (typeof globalThis.Deno === "undefined") {
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: () => undefined },
    serve: () => undefined,
  };
}

// We only import the pure function, not logRuntime (which uses Deno + Supabase).
// Dynamic import lets us isolate without triggering Deno.serve at module level.
import { redactSecrets } from "../../supabase/functions/_shared/logger.ts";

describe("redactSecrets()", () => {
  // ── 1. uazapi_token key is redacted ───────────────────────────────────────
  it("redacts key 'uazapi_token'", () => {
    const input = { uazapi_token: "abc123secret", user: "fabio" };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.uazapi_token).toBe("***REDACTED***");
    expect(result.user).toBe("fabio");
  });

  // ── 2. UAZAPI_TOKEN (uppercase) is redacted ───────────────────────────────
  it("redacts key 'UAZAPI_TOKEN' (uppercase)", () => {
    const input = { UAZAPI_TOKEN: "supersecret" };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.UAZAPI_TOKEN).toBe("***REDACTED***");
  });

  // ── 3. admintoken (no underscore) is redacted ────────────────────────────
  it("redacts key 'admintoken' (no underscore)", () => {
    const input = { admintoken: "my-admin-token" };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.admintoken).toBe("***REDACTED***");
  });

  // ── 4. user_token_name over-redacted (contains "token") ──────────────────
  it("over-redacts 'user_token_name' because it contains 'token'", () => {
    // Documented intentional behavior: security > debug verbosity.
    const input = { user_token_name: "display-only-label" };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.user_token_name).toBe("***REDACTED***");
  });

  // ── 5. Authorization Bearer value: prefix preserved ──────────────────────
  it("redacts 'Authorization: Bearer xxx' keeping prefix", () => {
    const input = { Authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig" };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.Authorization).toBe("Bearer ***REDACTED***");
  });

  // ── 6. Nested 3 levels deep ───────────────────────────────────────────────
  it("redacts keys nested 3 levels deep", () => {
    const input = {
      a: {
        b: {
          apikey: "deep-secret",
          safe: "visible",
        },
      },
    };
    const result = redactSecrets(input) as { a: { b: { apikey: unknown; safe: unknown } } };
    expect(result.a.b.apikey).toBe("***REDACTED***");
    expect(result.a.b.safe).toBe("visible");
  });

  // ── 7. Array of objects: each item redacted independently ─────────────────
  it("redacts each element in an array of objects", () => {
    const input = [{ token: "a" }, { token: "b" }];
    const result = redactSecrets(input) as Array<{ token: unknown }>;
    expect(result[0].token).toBe("***REDACTED***");
    expect(result[1].token).toBe("***REDACTED***");
  });

  // ── 8. Primitive string passes through unchanged ──────────────────────────
  it("returns primitive string unchanged when no Bearer/Basic prefix", () => {
    expect(redactSecrets("plain string")).toBe("plain string");
  });

  // ── 9. null passes through ────────────────────────────────────────────────
  it("returns null unchanged", () => {
    expect(redactSecrets(null)).toBeNull();
  });

  // ── 10. undefined passes through ─────────────────────────────────────────
  it("returns undefined unchanged", () => {
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  // ── 11. Circular reference does not cause stack overflow ──────────────────
  it("handles circular reference without stack overflow", () => {
    const obj: Record<string, unknown> = { safe: "value" };
    obj.self = obj; // circular
    expect(() => redactSecrets(obj)).not.toThrow();
    const result = redactSecrets(obj) as Record<string, unknown>;
    expect(result.safe).toBe("value");
    expect(result.self).toBe("[Circular]");
  });

  // ── 12. Input object is not mutated (immutability) ────────────────────────
  it("does not mutate the input object", () => {
    const input = { token: "original", safe: "also-original" };
    redactSecrets(input);
    expect(input.token).toBe("original");
    expect(input.safe).toBe("also-original");
  });

  // ── 13. Payload without sensitive keys passes through unchanged ───────────
  it("passes through payload with no sensitive keys unchanged", () => {
    const input = { name: "Fabio", company: "Milennials", count: 42 };
    const result = redactSecrets(input) as typeof input;
    expect(result).toEqual({ name: "Fabio", company: "Milennials", count: 42 });
  });

  // ── 14. Number and boolean primitives pass through ────────────────────────
  it("returns number and boolean primitives unchanged", () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(false)).toBe(false);
  });

  // ── 15. api_key and api-key keys are redacted ────────────────────────────
  it("redacts 'api_key' and 'api-key' keys", () => {
    const input = { api_key: "k1", "api-key": "k2" };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.api_key).toBe("***REDACTED***");
    expect(result["api-key"]).toBe("***REDACTED***");
  });

  // ── 16. webhook_secret and UAZAPI_WEBHOOK_SECRET redacted ────────────────
  it("redacts 'webhook_secret' and 'UAZAPI_WEBHOOK_SECRET'", () => {
    const input = {
      webhook_secret: "hmac-secret-value",
      UAZAPI_WEBHOOK_SECRET: "another-secret",
    };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.webhook_secret).toBe("***REDACTED***");
    expect(result.UAZAPI_WEBHOOK_SECRET).toBe("***REDACTED***");
  });

  // ── 17. Mixed array of primitives and objects ─────────────────────────────
  it("handles mixed array containing primitives and objects", () => {
    const input = ["plain", { token: "secret" }, 99, null];
    const result = redactSecrets(input) as unknown[];
    expect(result[0]).toBe("plain");
    expect((result[1] as Record<string, unknown>).token).toBe("***REDACTED***");
    expect(result[2]).toBe(99);
    expect(result[3]).toBeNull();
  });

  // ── 18. UAZAPI_ADMIN_TOKEN key is redacted ────────────────────────────────
  // Env var name used in .env.example and referenced by whatsapp-client.ts factory.
  // Matched by "admin_token" and "token" patterns.
  it("redacts key 'UAZAPI_ADMIN_TOKEN'", () => {
    const input = { UAZAPI_ADMIN_TOKEN: "super-secret-admin-token-value" };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.UAZAPI_ADMIN_TOKEN).toBe("***REDACTED***");
  });
});
