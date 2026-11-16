// @vitest-environment node
/**
 * Fluxo OAuth do Google Calendar — vetor cross-tenant pelo `state`.
 *
 * Prova, nos handlers reais de google-calendar-connect e
 * google-calendar-callback, que:
 *  - o callback recusa state forjado, adulterado, de outra chave, expirado ou
 *    reusado SEM trocar o code no Google e SEM tocar em tabela;
 *  - o callback só confia no state depois de consumir o nonce (que revalida a
 *    membership), e grava os tokens na org assinada;
 *  - o connect recusa conexão sem membership ativa (antes: `orgId ?? ""`) e
 *    multi-org sem org explícita, e emite state verificável com nonce gravado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  signGoogleCalendarState,
  verifyGoogleCalendarState,
} from "../../supabase/functions/_shared/google-calendar-oauth-state.ts";

const SECRET = "google-client-secret-test";
const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ORG_B = "66666666-6666-4666-8666-666666666666";
const VICTIM_USER = "33333333-3333-4333-8333-333333333333";
const VICTIM_ORG = "44444444-4444-4444-8444-444444444444";
const NONCE = "55555555-5555-4555-8555-555555555555";

type Handler = (req: Request) => Promise<Response>;

const f = vi.hoisted(() => ({
  handlers: [] as Handler[],
  rpc: vi.fn(),
  from: vi.fn(),
  fetch: vi.fn(),
  registerWatchChannel: vi.fn(),
  getUser: vi.fn(),
  memberships: { data: [] as Array<{ organization_id: string }>, error: null as unknown },
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  upserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    rpc: f.rpc,
    auth: { getUser: f.getUser },
    from: (table: string) => {
      f.from(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => unknown) => resolve(f.memberships),
        insert: async (row: Record<string, unknown>) => {
          f.inserts.push({ table, row });
          return { error: null };
        },
        upsert: async (row: Record<string, unknown>) => {
          f.upserts.push({ table, row });
          return { error: null };
        },
      };
      return chain;
    },
  }),
}));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_: string, fn: unknown) => fn,
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: async () => {} }));
vi.mock("../../supabase/functions/_shared/google-calendar-utils.ts", async (original) => ({
  ...(await original<object>()),
  encryptToken: async () => ({ encrypted: "enc", nonce: "iv" }),
  logCalendarOp: async () => {},
  registerWatchChannel: f.registerWatchChannel,
}));

vi.stubGlobal("Deno", {
  env: {
    get: (key: string) =>
      ({
        SUPABASE_URL: "https://proj.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        SUPABASE_ANON_KEY: "anon",
        APP_URL: "https://app.torque.test",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: SECRET,
        GOOGLE_REDIRECT_URI: "https://proj.supabase.co/functions/v1/google-calendar-callback",
      })[key],
  },
  serve: (fn: Handler) => {
    f.handlers.push(fn);
  },
});
vi.stubGlobal("fetch", f.fetch);

await import("../../supabase/functions/google-calendar-connect/index.ts");
await import("../../supabase/functions/google-calendar-callback/index.ts");
const [connect, callback] = f.handlers;

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const signed = async (over: Partial<{ userId: string; orgId: string; nonce: string }> = {}, secret = SECRET, now?: number) =>
  (await signGoogleCalendarState({ userId: USER, orgId: ORG, nonce: NONCE, ...over }, secret, { now })).state;

const runCallback = (state: string, suffix = "&code=google-code") =>
  callback(new Request(`https://proj.supabase.co/functions/v1/google-calendar-callback?state=${encodeURIComponent(state)}${suffix}`));

const runConnect = (query = "") =>
  connect(new Request(`https://proj.supabase.co/functions/v1/google-calendar-connect${query}`, {
    headers: { Authorization: "Bearer user-jwt", origin: "https://app.torque.test" },
  }));

beforeEach(() => {
  vi.clearAllMocks();
  f.inserts.length = 0;
  f.upserts.length = 0;
  f.memberships = { data: [{ organization_id: ORG }], error: null };
  f.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  f.rpc.mockResolvedValue({ data: true, error: null });
  f.fetch.mockImplementation(async (url: string) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a b" }));
    }
    return new Response(JSON.stringify({ email: "atacante@gmail.com", id: "g-1" }));
  });
});

describe("google-calendar-callback — state", () => {
  it("state genuíno: consome o nonce ANTES do Google e grava na org assinada", async () => {
    const res = await runCallback(await signed());
    expect(res.headers.get("Location")).toContain("google=connected");
    expect(f.rpc).toHaveBeenCalledWith("google_calendar_consume_oauth_nonce", {
      p_nonce: NONCE,
      p_user_id: USER,
      p_organization_id: ORG,
    });
    expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.fetch.mock.invocationCallOrder[0]);
    expect(f.upserts).toEqual([
      { table: "google_calendar_tokens", row: expect.objectContaining({ user_id: USER, organization_id: ORG }) },
    ]);
    expect(f.registerWatchChannel).toHaveBeenCalledWith(USER, ORG, "at", expect.anything());
  });

  const rejected: Array<[string, () => Promise<string>]> = [
    ["formato antigo forjado (base64 puro com a vítima)", async () =>
      btoa(JSON.stringify({ userId: VICTIM_USER, orgId: VICTIM_ORG, ts: Date.now() }))],
    ["payload forjado com assinatura inventada", async () =>
      `${b64url(JSON.stringify({ v: 1, userId: VICTIM_USER, orgId: VICTIM_ORG, nonce: NONCE, iat: Date.now(), exp: Date.now() + 60_000 }))}.${"A".repeat(43)}`],
    ["payload adulterado com a assinatura original", async () => {
      const [, mac] = (await signed()).split(".");
      const now = Date.now();
      return `${b64url(JSON.stringify({ v: 1, userId: VICTIM_USER, orgId: VICTIM_ORG, nonce: NONCE, iat: now, exp: now + 60_000 }))}.${mac}`;
    }],
    ["assinado com outra chave", () => signed({}, "chave-do-atacante")],
    ["expirado", () => signed({}, SECRET, Date.now() - 11 * 60 * 1000)],
  ];

  for (const [name, make] of rejected) {
    it(`recusa ${name} sem trocar o code e sem tocar em tabela`, async () => {
      const res = await runCallback(await make());
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("state_invalido_ou_expirado");
      expect(f.rpc).not.toHaveBeenCalled();
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.from).not.toHaveBeenCalled();
      expect(f.registerWatchChannel).not.toHaveBeenCalled();
    });
  }

  it("recusa state reusado ou de membro removido (nonce não consumido)", async () => {
    f.rpc.mockResolvedValue({ data: false, error: null });
    const res = await runCallback(await signed());
    expect(res.headers.get("Location")).toContain("state_invalido_ou_expirado");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.upserts).toHaveLength(0);
  });

  it("recusa quando o consumo do nonce falha (fail-closed)", async () => {
    f.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await runCallback(await signed());
    expect(res.headers.get("Location")).toContain("state_invalido_ou_expirado");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("recusa do Google consome o state e não reflete texto externo", async () => {
    const res = await runCallback(await signed(), "&error=<script>texto-externo");
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(res.headers.get("Location")).toContain("autorizacao_recusada");
    expect(res.headers.get("Location")).not.toContain("texto-externo");
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

describe("google-calendar-connect — membership", () => {
  it("usuário com uma org: emite state verificável e grava o nonce dele", async () => {
    const res = await runConnect();
    expect(res.status).toBe(200);
    const { authorization_url } = await res.json();
    const state = new URL(authorization_url).searchParams.get("state")!;
    const payload = await verifyGoogleCalendarState(state, SECRET);
    expect(payload).toMatchObject({ userId: USER, orgId: ORG });
    expect(f.inserts).toEqual([
      {
        table: "google_calendar_oauth_nonces",
        row: { nonce: payload!.nonce, user_id: USER, organization_id: ORG, expires_at: new Date(payload!.exp).toISOString() },
      },
    ]);
  });

  it("recusa sem membership ativa — sem state, sem nonce", async () => {
    f.memberships = { data: [], error: null };
    const res = await runConnect();
    expect(res.status).toBe(403);
    expect(f.inserts).toHaveLength(0);
  });

  it("recusa org explícita da qual o usuário não é membro", async () => {
    const res = await runConnect(`?organization_id=${VICTIM_ORG}`);
    expect(res.status).toBe(403);
    expect(f.inserts).toHaveLength(0);
  });

  it("multi-org exige org explícita e assina a org pedida", async () => {
    f.memberships = { data: [{ organization_id: ORG }, { organization_id: ORG_B }], error: null };
    expect((await runConnect()).status).toBe(400);
    const res = await runConnect(`?organization_id=${ORG_B}`);
    expect(res.status).toBe(200);
    const state = new URL((await res.json()).authorization_url).searchParams.get("state")!;
    expect(await verifyGoogleCalendarState(state, SECRET)).toMatchObject({ orgId: ORG_B });
  });

  it("recusa organization_id fora do formato UUID", async () => {
    expect((await runConnect("?organization_id=nao-e-uuid")).status).toBe(400);
  });

  it("recusa JWT inválido", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect((await runConnect()).status).toBe(401);
  });
});
