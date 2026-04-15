/**
 * Crypto + getValidAccessToken coverage for google-calendar-utils.ts
 *
 * ENCRYPTION_KEY_HEX is captured at module import time, so we reset the
 * vitest module cache and dynamically re-import after setting the env.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const TEST_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

async function loadModule() {
  vi.resetModules();
  return await import(
    "../../supabase/functions/_shared/google-calendar-utils"
  );
}

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

// ─── encrypt/decrypt round-trip ───────────────────────────────────────────

describe("encryptToken / decryptToken — with key", () => {
  it("round-trips a string correctly", async () => {
    setDenoEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { encryptToken, decryptToken } = await loadModule();

    const { encrypted, nonce } = await encryptToken("super-secret-value");
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);

    const decrypted = await decryptToken(encrypted, nonce);
    expect(decrypted).toBe("super-secret-value");
  });

  it("encrypt produces different output with fresh nonce", async () => {
    setDenoEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { encryptToken } = await loadModule();

    const a = await encryptToken("same-value");
    const b = await encryptToken("same-value");
    // AES-GCM with random nonce → different ciphertexts
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("round-trips unicode content", async () => {
    setDenoEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { encryptToken, decryptToken } = await loadModule();
    const plain = "olá — 日本語 🎯";
    const { encrypted, nonce } = await encryptToken(plain);
    expect(await decryptToken(encrypted, nonce)).toBe(plain);
  });

  it("throws on invalid hex key", async () => {
    setDenoEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", "not-hex");
    const { encryptToken } = await loadModule();
    await expect(encryptToken("x")).rejects.toThrow();
  });
});

// ─── getValidAccessToken ──────────────────────────────────────────────────

describe("getValidAccessToken", () => {
  it("returns null when no active token record", async () => {
    setDenoEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", TEST_KEY_HEX);
    const { getValidAccessToken } = await loadModule();
    const { sb, mockTable } = createMockSupabase();
    mockTable("google_calendar_tokens", []);

    const result = await getValidAccessToken("user-x", sb);
    expect(result).toBeNull();
  });

  it("returns fresh access token after refresh + updates DB", async () => {
    setDenoEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", TEST_KEY_HEX);
    setDenoEnv("GOOGLE_CLIENT_ID", "cid");
    setDenoEnv("GOOGLE_CLIENT_SECRET", "csec");
    const mod = await loadModule();

    // Encrypt a refresh token the same way the real code does so decrypt works
    const { encrypted, nonce } = await mod.encryptToken("stored-refresh-token");

    const { sb, mockTable } = createMockSupabase();
    mockTable("google_calendar_tokens", [
      {
        user_id: "user-1",
        is_active: true,
        encrypted_refresh_token: encrypted,
        encryption_nonce: nonce,
        google_email: "user@example.com",
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ access_token: "new-access", expires_in: 3600 }),
    });

    const result = await mod.getValidAccessToken("user-1", sb);
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe("new-access");
    expect(result!.googleEmail).toBe("user@example.com");
    // Refresh fetch called
    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("propagates refreshAccessToken errors", async () => {
    setDenoEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", TEST_KEY_HEX);
    const mod = await loadModule();
    const { encrypted, nonce } = await mod.encryptToken("stored");

    const { sb, mockTable } = createMockSupabase();
    mockTable("google_calendar_tokens", [
      {
        user_id: "user-1",
        is_active: true,
        encrypted_refresh_token: encrypted,
        encryption_nonce: nonce,
        google_email: "u@x",
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "invalid_grant", error_description: "expired" }),
    });

    await expect(mod.getValidAccessToken("user-1", sb)).rejects.toThrow(
      /renovar token/,
    );
  });
});
