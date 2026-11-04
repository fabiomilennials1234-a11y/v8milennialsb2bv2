// @vitest-environment node
/**
 * sendText com desfecho ambíguo (timeout / 5xx do Uazapi) no `whatsapp-api-proxy`.
 *
 * O Uazapi responde timeout para entregas que aceitou. O proxy pergunta a ele
 * (`/message/find`) antes de devolver erro:
 *  - achou  -> sucesso com o id real e linha gravada em `whatsapp_messages`;
 *  - não achou -> 504 `send_outcome_unknown`, SEM gravar e SEM reenviar;
 *  - 4xx/429 -> continua como antes (sem consulta).
 *
 * O handler real é capturado do `Deno.serve`, sobre um banco falso em memória.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getHandler, mockCreateClient, mockLogRuntime, mockGetWhatsAppProvider } = vi.hoisted(() => {
  let handler: unknown = null;
  const envStore: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    UAZAPI_WEBHOOK_SECRET: "fixture-webhook-secret",
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
    mockLogRuntime: vi.fn().mockResolvedValue(undefined),
    mockGetWhatsAppProvider: vi.fn(),
  };
});

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: mockCreateClient }));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, h: unknown) => h,
  logError: vi.fn(),
}));
vi.mock("../../supabase/functions/_shared/cors.ts", () => ({
  getCorsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));
vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: mockLogRuntime }));
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
  isChatTargetAllowed: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/evolution-provider.ts", () => ({}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts", () => ({}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/meta-cloud-provider.ts", () => ({}));
vi.mock("../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts", () => ({}));

const INSTANCE_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "org-1";
const NUMBER = "5551999990000";
const T0 = new Date("2026-10-26T16:21:41Z").getTime();

type Write = { table: string; op: string; row?: Record<string, unknown>; opts?: unknown };
let writes: Write[];
let existingMessageIds: string[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function builder(table: string): any {
  let op = "select";
  let row: Record<string, unknown> | undefined;
  let opts: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select() { return b; },
    upsert(r: Record<string, unknown>, o: unknown) { op = "upsert"; row = r; opts = o; return b; },
    update(r: Record<string, unknown>) { op = "update"; row = r; return b; },
    insert(r: Record<string, unknown>) { op = "insert"; row = r; return b; },
    delete() { op = "delete"; return b; },
    eq() { return b; }, in() { return b; }, is() { return b; }, limit() { return b; },
    maybeSingle() { return b; }, single() { return b; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(res: any, rej: any) {
      return Promise.resolve().then(() => {
        if (op !== "select") { writes.push({ table, op, row, opts }); return { data: null, error: null }; }
        if (table === "master_users") return { data: null, error: null };
        if (table === "team_members") return { data: { organization_id: ORG_ID, id: "tm-1" }, error: null };
        if (table === "whatsapp_instances") {
          return { data: { id: INSTANCE_ID, organization_id: ORG_ID, provider: "uazapi", instance_name: "chip-1" }, error: null };
        }
        if (table === "whatsapp_messages") return { data: existingMessageIds.map((message_id) => ({ message_id })), error: null };
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

function sendTextRequest(text = "Bom dia") {
  return new Request("http://localhost/whatsapp-api-proxy", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sendText", instance_id: INSTANCE_ID, payload: { number: NUMBER, text } }),
  });
}

const timeoutError = { status: 504, provider_code: "timeout", message: "Uazapi timeout after 15000ms on POST /send/text" };
const foundRow = (over: Record<string, unknown> = {}) => ({
  id: "owner:3EB0REAL", messageid: "3EB0REAL", fromMe: true, text: "Bom dia",
  messageTimestamp: Math.floor((T0 + 2_000) / 1000), status: "Pending", ...over,
});

async function run(handler: (r: Request) => Promise<Response>, req: Request) {
  const pending = handler(req);
  await vi.advanceTimersByTimeAsync(10_000);
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
  writes = [];
  existingMessageIds = [];
  mockLogRuntime.mockClear();
  mockCreateClient.mockReset().mockImplementation((_u: string, key: string) =>
    key === "service-role-key"
      ? { from: (t: string) => builder(t) }
      : { auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) }, rpc: vi.fn() });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sendText com timeout ambíguo", () => {
  it("timeout + /message/find ACHA: responde sucesso com o id real e grava a linha uma vez", async () => {
    const sendText = vi.fn().mockRejectedValue(timeoutError);
    const findRecentMessages = vi.fn().mockResolvedValue([foundRow()]);
    mockGetWhatsAppProvider.mockResolvedValue({ provider: "uazapi", sendText, findRecentMessages });
    const handler = await loadProxy();

    const res = await run(handler, sendTextRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result.message_id).toBe("owner:3EB0REAL");
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(findRecentMessages).toHaveBeenCalledWith({ number: NUMBER, limit: 20 });
    const upserts = writes.filter((w) => w.table === "whatsapp_messages" && w.op === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row).toMatchObject({
      organization_id: ORG_ID, instance_id: INSTANCE_ID, message_id: "owner:3EB0REAL",
      remote_jid: `${NUMBER}@s.whatsapp.net`, phone_number: NUMBER, direction: "outgoing",
      message_type: "text", content: "Bom dia", status: "sent",
    });
    expect(upserts[0].opts).toEqual({ onConflict: "message_id,instance_id", ignoreDuplicates: true });
    expect(mockLogRuntime).toHaveBeenCalledWith(expect.objectContaining({
      action: "sendText", status: "error", payloadSnapshot: expect.objectContaining({ reconciled: true }),
    }));
  });

  it("timeout + NÃO acha: 504 send_outcome_unknown, sem gravar e sem reenviar", async () => {
    const sendText = vi.fn().mockRejectedValue(timeoutError);
    const findRecentMessages = vi.fn().mockResolvedValue([foundRow({ text: "outra coisa" })]);
    mockGetWhatsAppProvider.mockResolvedValue({ provider: "uazapi", sendText, findRecentMessages });
    const handler = await loadProxy();

    const res = await run(handler, sendTextRequest());
    const body = await res.json();

    expect(res.status).toBe(504);
    expect(body.code).toBe("send_outcome_unknown");
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(findRecentMessages).toHaveBeenCalledTimes(2);
    expect(writes.filter((w) => w.table === "whatsapp_messages")).toHaveLength(0);
    expect(mockLogRuntime).toHaveBeenCalledWith(expect.objectContaining({
      action: "sendText", status: "error", payloadSnapshot: expect.objectContaining({ reconciled: false }),
    }));
  });

  it("timeout + a consulta também falha: continua desconhecido (504), nunca grava", async () => {
    const sendText = vi.fn().mockRejectedValue(timeoutError);
    const findRecentMessages = vi.fn().mockRejectedValue(timeoutError);
    mockGetWhatsAppProvider.mockResolvedValue({ provider: "uazapi", sendText, findRecentMessages });
    const handler = await loadProxy();

    const res = await run(handler, sendTextRequest());

    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("send_outcome_unknown");
    expect(writes.filter((w) => w.table === "whatsapp_messages")).toHaveLength(0);
  });

  it("mensagem idêntica anterior já gravada não é confundida com este envio", async () => {
    existingMessageIds = ["owner:3EB0REAL"];
    const sendText = vi.fn().mockRejectedValue(timeoutError);
    const findRecentMessages = vi.fn().mockResolvedValue([foundRow()]);
    mockGetWhatsAppProvider.mockResolvedValue({ provider: "uazapi", sendText, findRecentMessages });
    const handler = await loadProxy();

    const res = await run(handler, sendTextRequest());

    expect(res.status).toBe(504);
    expect(writes.filter((w) => w.table === "whatsapp_messages")).toHaveLength(0);
  });

  it.each([
    [{ status: 429, message: "rate limited" }],
    [{ status: 400, message: "bad request" }],
    [{ status: 503, provider_code: "circuit_breaker_open", message: "open" }],
  ])("erro %j não consulta o Uazapi (comportamento de hoje)", async (err) => {
    const sendText = vi.fn().mockRejectedValue(err);
    const findRecentMessages = vi.fn();
    mockGetWhatsAppProvider.mockResolvedValue({ provider: "uazapi", sendText, findRecentMessages });
    const handler = await loadProxy();

    const res = await run(handler, sendTextRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBeUndefined();
    expect(findRecentMessages).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table === "whatsapp_messages")).toHaveLength(0);
  });

  it("sucesso normal não consulta nada", async () => {
    const sendText = vi.fn().mockResolvedValue({ message_id: "ok-1", status: "sent", timestamp: 1 });
    const findRecentMessages = vi.fn();
    mockGetWhatsAppProvider.mockResolvedValue({ provider: "uazapi", sendText, findRecentMessages });
    const handler = await loadProxy();

    const res = await run(handler, sendTextRequest());

    expect(res.status).toBe(200);
    expect(findRecentMessages).not.toHaveBeenCalled();
  });
});
