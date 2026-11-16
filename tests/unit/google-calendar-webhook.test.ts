/**
 * google-calendar-webhook — renovação do watch channel.
 *
 * Incidente 2026-11-16: o webhook renovava a partir de QUALQUER notificação
 * (expiração lida do header) e criava canal novo sem parar o antigo ⇒ canais
 * se multiplicavam exponencialmente. Aqui fica travado:
 *   - canal inativo/desconhecido: 1 SELECT e mais nada (sem token, sem Google);
 *   - canal ativo perto de expirar (expiration do BANCO): registerWatchChannel
 *     com expectedOldChannelId = channelId da notificação (compare-and-swap);
 *   - canal ativo longe de expirar: não renova, mesmo com header dizendo que sim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const h = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  mock: null as null | ReturnType<typeof import("../helpers/supabase-mock").createMockSupabase>,
  fromCalls: [] as string[],
}));

(globalThis as unknown as { Deno: { serve: unknown } }).Deno.serve = (fn: (req: Request) => Promise<Response>) => {
  h.handler = fn;
};

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => {
    if (!h.mock) throw new Error("test did not configure supabase mock");
    const inner = h.mock.sb;
    return {
      ...inner,
      from: (table: string) => {
        h.fromCalls.push(table);
        return inner.from(table);
      },
    };
  },
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, fn: unknown) => fn,
}));

const logRuntime = vi.fn().mockResolvedValue(undefined);
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: (...args: unknown[]) => logRuntime(...args),
}));

vi.mock("../../supabase/functions/_shared/feature-flags.ts", () => ({
  isFeatureFlagEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
  upsertPipeEntry: vi.fn().mockResolvedValue(undefined),
  updatePipeEntryById: vi.fn().mockResolvedValue(undefined),
}));

const getValidAccessToken = vi.fn();
const registerWatchChannel = vi.fn();
vi.mock("../../supabase/functions/_shared/google-calendar-utils.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../supabase/functions/_shared/google-calendar-utils.ts")
  >();
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getValidAccessToken(...args),
    registerWatchChannel: (...args: unknown[]) => registerWatchChannel(...args),
    logCalendarOp: vi.fn().mockResolvedValue(undefined),
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

await import("../../supabase/functions/google-calendar-webhook/index.ts");

const DAY = 24 * 60 * 60 * 1000;

function notify(channelId: string, headerExpirationMs?: number) {
  const headers: Record<string, string> = {
    "X-Goog-Channel-ID": channelId,
    "X-Goog-Resource-State": "exists",
    "X-Goog-Resource-ID": "res-1",
  };
  if (headerExpirationMs) {
    headers["X-Goog-Channel-Expiration"] = new Date(headerExpirationMs).toUTCString();
  }
  return h.handler!(new Request("https://x/functions/v1/google-calendar-webhook", { method: "POST", headers }));
}

/** O handler responde 200 e processa em background; espera o fim do processamento. */
const processed = () => vi.waitFor(() => expect(logRuntime).toHaveBeenCalled());

beforeEach(() => {
  vi.clearAllMocks();
  h.fromCalls = [];
  h.mock = createMockSupabase();
  getValidAccessToken.mockResolvedValue({ accessToken: "tok", googleEmail: "a@b.c" });
  registerWatchChannel.mockResolvedValue({ renewed: true });
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
    text: () => Promise.resolve(""),
  });
});

describe("google-calendar-webhook", () => {
  it("inactive channel: exactly 1 SELECT, no token, no Google call", async () => {
    h.mock!.mockTable("google_calendar_watch_channels", [
      {
        channel_id: "ch-dead",
        user_id: "u1",
        organization_id: "o1",
        is_active: false,
        expiration: new Date(Date.now() + 1000).toISOString(),
      },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await notify("ch-dead", Date.now() + 1000);
    expect(res.status).toBe(200);
    await processed();

    expect(h.fromCalls).toEqual(["google_calendar_watch_channels"]);
    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(registerWatchChannel).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("unknown channel: exactly 1 SELECT, no token, no Google call", async () => {
    h.mock!.mockTable("google_calendar_watch_channels", []);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notify("ch-unknown");
    await processed();

    expect(h.fromCalls).toEqual(["google_calendar_watch_channels"]);
    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("active channel near expiration (DB): renews with expected = channelId", async () => {
    h.mock!.mockTable("google_calendar_watch_channels", [
      {
        channel_id: "ch-live",
        user_id: "u1",
        organization_id: "o1",
        is_active: true,
        expiration: new Date(Date.now() + DAY).toISOString(),
      },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await notify("ch-live");
    await processed();

    expect(registerWatchChannel).toHaveBeenCalledTimes(1);
    const [userId, orgId, token, , expected] = registerWatchChannel.mock.calls[0];
    expect([userId, orgId, token, expected]).toEqual(["u1", "o1", "tok", "ch-live"]);
    log.mockRestore();
  });

  it("active channel far from expiration (DB) does not renew, even if the header says it expires soon", async () => {
    h.mock!.mockTable("google_calendar_watch_channels", [
      {
        channel_id: "ch-live",
        user_id: "u1",
        organization_id: "o1",
        is_active: true,
        expiration: new Date(Date.now() + 6 * DAY).toISOString(),
      },
    ]);

    await notify("ch-live", Date.now() + 1000);
    await processed();

    expect(registerWatchChannel).not.toHaveBeenCalled();
  });
});
