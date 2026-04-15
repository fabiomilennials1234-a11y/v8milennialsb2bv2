/**
 * Crypto + logTinyOp + getOrgTinyToken coverage for tinyerp-utils.ts.
 *
 * ENCRYPTION_KEY_HEX is captured at module import time — use
 * vi.resetModules() + dynamic import to re-bind with a test key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

const TEST_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function loadModule() {
  vi.resetModules();
  return await import("../../supabase/functions/_shared/tinyerp-utils");
}

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
});

// ─── encrypt/decrypt ──────────────────────────────────────────────────────

describe("tinyerp encryptToken / decryptToken — with key", () => {
  it("round-trips a token", async () => {
    setDenoEnv("TINYERP_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { encryptToken, decryptToken } = await loadModule();

    const { encrypted, nonce } = await encryptToken("tiny-api-token-xyz");
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);

    const decrypted = await decryptToken(encrypted, nonce);
    expect(decrypted).toBe("tiny-api-token-xyz");
  });

  it("produces fresh nonce per call", async () => {
    setDenoEnv("TINYERP_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { encryptToken } = await loadModule();
    const a = await encryptToken("same");
    const b = await encryptToken("same");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("throws on invalid hex key", async () => {
    setDenoEnv("TINYERP_ENCRYPTION_KEY", "not-hex-at-all");
    const { encryptToken } = await loadModule();
    await expect(encryptToken("x")).rejects.toThrow();
  });
});

// ─── logTinyOp ────────────────────────────────────────────────────────────

describe("logTinyOp", () => {
  it("inserts a success log with all fields", async () => {
    const { logTinyOp } = await loadModule();
    const inserted: unknown[] = [];
    const sb = {
      from: () => ({
        insert: (row: unknown) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    } as any;
    await logTinyOp(sb, {
      organization_id: "org-1",
      operation: "push_order",
      status: "success",
      items_processed: 5,
      items_created: 3,
      items_updated: 2,
      items_failed: 0,
      local_reference_id: "lead-1",
      local_reference_type: "lead",
      tiny_reference_id: "order-123",
      request_payload: { foo: "bar" },
      response_payload: { ok: true },
      initiated_by: "ai_agent",
    });
    expect(inserted).toHaveLength(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.operation).toBe("push_order");
    expect(row.items_processed).toBe(5);
    expect(row.initiated_by).toBe("ai_agent");
  });

  it("applies defaults for optional fields", async () => {
    const { logTinyOp } = await loadModule();
    const inserted: Record<string, unknown>[] = [];
    const sb = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    } as any;
    await logTinyOp(sb, {
      organization_id: "org-1",
      operation: "sync_products",
      status: "success",
    });
    expect(inserted[0].items_processed).toBe(0);
    expect(inserted[0].items_created).toBe(0);
    expect(inserted[0].items_updated).toBe(0);
    expect(inserted[0].items_failed).toBe(0);
    expect(inserted[0].error_message).toBeNull();
    expect(inserted[0].initiated_by).toBe("user");
  });

  it("logs error when insert fails (line 195)", async () => {
    const { logTinyOp } = await loadModule();
    const sb = {
      from: () => ({
        insert: () =>
          Promise.resolve({ error: { message: "table gone" } }),
      }),
    } as any;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await logTinyOp(sb, {
      organization_id: "org-1",
      operation: "test",
      status: "error",
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─── getOrgTinyToken ──────────────────────────────────────────────────────

describe("getOrgTinyToken", () => {
  it("returns null when no connection found", async () => {
    setDenoEnv("TINYERP_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { getOrgTinyToken } = await loadModule();
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as any;
    expect(await getOrgTinyToken(sb, "org-1")).toBeNull();
  });

  it("returns null when query errors", async () => {
    setDenoEnv("TINYERP_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { getOrgTinyToken } = await loadModule();
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: null, error: { message: "rls" } }),
            }),
          }),
        }),
      }),
    } as any;
    expect(await getOrgTinyToken(sb, "org-1")).toBeNull();
  });

  it("returns decrypted token on happy path", async () => {
    setDenoEnv("TINYERP_ENCRYPTION_KEY", TEST_KEY_HEX);
    const mod = await loadModule();
    const { encrypted, nonce } = await mod.encryptToken("real-token-value");

    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "conn-1",
                    encrypted_api_token: encrypted,
                    encryption_nonce: nonce,
                    status: "connected",
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as any;

    const result = await mod.getOrgTinyToken(sb, "org-1");
    expect(result).not.toBeNull();
    expect(result!.token).toBe("real-token-value");
    expect(result!.connectionId).toBe("conn-1");
  });

  it("returns null when decrypt throws (line 216-218)", async () => {
    setDenoEnv("TINYERP_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { getOrgTinyToken } = await loadModule();
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "conn-1",
                    encrypted_api_token: "corrupted-base64-!@#",
                    encryption_nonce: "corrupted-!@#",
                    status: "connected",
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as any;

    const result = await getOrgTinyToken(sb, "org-1");
    expect(result).toBeNull();
  });
});
