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
  it("pins all 139 documented operations without exposing them through a generic proxy", () => {
    expect(Object.keys(operations)).toHaveLength(139);
  });
  it("creates with admin auth and documented metadata only", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ instance: { id: "new-id" }, token: "new-token" }));
    await new UazapiClient(config).initInstance({ name: "QA", systemName: "device", webhookUrl: "https://example.test/hook" });
    assertRequestContract();
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("admintoken")).toBe("admin-a");
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
