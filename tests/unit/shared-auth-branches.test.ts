/**
 * Branch coverage for _shared/auth.ts — validateApiKey (per-org tq_live_*
 * keys + legacy WEBHOOK_API_KEY) and validateOrganizationAccess error path.
 * Complements existing shared-auth.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import {
  validateApiKey,
  validateOrganizationAccess,
} from "../../supabase/functions/_shared/auth";

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
});

// ─── Helper: minimal supabase mock with configurable `from()` + `rpc()` ──

function makeSupabase(opts: {
  apiKeyRows?: Array<Record<string, unknown>>;
  selectError?: unknown;
  updateSpy?: (v: Record<string, unknown>) => void;
}) {
  return {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            or: () =>
              Promise.resolve({
                data: opts.apiKeyRows ?? null,
                error: opts.selectError ?? null,
              }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        opts.updateSpy?.(payload);
        return {
          eq: () => ({
            then: (resolve: (val: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve),
            catch: (fn: (err: unknown) => unknown) =>
              Promise.resolve(undefined).catch(fn),
          }),
        };
      },
    }),
  } as any;
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── validateApiKey ──────────────────────────────────────────────────────

describe("validateApiKey — extraction + legacy", () => {
  it("rejects when no key found in any header", async () => {
    const sb = makeSupabase({});
    const req = new Request("https://x");
    const result = await validateApiKey(sb, req);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("API key obrigatória");
  });

  it("accepts legacy WEBHOOK_API_KEY via X-API-Key header", async () => {
    setDenoEnv("WEBHOOK_API_KEY", "legacy-secret");
    const sb = makeSupabase({});
    const req = new Request("https://x", {
      headers: { "X-API-Key": "legacy-secret" },
    });
    const result = await validateApiKey(sb, req);
    expect(result.valid).toBe(true);
  });

  it("rejects legacy key when WEBHOOK_API_KEY not set", async () => {
    const sb = makeSupabase({});
    const req = new Request("https://x", {
      headers: { "X-API-Key": "anything" },
    });
    const result = await validateApiKey(sb, req);
    expect(result.valid).toBe(false);
  });

  it("rejects legacy key when value mismatches env", async () => {
    setDenoEnv("WEBHOOK_API_KEY", "right");
    const sb = makeSupabase({});
    const req = new Request("https://x", {
      headers: { "X-Webhook-Key": "wrong" },
    });
    const result = await validateApiKey(sb, req);
    expect(result.valid).toBe(false);
  });

  it("extracts tq_live_ key from Authorization Bearer", async () => {
    const sb = makeSupabase({ apiKeyRows: [] });
    const req = new Request("https://x", {
      headers: { Authorization: "Bearer tq_live_fakeabcd" },
    });
    const result = await validateApiKey(sb, req);
    // empty rows → invalid
    expect(result.valid).toBe(false);
    expect(result.error).toContain("inválida ou expirada");
  });
});

describe("validateApiKey — per-org tq_live_* keys", () => {
  it("returns DB error when select fails", async () => {
    const sb = makeSupabase({ selectError: { message: "timeout" } });
    const req = new Request("https://x", {
      headers: { "X-Webhook-Key": "tq_live_abc123xyz" },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await validateApiKey(sb, req);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Erro interno");
    spy.mockRestore();
  });

  it("rejects when no matching api_keys row", async () => {
    const sb = makeSupabase({ apiKeyRows: [] });
    const req = new Request("https://x", {
      headers: { "X-Webhook-Key": "tq_live_doesnt" },
    });
    expect((await validateApiKey(sb, req)).valid).toBe(false);
  });

  it("rejects when hash does not match any candidate", async () => {
    const sb = makeSupabase({
      apiKeyRows: [
        {
          id: "k1",
          organization_id: "org-1",
          key_hash: "different-hash-value",
          rate_limit_per_minute: 60,
        },
      ],
    });
    const req = new Request("https://x", {
      headers: { "X-Webhook-Key": "tq_live_abcdefghij" },
    });
    expect((await validateApiKey(sb, req)).valid).toBe(false);
  });

  it("returns org context + updates last_used_at when hash matches", async () => {
    const raw = "tq_live_abcdefghij";
    const hash = await sha256Hex(raw);
    const updates: Record<string, unknown>[] = [];
    const sb = makeSupabase({
      apiKeyRows: [
        {
          id: "k1",
          organization_id: "org-42",
          key_hash: hash,
          rate_limit_per_minute: 600,
        },
      ],
      updateSpy: (v) => updates.push(v),
    });
    const req = new Request("https://x", {
      headers: { "X-Webhook-Key": raw },
    });
    const result = await validateApiKey(sb, req);
    expect(result.valid).toBe(true);
    expect(result.organizationId).toBe("org-42");
    expect(result.keyId).toBe("k1");
    expect(result.rateLimitPerMinute).toBe(600);
    // Fire-and-forget update touched last_used_at
    expect(updates[0]?.last_used_at).toBeDefined();
  });

  it("iterates candidates when prefix collision exists", async () => {
    const raw = "tq_live_collision1";
    const hash = await sha256Hex(raw);
    const sb = makeSupabase({
      apiKeyRows: [
        { id: "k_other", organization_id: "org-A", key_hash: "wrong-1" },
        { id: "k_match", organization_id: "org-B", key_hash: hash },
      ],
    });
    const req = new Request("https://x", {
      headers: { "X-Webhook-Key": raw },
    });
    const result = await validateApiKey(sb, req);
    expect(result.valid).toBe(true);
    expect(result.organizationId).toBe("org-B");
  });
});

// ─── validateOrganizationAccess DB error branch ──────────────────────────

describe("validateOrganizationAccess — DB error branch", () => {
  it("returns false and logs when select errors", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: null, error: { message: "rls denied" } }),
            }),
          }),
        }),
      }),
    } as any;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await validateOrganizationAccess(sb, "user-1", "org-1");
    expect(result).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
