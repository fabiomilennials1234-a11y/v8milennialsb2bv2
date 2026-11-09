// @vitest-environment node
/**
 * Menção em grupo no `whatsapp-api-proxy`:
 *  - `mentions` do payload chega ao provider só se o destino é grupo e os itens
 *    são válidos; sem `mentions` o envio é idêntico ao de antes;
 *  - `groupParticipants` passa pela fronteira de org e pelo gate de conversa
 *    (alvo = groupjid), valida o JID e só responde para Uazapi.
 *
 * O handler real é capturado do `Deno.serve`, sobre um banco falso em memória.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getHandler, mockCreateClient, mockGetWhatsAppProvider, mockIsChatTargetAllowed } = vi.hoisted(() => {
  let handler: unknown = null;
  const envStore: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ALLOWED_ORIGINS: "http://localhost:8080",
  };
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => envStore[k] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serve: (fn: any) => { handler = fn; },
  };
  return {
    getHandler: () => handler as (req: Request) => Promise<Response>,
    mockCreateClient: vi.fn(),
    mockGetWhatsAppProvider: vi.fn(),
    mockIsChatTargetAllowed: vi.fn(),
  };
});

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: mockCreateClient }));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, h: unknown) => h,
  logError: vi.fn(),
}));
vi.mock("../../supabase/functions/_shared/cors.ts", () => ({ getCorsHeaders: () => ({}) }));
vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../supabase/functions/_shared/plan-gate.ts", () => ({
  assertPlanFeature: vi.fn().mockResolvedValue(undefined),
  PlanFeatureDeniedError: class PlanFeatureDeniedError extends Error {},
  planDeniedResponse: () => new Response("denied", { status: 403 }),
}));
vi.mock("../../supabase/functions/_shared/gestor-auth.ts", () => ({
  isActiveGestorForOrg: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: mockGetWhatsAppProvider,
}));
vi.mock("../../supabase/functions/_shared/chat-owner-guard.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isChatTargetAllowed: mockIsChatTargetAllowed,
}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/evolution-provider.ts", () => ({}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts", () => ({}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/meta-cloud-provider.ts", () => ({}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts", () => ({}));

const INSTANCE_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "org-1";
const GROUP = "120363404701403742@g.us";
const PHONE = "5548999990000";
const A = "5548999990001";

let instance: { id: string; organization_id: string; provider: string; instance_name: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function builder(table: string): any {
  let op = "select";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select() { return b; },
    upsert() { op = "upsert"; return b; },
    update() { op = "update"; return b; },
    insert() { op = "insert"; return b; },
    eq() { return b; }, in() { return b; }, is() { return b; }, limit() { return b; },
    maybeSingle() { return b; }, single() { return b; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(res: any, rej: any) {
      return Promise.resolve().then(() => {
        if (op !== "select") return { data: null, error: null };
        if (table === "team_members") return { data: { organization_id: ORG_ID, id: "tm-1" }, error: null };
        if (table === "whatsapp_instances") return { data: instance, error: null };
        return { data: null, error: null };
      }).then(res, rej);
    },
  };
  return b;
}

async function loadProxy() {
  vi.resetModules();
  await import("../../supabase/functions/whatsapp-api-proxy/index.ts");
  return getHandler();
}

const call = async (action: string, payload: Record<string, unknown>) => {
  const handler = await loadProxy();
  return handler(new Request("http://localhost/whatsapp-api-proxy", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ action, instance_id: INSTANCE_ID, payload }),
  }));
};

beforeEach(() => {
  instance = { id: INSTANCE_ID, organization_id: ORG_ID, provider: "uazapi", instance_name: "chip-1" };
  mockIsChatTargetAllowed.mockReset().mockResolvedValue(true);
  mockGetWhatsAppProvider.mockReset();
  mockCreateClient.mockReset().mockImplementation((_u: string, key: string) =>
    key === "service-role-key"
      ? { from: (t: string) => builder(t) }
      : { auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) }, rpc: vi.fn() });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("sendText / sendMedia mentions", () => {
  const sent = { message_id: "M1", status: "sent" };

  it("forwards sanitized mentions for a group destination", async () => {
    const sendText = vi.fn().mockResolvedValue(sent);
    mockGetWhatsAppProvider.mockResolvedValue({ sendText });
    const res = await call("sendText", { number: GROUP, text: `oi @${A}`, mentions: [A, A, "lixo"] });
    expect(res.status).toBe(200);
    expect(sendText.mock.calls[0][0].mentions).toEqual([A]);
  });

  it("drops mentions for a phone destination and never fails the send", async () => {
    const sendText = vi.fn().mockResolvedValue(sent);
    mockGetWhatsAppProvider.mockResolvedValue({ sendText });
    const res = await call("sendText", { number: PHONE, text: "oi", mentions: [A] });
    expect(res.status).toBe(200);
    expect(sendText.mock.calls[0][0]).not.toHaveProperty("mentions");
  });

  it("malformed mentions are discarded silently (200)", async () => {
    const sendText = vi.fn().mockResolvedValue(sent);
    mockGetWhatsAppProvider.mockResolvedValue({ sendText });
    const res = await call("sendText", { number: GROUP, text: "oi", mentions: "5548999990001,all" });
    expect(res.status).toBe(200);
    expect(sendText.mock.calls[0][0]).not.toHaveProperty("mentions");
  });

  it("payload without mentions reaches the provider exactly as before", async () => {
    const sendText = vi.fn().mockResolvedValue(sent);
    mockGetWhatsAppProvider.mockResolvedValue({ sendText });
    await call("sendText", { number: GROUP, text: "oi" });
    expect(sendText.mock.calls[0][0]).toEqual({
      number: GROUP, text: "oi", delay: undefined, replyid: undefined,
      trackSource: "whatsapp-api-proxy", trackId: "tm-1",
    });
  });

  it("forwards mentions with a media caption, drops them without caption", async () => {
    const sendMedia = vi.fn().mockResolvedValue(sent);
    mockGetWhatsAppProvider.mockResolvedValue({ sendMedia });
    await call("sendMedia", { number: GROUP, type: "image", file: "https://x.test/a.png", caption: `@${A}`, mentions: [A] });
    await call("sendMedia", { number: GROUP, type: "image", file: "https://x.test/a.png", mentions: [A] });
    expect(sendMedia.mock.calls[0][0].mentions).toEqual([A]);
    expect(sendMedia.mock.calls[1][0]).not.toHaveProperty("mentions");
  });
});

describe("groupParticipants", () => {
  const participants = [{ phone: A, lid: null, name: "Ana", isAdmin: false }];

  it("returns the lean participant list for a uazapi instance", async () => {
    const getGroupParticipants = vi.fn().mockResolvedValue(participants);
    mockGetWhatsAppProvider.mockResolvedValue({ getGroupParticipants });
    const res = await call("groupParticipants", { groupjid: GROUP });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toEqual(participants);
    expect(getGroupParticipants).toHaveBeenCalledWith(GROUP);
  });

  it("runs the chat owner gate with the group JID as target", async () => {
    mockIsChatTargetAllowed.mockResolvedValue(false);
    const getGroupParticipants = vi.fn();
    mockGetWhatsAppProvider.mockResolvedValue({ getGroupParticipants });
    // `number` de uma conversa liberada não pode servir de chave para outro grupo.
    const res = await call("groupParticipants", { groupjid: GROUP, number: PHONE });
    expect(res.status).toBe(403);
    expect(mockIsChatTargetAllowed).toHaveBeenCalledWith(expect.anything(), ORG_ID, INSTANCE_ID,
      expect.objectContaining({ rawPhone: GROUP }));
    expect(getGroupParticipants).not.toHaveBeenCalled();
  });

  it("blocks an instance from another org before anything else", async () => {
    instance = { ...instance, organization_id: "org-2" };
    const getGroupParticipants = vi.fn();
    mockGetWhatsAppProvider.mockResolvedValue({ getGroupParticipants });
    const res = await call("groupParticipants", { groupjid: GROUP });
    expect(res.status).toBe(403);
    expect(getGroupParticipants).not.toHaveBeenCalled();
    expect(mockGetWhatsAppProvider).not.toHaveBeenCalled();
  });

  it.each([PHONE, `${PHONE}@s.whatsapp.net`, `${GROUP}.evil`, "", undefined])("rejects invalid groupjid %j with 400", async (groupjid) => {
    const res = await call("groupParticipants", { groupjid });
    expect(res.status).toBe(400);
    expect(mockGetWhatsAppProvider).not.toHaveBeenCalled();
  });

  it.each(["evolution", "meta_cloud", "notificame"])("answers 400 with a clear code for %s", async (provider) => {
    instance = { ...instance, provider };
    const res = await call("groupParticipants", { groupjid: GROUP });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("group_participants_not_supported");
    expect(mockGetWhatsAppProvider).not.toHaveBeenCalled();
  });
});
