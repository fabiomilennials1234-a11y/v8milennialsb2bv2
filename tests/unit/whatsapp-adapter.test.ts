/**
 * Unit tests for WhatsApp adapter factory and providers.
 *
 * No network calls — fetch, Deno.env, and dynamic imports are mocked.
 *
 * Covers:
 *  - getWhatsAppProvider returns UazapiProvider for uazapi instances (after RPC)
 *  - getWhatsAppProvider returns EvolutionProvider for evolution instances (no RPC)
 *  - UazapiProvider translates sendText options to UazapiClient correctly
 *  - EvolutionProvider throws NotSupportedError on Uazapi-only methods
 *  - NotSupportedError.name === 'NotSupportedError'
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Polyfill Deno global for Node/Vitest environment
// ---------------------------------------------------------------------------

const envStore: Record<string, string> = {
  UAZAPI_BASE_URL: "https://uazapi.example.com",
  UAZAPI_ADMIN_TOKEN: "admin-secret",
  EVOLUTION_API_URL: "https://evolution.example.com",
  EVOLUTION_API_KEY: "evo-api-key",
};

if (typeof globalThis.Deno === "undefined") {
  (globalThis as Record<string, unknown>).Deno = {
    env: {
      get: (key: string) => envStore[key] ?? undefined,
    },
    serve: () => {},
  };
}

// ---------------------------------------------------------------------------
// Imports after polyfill
// ---------------------------------------------------------------------------

import {
  getWhatsAppProvider,
  NotSupportedError,
  type WhatsAppInstance,
} from "../../supabase/functions/_shared/whatsapp-client.ts";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const UAZAPI_INSTANCE: WhatsAppInstance = {
  id: "inst-uazapi-uuid",
  organization_id: "org-a",
  provider: "uazapi",
  instance_name: "my-uazapi-instance",
};

const EVOLUTION_INSTANCE: WhatsAppInstance = {
  id: "inst-evo-uuid",
  organization_id: "org-a",
  provider: "evolution",
  instance_name: "my-evo-instance",
  evolution_api_key: "evo-key",
  evolution_instance_name: "my-evo-instance",
};

// Minimal mock SupabaseClient
function makeAdminMock(overrides: Partial<{ rpc: ReturnType<typeof vi.fn> }> = {}) {
  return {
    rpc: overrides.rpc ?? vi.fn().mockResolvedValue({
      data: [{ uazapi_token: "tok-per-instance" }],
      error: null,
    }),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  UazapiClient._resetCircuitState();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  UazapiClient._resetCircuitState();
});

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("getWhatsAppProvider — factory", () => {
  it("returns UazapiProvider for uazapi instance", async () => {
    const admin = makeAdminMock();
    const provider = await getWhatsAppProvider(UAZAPI_INSTANCE, admin);
    expect(provider).toBeInstanceOf(UazapiProvider);
    expect(provider.provider).toBe("uazapi");
  });

  it("calls get_uazapi_credentials RPC for uazapi instance", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [{ uazapi_token: "tok-xyz" }],
      error: null,
    });
    const admin = makeAdminMock({ rpc: rpcMock });
    await getWhatsAppProvider(UAZAPI_INSTANCE, admin);

    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith("get_uazapi_credentials", {
      p_instance_id: UAZAPI_INSTANCE.id,
    });
  });

  it("throws when provider is not uazapi (Evolution removed in Fase 7)", async () => {
    const rpcMock = vi.fn();
    const admin = makeAdminMock({ rpc: rpcMock });
    await expect(
      getWhatsAppProvider(EVOLUTION_INSTANCE, admin)
    ).rejects.toThrow(/only "uazapi" is supported/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws when uazapi RPC returns error", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "RPC failed" },
    });
    const admin = makeAdminMock({ rpc: rpcMock });
    await expect(
      getWhatsAppProvider(UAZAPI_INSTANCE, admin)
    ).rejects.toThrow("Failed to fetch uazapi credentials");
  });

  it("throws when uazapi RPC returns empty data", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });
    const admin = makeAdminMock({ rpc: rpcMock });
    await expect(
      getWhatsAppProvider(UAZAPI_INSTANCE, admin)
    ).rejects.toThrow("No uazapi credentials found");
  });

  it("throws when UAZAPI_BASE_URL env not set", async () => {
    const original = envStore.UAZAPI_BASE_URL;
    delete envStore.UAZAPI_BASE_URL;

    const admin = makeAdminMock();
    await expect(
      getWhatsAppProvider(UAZAPI_INSTANCE, admin)
    ).rejects.toThrow("UAZAPI_BASE_URL");

    envStore.UAZAPI_BASE_URL = original;
  });
});

// ---------------------------------------------------------------------------
// UazapiProvider.sendText — option translation
// ---------------------------------------------------------------------------

describe("UazapiProvider.sendText — option translation", () => {
  function makeProvider(token = "tok-instance") {
    return new UazapiProvider({
      baseUrl: "https://uazapi.example.com",
      token,
      adminToken: "admin-secret",
      instanceId: "inst-id",
      organizationId: "org-a",
      supabaseAdmin: makeAdminMock() as unknown as import("@supabase/supabase-js").SupabaseClient,
    });
  }

  const OK_RESPONSE = JSON.stringify({ id: "msg-1", status: "sent", timestamp: 1700000000 });

  it("maps trackSource → track_source and trackId → track_id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(OK_RESPONSE, { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const provider = makeProvider();
    await provider.sendText({
      number: "5511999999999",
      text: "Hello",
      trackSource: "copilot-agent-abc",
      trackId: "my-idempotency-key",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.track_source).toBe("copilot-agent-abc");
    expect(body.track_id).toBe("my-idempotency-key");
  });

  it("maps replyid and readchat fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(OK_RESPONSE, { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const provider = makeProvider();
    await provider.sendText({
      number: "5511999999999",
      text: "Reply",
      replyid: "quoted-msg-id",
      readchat: true,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.replyid).toBe("quoted-msg-id");
    expect(body.readchat).toBe(true);
  });

  it("returns normalised SendResult from UazapiMessageResponse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(OK_RESPONSE, { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const provider = makeProvider();
    const result = await provider.sendText({ number: "5511999999999", text: "Hi" });

    expect(result.message_id).toBe("msg-1");
    expect(result.status).toBe("sent");
    expect(result.timestamp).toBe(1700000000);
  });
});

// ---------------------------------------------------------------------------
// NotSupportedError — shape
// ---------------------------------------------------------------------------

describe("NotSupportedError", () => {
  it("name === 'NotSupportedError'", () => {
    const err = new NotSupportedError("evolution", "sendMenu");
    expect(err.name).toBe("NotSupportedError");
  });

  it("message contains provider and method", () => {
    const err = new NotSupportedError("evolution", "sendMenu");
    expect(err.message).toContain("evolution");
    expect(err.message).toContain("sendMenu");
  });

  it("instanceof Error", () => {
    const err = new NotSupportedError("evolution", "react");
    expect(err).toBeInstanceOf(Error);
  });

  it("exposes provider and method fields", () => {
    const err = new NotSupportedError("evolution", "pin");
    expect(err.provider).toBe("evolution");
    expect(err.method).toBe("pin");
  });
});
