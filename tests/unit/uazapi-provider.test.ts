/**
 * Unit tests for UazapiProvider
 *
 * Tests direct UazapiProvider behaviour — option translation, RPC calls,
 * status normalisation, and Uazapi-only methods routing to UazapiClient.
 *
 * UazapiClient.request is mocked via global fetch mock.
 * supabaseAdmin.rpc is mocked with vi.fn().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";

// ---------------------------------------------------------------------------
// Polyfill Deno for Node/Vitest
// ---------------------------------------------------------------------------

if (typeof globalThis.Deno === "undefined") {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: () => undefined },
    serve: () => {},
  };
}

import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts";
import type {
  CreateInstanceInput,
} from "../../supabase/functions/_shared/whatsapp-client.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRpc(returnValue: unknown = { data: null, error: null }) {
  return vi.fn().mockResolvedValue(returnValue);
}

function makeAdminMock(rpcOverride?: ReturnType<typeof vi.fn>) {
  return {
    rpc: rpcOverride ?? makeRpc(),
  } as unknown as SupabaseClient;
}

function makeProvider(opts?: { rpc?: ReturnType<typeof vi.fn> }): UazapiProvider {
  return new UazapiProvider({
    baseUrl: "https://uazapi.test",
    token: "tok-instance-abc",
    adminToken: "admin-token-xyz",
    instanceId: "inst-uuid-123",
    organizationId: "org-uuid-456",
    supabaseAdmin: makeAdminMock(opts?.rpc),
  });
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
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

async function withTimers<T>(promise: Promise<T>): Promise<T> {
  const [result] = await Promise.allSettled([promise, vi.runAllTimersAsync()]);
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

// ---------------------------------------------------------------------------
// sendText — camelCase → snake_case translation
// ---------------------------------------------------------------------------

describe("UazapiProvider.sendText — option translation", () => {
  it("maps trackSource → track_source", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-1", status: "sent", timestamp: 1700000000 })
    );

    const provider = makeProvider();
    await provider.sendText({
      number: "5511999999999",
      text: "Hello",
      trackSource: "copilot-agent-abc",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.track_source).toBe("copilot-agent-abc");
    expect(body.trackSource).toBeUndefined();
  });

  it("maps trackId → track_id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-2", status: "sent", timestamp: 1700000000 })
    );

    const provider = makeProvider();
    await provider.sendText({
      number: "5511999999999",
      text: "Hello",
      trackId: "dedup-key-abc",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.track_id).toBe("dedup-key-abc");
    expect(body.trackId).toBeUndefined();
  });

  it("maps both trackSource and trackId simultaneously", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-3", status: "sent", timestamp: 1700000000 })
    );

    const provider = makeProvider();
    await provider.sendText({
      number: "5511999999999",
      text: "Hello",
      trackSource: "workflow-x",
      trackId: "wf-idempotency-key",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.track_source).toBe("workflow-x");
    expect(body.track_id).toBe("wf-idempotency-key");
  });

  it("returns normalised SendResult from UazapiMessageResponse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-abc", status: "queued", timestamp: 1700001234 })
    );

    const provider = makeProvider();
    const result = await provider.sendText({ number: "5511999999999", text: "Hi" });

    expect(result.message_id).toBe("msg-abc");
    expect(result.status).toBe("queued");
    expect(result.timestamp).toBe(1700001234);
  });
});

// ---------------------------------------------------------------------------
// sendMedia — type mapping including ptt
// ---------------------------------------------------------------------------

describe("UazapiProvider.sendMedia — type mapping", () => {
  it("maps type='ptt' through to UazapiClient correctly", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-ptt-1", status: "sent", timestamp: 1700000000 })
    );

    const provider = makeProvider();
    await provider.sendMedia({
      number: "5511999999999",
      type: "ptt",
      file: "data:audio/ogg;base64,abc123",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/send/media");
    const body = JSON.parse(init?.body as string);
    expect(body.type).toBe("ptt");
  });

  it("maps track_source and track_id in sendMedia body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-med-1", status: "sent", timestamp: 1700000000 })
    );

    const provider = makeProvider();
    await provider.sendMedia({
      number: "5511999999999",
      type: "image",
      file: "https://example.com/img.png",
      trackSource: "campaign-media",
      trackId: "camp-msg-001",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.track_source).toBe("campaign-media");
    expect(body.track_id).toBe("camp-msg-001");
  });

  it("returns normalised SendResult", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-med-2", status: "sent", timestamp: 1700000099 })
    );

    const provider = makeProvider();
    const result = await provider.sendMedia({
      number: "5511999999999",
      type: "document",
      file: "https://example.com/doc.pdf",
    });

    expect(result.message_id).toBe("msg-med-2");
    expect(result.status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// createInstance — calls initInstance + set_uazapi_credentials RPC
// ---------------------------------------------------------------------------

describe("UazapiProvider.createInstance", () => {
  const INSTANCE_INIT_RESPONSE = {
    id: "uazapi-inst-id-001",
    name: "my-instance",
    token: "per-instance-tok-xyz",
    status: "created",
  };

  function makeCreateInput(): CreateInstanceInput {
    return {
      instance_id: "inst-uuid-123",
      organization_id: "org-uuid-456",
      instance_name: "my-instance",
      webhook_url: "https://example.com/webhook",
      webhook_secret: "secret-123",
    };
  }

  it("calls initInstance on /instance/init with admintoken header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, INSTANCE_INIT_RESPONSE));

    const rpc = makeRpc({ data: null, error: null });
    const provider = makeProvider({ rpc });

    await provider.createInstance(makeCreateInput());

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/instance/init");
    const headers = init?.headers as Record<string, string>;
    expect(headers["admintoken"]).toBe("admin-token-xyz");
  });

  it("calls set_uazapi_credentials RPC with correct parameters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, INSTANCE_INIT_RESPONSE));

    const rpc = makeRpc({ data: null, error: null });
    const provider = makeProvider({ rpc });

    await provider.createInstance(makeCreateInput());

    expect(rpc).toHaveBeenCalledOnce();
    const [rpcName, rpcParams] = rpc.mock.calls[0];
    expect(rpcName).toBe("set_uazapi_credentials");
    expect(rpcParams).toEqual({
      p_instance_id: "inst-uuid-123",
      p_organization_id: "org-uuid-456",
      p_uazapi_instance_id: "uazapi-inst-id-001",
      p_uazapi_token: "per-instance-tok-xyz",
    });
    expect(rpcParams).not.toHaveProperty("p_uazapi_instance_name");
  });

  it("throws when RPC returns error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, INSTANCE_INIT_RESPONSE));

    const rpc = makeRpc({ data: null, error: { message: "constraint violation" } });
    const provider = makeProvider({ rpc });

    await expect(
      provider.createInstance(makeCreateInput())
    ).rejects.toThrow("Failed to persist uazapi credentials via RPC");
  });

  it("returns CreateInstanceResult with provider_instance_id and provider_token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, INSTANCE_INIT_RESPONSE));

    const rpc = makeRpc({ data: null, error: null });
    const provider = makeProvider({ rpc });

    const result = await provider.createInstance(makeCreateInput());

    expect(result.provider_instance_id).toBe("uazapi-inst-id-001");
    expect(result.provider_token).toBe("per-instance-tok-xyz");
  });
});

// ---------------------------------------------------------------------------
// getStatus — normalises Uazapi payload to InstanceStatus
// ---------------------------------------------------------------------------

describe("UazapiProvider.getStatus — status normalisation", () => {
  it("normalises {connected: true} payload to InstanceStatus.connected = true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { status: "connected", connected: true })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.connected).toBe(true);
    expect(status.state).toBe("connected");
  });

  it("normalises {status: 'disconnected', connected: false} payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { status: "disconnected", connected: false })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.connected).toBe(false);
    expect(status.state).toBe("disconnected");
  });

  it("normalises {status: 'closed'} to state=disconnected", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { status: "closed", connected: false })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.state).toBe("disconnected");
  });

  it("normalises {status: 'connecting'} payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { status: "connecting", connected: false, qrcode: "data:image/png;base64,abc" })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.connected).toBe(false);
    expect(status.state).toBe("connecting");
    expect(status.qrcode).toBe("data:image/png;base64,abc");
  });

  it("normalises unknown status to state=unknown", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { status: "somethingweird", connected: false })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.state).toBe("unknown");
    expect(status.connected).toBe(false);
  });

  it("extracts owner number from a top-level owner JID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { status: "connected", connected: true, owner: "554899998888@s.whatsapp.net" })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.connected).toBe(true);
    expect(status.owner).toBe("554899998888");
  });

  it("extracts owner number from a nested instance object", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { instance: { status: "connected", connected: true, owner: "5548999998888" } })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.connected).toBe(true);
    expect(status.owner).toBe("5548999998888");
  });

  it("leaves owner undefined when the payload has no number", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { status: "connected", connected: true })
    );

    const provider = makeProvider();
    const status = await provider.getStatus();

    expect(status.owner).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// checkNumbers — /chat/check verdict normalisation + safety
// ---------------------------------------------------------------------------

describe("UazapiProvider.checkNumbers", () => {
  it("POSTs /chat/check and normalises the verdict to { number, isInWhatsapp }", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, [
        { query: "5511951674282", jid: "", isInWhatsapp: false },
        { query: "5511999999999", jid: "5511999999999@s.whatsapp.net", isInWhatsapp: true },
      ])
    );

    const provider = makeProvider();
    const res = await provider.checkNumbers(["5511951674282", "5511999999999"]);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/chat/check");
    expect(JSON.parse(init?.body as string)).toEqual({
      numbers: ["5511951674282", "5511999999999"],
    });
    expect(res).toEqual([
      { number: "5511951674282", isInWhatsapp: false },
      { number: "5511999999999", isInWhatsapp: true },
    ]);
  });

  it("treats a per-item error or missing verdict as reachable (never gates on ambiguity)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, [
        { query: "5511111111111", isInWhatsapp: false, error: "could not resolve" },
        { query: "5522222222222" }, // isInWhatsapp undefined
      ])
    );

    const provider = makeProvider();
    const res = await provider.checkNumbers(["5511111111111", "5522222222222"]);

    expect(res).toEqual([
      { number: "5511111111111", isInWhatsapp: true },
      { number: "5522222222222", isInWhatsapp: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Uazapi-only methods — route to UazapiClient correct endpoints
// ---------------------------------------------------------------------------

describe("UazapiProvider — Uazapi-only methods call correct endpoints", () => {
  it("react() calls /message/react with correct body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const provider = makeProvider();
    await provider.react("msg-id-1", "5511999999999", "👍");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/message/react");
    const body = JSON.parse(init?.body as string);
    expect(body.id).toBe("msg-id-1");
    expect(body.number).toBe("5511999999999");
    expect(body.emoji).toBe("👍");
  });

  it("edit() calls /message/edit with correct body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const provider = makeProvider();
    await provider.edit("msg-id-2", "5511999999999", "Updated text");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/message/edit");
    const body = JSON.parse(init?.body as string);
    expect(body.id).toBe("msg-id-2");
    expect(body.text).toBe("Updated text");
  });

  it("pin() calls /message/pin with correct body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const provider = makeProvider();
    await provider.pin("msg-id-3", "5511999999999");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/message/pin");
    const body = JSON.parse(init?.body as string);
    expect(body.id).toBe("msg-id-3");
    expect(body.number).toBe("5511999999999");
  });

  it("deleteForAll() calls /message/delete with correct body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const provider = makeProvider();
    await provider.deleteForAll("msg-id-4", "5511999999999");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/message/delete");
  });

  it("historySync() calls /message/history-sync", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { messages: [], nextCursor: undefined })
    );

    const provider = makeProvider();
    const result = await provider.historySync({ chat_jid: "5511999999999@s.whatsapp.net", limit: 50 });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/message/history-sync");
    const body = JSON.parse(init?.body as string);
    expect(body.chat_jid).toBe("5511999999999@s.whatsapp.net");
    expect(body.limit).toBe(50);
    expect(result.messages).toEqual([]);
  });

  it("sendMenu() calls /send/menu with correct type and choices", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { id: "msg-menu-1", status: "sent", timestamp: 1700000000 })
    );

    const provider = makeProvider();
    const result = await provider.sendMenu({
      number: "5511999999999",
      type: "button",
      text: "Choose one",
      choices: ["Option A", "Option B"],
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/send/menu");
    const body = JSON.parse(init?.body as string);
    expect(body.type).toBe("button");
    expect(body.choices).toEqual(["Option A", "Option B"]);
    expect(result.message_id).toBe("msg-menu-1");
  });
});

// ---------------------------------------------------------------------------
// provider identity
// ---------------------------------------------------------------------------

describe("UazapiProvider.provider identity", () => {
  it("provider === 'uazapi'", () => {
    const provider = makeProvider();
    expect(provider.provider).toBe("uazapi");
  });
});

// ---------------------------------------------------------------------------
// readWebhook — read-back + shape normalisation (B2, incident 2026-06-24)
// ---------------------------------------------------------------------------

describe("UazapiProvider.readWebhook — webhook read-back", () => {
  it("GETs /webhook with the per-instance token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { url: "https://x/whatsapp-webhook/secret", enabled: true })
    );

    const provider = makeProvider();
    await provider.readWebhook();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.test/webhook");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)?.token).toBe("tok-instance-abc");
  });

  it("normalises a flat {url, enabled} payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { url: "https://x/whatsapp-webhook/secret", enabled: true })
    );

    const provider = makeProvider();
    const wh = await provider.readWebhook();
    expect(wh.url).toBe("https://x/whatsapp-webhook/secret");
    expect(wh.enabled).toBe(true);
  });

  it("normalises a nested {webhook:{...}} payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, { webhook: { url: "https://x/wh", enabled: false } })
    );

    const provider = makeProvider();
    const wh = await provider.readWebhook();
    expect(wh.url).toBe("https://x/wh");
    expect(wh.enabled).toBe(false);
  });

  it("normalises an array payload (first element)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonRes(200, [{ url: "https://x/wh", enabled: true }])
    );

    const provider = makeProvider();
    const wh = await provider.readWebhook();
    expect(wh.url).toBe("https://x/wh");
    expect(wh.enabled).toBe(true);
  });

  it("returns null url/enabled when absent (unknown, not disabled)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, { events: ["messages"] }));

    const provider = makeProvider();
    const wh = await provider.readWebhook();
    expect(wh.url).toBeNull();
    expect(wh.enabled).toBeNull();
  });

  it("treats an empty-string url as null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, { url: "   ", enabled: true }));

    const provider = makeProvider();
    const wh = await provider.readWebhook();
    expect(wh.url).toBeNull();
  });
});
