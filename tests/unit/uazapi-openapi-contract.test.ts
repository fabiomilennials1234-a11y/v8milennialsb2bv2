// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts";

type Operation = { required: string[]; fields: Record<string, { type?: string; enum?: unknown[] }> };
const { operations } = JSON.parse(readFileSync(new URL("../fixtures/uazapi/operations-2.1.1.json", import.meta.url), "utf8")) as { operations: Record<string, Operation> };
const config = { baseUrl: "https://contract.uazapi.test", token: "instance-a", adminToken: "admin-a" };
const message = { id: "message-1", status: "sent", timestamp: 1700000000 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Oracle is extracted from vendor OpenAPI, not from the adapter's types. */
function assertRequestContract() {
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    const path = new URL(String(url)).pathname;
    const operation = operations[`${init?.method} ${path}`];
    expect(operation, `${init?.method} ${path} must exist in vendor spec`).toBeDefined();
    if (!init?.body) continue;
    const body = JSON.parse(String(init.body));
    for (const name of operation.required) expect(body, `missing ${name}`).toHaveProperty(name);
    for (const [name, value] of Object.entries(body)) {
      const field = operation.fields[name];
      expect(field, `${path}: undocumented field ${name}`).toBeDefined();
      if (field.type === "array") expect(Array.isArray(value)).toBe(true);
      else if (field.type === "integer") expect(Number.isInteger(value)).toBe(true);
      else if (field.type) expect(typeof value).toBe(field.type);
      if (field.enum) expect(field.enum).toContain(value);
    }
  }
}
beforeEach(() => { UazapiClient._resetCircuitState(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("UAZAPI 2.1.1 request contracts", () => {
  it("uses documented contact, location, block and recovery payloads", async () => {
    vi.mocked(fetch).mockImplementation(async url => response(String(url).includes('history-sync') ? { success: true, mode: 'history' } : message));
    const client = new UazapiClient(config);
    await client.sendContact({ number: '5511999999999', fullName: 'QA', phoneNumber: '5511999999999' });
    await client.sendLocation({ number: '5511999999999', latitude: -27, longitude: -48, name: 'QA' });
    await client.blockContact('5511999999999', true);
    await client.blockContact('5511999999999', false);
    await client.listBlocked();
    await client.requestHistory({ number: '5511999999999@s.whatsapp.net', mode: 'history', count: 20 });
    assertRequestContract();
  });
  it("rejects invalid recovery and coordinates before reaching the provider", async () => {
    const client = new UazapiClient(config);
    await expect(client.requestHistory({ number: 'chat', mode: 'exact' })).rejects.toThrow('message ID');
    await expect(client.requestHistory({ number: 'chat', count: 101 })).rejects.toThrow('between');
    await expect(client.sendLocation({ number: 'chat', latitude: 91, longitude: 0 })).rejects.toThrow('coordinates');
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not replay an ambiguous recovery request", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));
    await expect(new UazapiClient(config).requestHistory({ number: 'chat@s.whatsapp.net' })).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("excludes group JIDs even when the provider labels them individual", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ chats: [
      { wa_chatid: "individual@s.whatsapp.net", wa_isGroup: false },
      { wa_chatid: "group@g.us", wa_isGroup: false },
    ], pagination: { totalRecords: 2 } }));
    expect((await new UazapiClient(config).listChats("individual")).map(c => c.id)).toEqual(["individual@s.whatsapp.net"]);
  });
  it("loads every documented chat page while retaining the group filter", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ chats: [{ wa_chatid: "a", wa_isGroup: false }], pagination: { totalRecords: 2 } }))
      .mockResolvedValueOnce(response({ chats: [{ wa_chatid: "b", wa_isGroup: false }], pagination: { totalRecords: 2 } }));
    const chats = await new UazapiClient(config).listChats("individual");
    expect(chats.map(c => c.id)).toEqual(["a", "b"]);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ offset: 1, wa_isGroup: false });
    assertRequestContract();
  });
  it("fails instead of returning silently truncated chats when pages stop advancing", async () => {
    vi.mocked(fetch).mockImplementation(async () => response({ chats: [{ wa_chatid: "a" }], pagination: { totalRecords: 5 } }));
    await expect(new UazapiClient(config).listChats()).rejects.toMatchObject({ provider_code: "invalid_chat_pagination" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    [{ hasMore: true, nextOffset: 17 }, "17"],
    [{ hasMore: false, nextOffset: 0 }, undefined],
  ])("honors provider history pagination %j", async (pagination, expected) => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ messages: [message], ...pagination }))
      .mockResolvedValueOnce(response({ chats: [] }));
    const result = await new UazapiClient(config).historySync({ number: "chat@s.whatsapp.net", limit: 1 });
    expect(result.nextCursor).toBe(expected);
    assertRequestContract();
  });
  it.each([0, -1, "1", null, 1.5])("rejects non-advancing or invalid history cursor %j", async (nextOffset) => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ messages: [message], hasMore: true, nextOffset }))
      .mockResolvedValueOnce(response({ chats: [] }));
    await expect(new UazapiClient(config).historySync({ number: "chat@s.whatsapp.net", limit: 1 }))
      .rejects.toMatchObject({ provider_code: "invalid_history_cursor" });
  });
  it("pins all 139 documented operations without exposing them through a generic proxy", () => {
    expect(Object.keys(operations)).toHaveLength(139);
  });
  it("creates with admin auth and documented metadata only", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ instance: { id: "new-id" }, token: "new-token" }));
    await new UazapiClient(config).initInstance({ name: "QA", systemName: "device", webhookUrl: "https://example.test/hook" });
    assertRequestContract();
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("admintoken")).toBe("admin-a");
  });
  it("keeps organization device labels distinct at connection time", async () => {
    vi.mocked(fetch).mockImplementation(async () => response({ paircode: "test-code" }));
    for (const organizationId of ["org-a", "org-b"]) {
      const provider = new UazapiProvider({ ...config, instanceId: "instance-id", organizationId, supabaseAdmin: {} as never });
      await provider.connectQR("14155552671");
    }
    assertRequestContract();
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0].systemName).toBeTypeOf("string");
    expect(bodies[1].systemName).not.toBe(bodies[0].systemName);
  });
  it("does not persist incomplete creation credentials", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ instance: { id: "new-instance" } }));
    const rpc = vi.fn();
    const provider = new UazapiProvider({ ...config, instanceId: "instance-id", organizationId: "org-id", supabaseAdmin: { rpc } as never });
    await expect(provider.createInstance({ instance_id: "instance-id", organization_id: "org-id", instance_name: "QA", webhook_url: "https://example.test/hook", webhook_secret: "test-secret" })).rejects.toThrow("missing instance identity or token");
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("maps internal media names without leaking them to the provider", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(message));
    await new UazapiClient(config).sendMedia({ number: "5511999999999", type: "document", file: "https://example.test/qa.pdf", caption: "Invoice", filename: "invoice.pdf", replyid: "quoted" });
    assertRequestContract();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({ text: "Invoice", docName: "invoice.pdf", replyid: "quoted" });
  });
  it("preserves menu options all the way through the provider", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(message));
    const provider = new UazapiProvider({ ...config, instanceId: "instance-id", organizationId: "org-id", supabaseAdmin: {} as never });
    await provider.sendMenu({ number: "5511999999999", type: "list", text: "Choose", choices: ["Item|one"], footer: "Footer", listButtonLabel: "Open", selectableCount: 1 });
    assertRequestContract();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({ footerText: "Footer", listButton: "Open", selectableCount: 1 });
  });
  it("sends reactions using text and read receipts using an ID array", async () => {
    vi.mocked(fetch).mockImplementation(async () => response({ success: true }));
    const client = new UazapiClient(config);
    await client.react("message-1", "5511999999999", "👍");
    await client.markRead("message-1");
    assertRequestContract();
  });
  it("normalizes explicitly requested base64Data and refuses empty downloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ base64Data: "YWJj", mimetype: "audio/ogg" }));
    const client = new UazapiClient(config);
    expect(await client.downloadMedia("message-1")).toMatchObject({ base64: "YWJj", mimetype: "audio/ogg" });
    assertRequestContract();
    vi.mocked(fetch).mockResolvedValueOnce(response({ mimetype: "audio/ogg" }));
    await expect(client.downloadMedia("message-2")).rejects.toMatchObject({ provider_code: "invalid_media_response" });
  });
  it("filters chats and history by the documented fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response({ messages: [] })).mockResolvedValueOnce(response([]));
    const client = new UazapiClient(config);
    await client.listChats("individual");
    await client.historySync({ number: "5511999999999@s.whatsapp.net", limit: 50 });
    assertRequestContract();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toHaveProperty("wa_isGroup", false);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toHaveProperty("chatid", "5511999999999@s.whatsapp.net");
  });
  it("normalizes quota diagnostics and preserves unknown values", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({
      can_send_new_messages: false,
      new_chat_message_capping: { available: true, used_quota: 8, total_quota: 10 },
      reachout_timelock: { active: true, until: "2026-09-12T12:00:00Z" },
    })).mockResolvedValueOnce(response({ reachable: false }));
    const client = new UazapiClient(config);
    expect(await client.getMessageLimits()).toEqual({ current: 8, limit: 10, can_send_new_messages: false, reachout_timelock: Date.parse("2026-09-12T12:00:00Z") / 1000 });
    expect(await client.getMessageLimits()).toEqual({ current: null, limit: null, can_send_new_messages: null });
  });
  it("never requests all chats when a history chat identifier is missing", async () => {
    await expect(new UazapiClient(config).historySync({ number: "" })).rejects.toThrow("chat identifier");
    expect(fetch).not.toHaveBeenCalled();
  });

});

describe("transport isolation and ambiguous writes", () => {
  it.each([
    { ...config, token: "instance-b" },
    { ...config, baseUrl: "https://other.uazapi.test" },
  ])("an unhealthy credential/server cannot block another", async (other) => {
    vi.mocked(fetch).mockImplementation(async () => response({ error: "unavailable" }, 503));
    const unhealthy = new UazapiClient(config);
    for (let n = 0; n < 3; n++) await expect(unhealthy.sendText({ number: "5511999999999", text: "qa" })).rejects.toMatchObject({ status: 503 });
    await expect(unhealthy.sendText({ number: "5511999999999", text: "qa" })).rejects.toMatchObject({ provider_code: "circuit_breaker_open" });
    vi.mocked(fetch).mockResolvedValueOnce(response(message));
    await expect(new UazapiClient(other).sendText({ number: "5511999999999", text: "qa" })).resolves.toEqual(message);
  });
  it("does not replay instance creation after a lost response", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("connection lost"));
    await expect(new UazapiClient(config).initInstance({ name: "QA" })).rejects.toThrow("connection lost");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
