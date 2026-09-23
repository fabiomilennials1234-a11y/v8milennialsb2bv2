// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const logRuntime = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime, redactSecrets: (value: unknown) => value,
}));

let handler: (request: Request) => Promise<Response>;
let captureGroups: boolean | null;
let configFails: boolean;
let targetExists: boolean;
let requests: { url: string; method: string; body?: string }[];
const env: Record<string, string> = {
  SUPABASE_URL: "https://reaction.test", SUPABASE_SERVICE_ROLE_KEY: "test-service",
  UAZAPI_WEBHOOK_SECRET: "test-secret",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => env[key], toObject: () => ({ ...env }) },
    serve: (callback: typeof handler) => { handler = callback; },
  });
  await import("../../supabase/functions/whatsapp-webhook/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  captureGroups = false; configFails = false; targetExists = true;
  requests = []; logRuntime.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    requests.push({ url, method, body: init?.body as string | undefined });
    if (url.includes("check_rate_limit")) return json({ allowed: true, remaining: 100 });
    if (url.includes("whatsapp_instance_secrets")) return json({ instance_id: "instance", organization_id: "org" });
    if (url.includes("whatsapp_instances")) return json({
      id: "instance", organization_id: "org", instance_name: "Test", provider: "uazapi", phone_number: "5511888888888",
    });
    if (url.includes("/organizations?")) return configFails
      ? json({ message: "lookup failed", code: "42501" }, 403)
      : json(captureGroups === null ? null : { capture_groups: captureGroups });
    if (url.includes("/whatsapp_messages?")) {
      if (method === "PATCH") return json([{ id: "target" }]);
      return json(targetExists ? { id: "target", reactions: [] } : null);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }));
});

async function receive(group: boolean, envelopeGroup = false) {
  return handler(new Request("https://edge.test/whatsapp-webhook/test-secret/instance/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "messages",
      ...(envelopeGroup ? { chat: { wa_chatid: "999@g.us" } } : {}),
      message: {
        id: "5511888888888:REACTION", type: "reaction", messageType: "ReactionMessage",
        fromMe: false, sender: "5511999999999@s.whatsapp.net",
        chatid: group ? "999@g.us" : "5511999999999@s.whatsapp.net",
        content: { key: { ID: "ORIGINAL" }, text: "👍" },
      },
    }),
  }));
}
const messageRequests = () => requests.filter(r => r.url.includes("/whatsapp_messages?"));

describe("real webhook group-reaction policy", () => {
  it.each([false, true])("skips only explicitly disabled groups, envelope group=%s", async envelopeGroup => {
    const response = await receive(!envelopeGroup, envelopeGroup);
    expect(response.status).toBe(200);
    expect(messageRequests()).toHaveLength(0);
    expect(logRuntime).toHaveBeenCalledWith(expect.objectContaining({
      action: "uazapi_group_reaction_skipped", organizationId: "org",
    }));
  });

  it("persists group reactions when capture is enabled, scoped to organization and instance", async () => {
    captureGroups = true;
    expect((await receive(true)).status).toBe(200);
    const update = messageRequests().find(r => r.method === "PATCH")!;
    expect(JSON.parse(update.body!)).toEqual({ reactions: [
      { emoji: "👍", from: "them", sender: "5511999999999@s.whatsapp.net", count: 1 },
    ] });
    for (const request of messageRequests()) {
      const url = new URL(request.url);
      expect(url.searchParams.get("organization_id")).toBe("eq.org");
      expect(url.searchParams.get("instance_id")).toBe("eq.instance");
    }
  });

  it("does not treat a missing direct-message target as a disabled group", async () => {
    targetExists = false;
    expect((await receive(false)).status).toBe(500);
    expect(messageRequests()).toHaveLength(1);
    expect(requests.some(r => r.url.includes("/organizations?"))).toBe(false);
    expect(logRuntime).toHaveBeenCalledWith(expect.objectContaining({
      action: "uazapi_process_error", payloadSnapshot: expect.objectContaining({ error: "Reaction target unavailable" }),
    }));
  });

  it.each(["error", "missing"])("config %s continues persistence instead of dropping group reaction", async failure => {
    configFails = failure === "error";
    if (failure === "missing") captureGroups = null;
    expect((await receive(true)).status).toBe(200);
    expect(messageRequests().some(r => r.method === "PATCH")).toBe(true);
    expect(logRuntime).not.toHaveBeenCalledWith(expect.objectContaining({ action: "uazapi_group_reaction_skipped" }));
  });

  it("config lookup failure and missing group target still return error", async () => {
    configFails = true; targetExists = false;
    expect((await receive(true)).status).toBe(500);
    expect(messageRequests()).toHaveLength(1);
  });
});
