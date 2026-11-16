// @vitest-environment node
/**
 * google-calendar-webhook + replace_google_watch_channel — ponta a ponta.
 *
 * Handler REAL do webhook, registerWatchChannel REAL, RPC REAL (migration
 * aplicada num Postgres em memória — PGlite), Google dublado. Reproduz as duas
 * formas do incidente de 2026-11-16 (24 mil req REST em 5 min):
 *
 *   1. rajada: K notificações concorrentes do canal ativo perto de expirar
 *      → 1 canal ativo no fim; os K-1 perdedores param o próprio canal no
 *      Google; o canal antigo é parado; nenhum erro;
 *   2. tempestade de canais mortos: 3.000 notificações de canais inativos ou
 *      desconhecidos → exatamente 1 SELECT cada, 0 chamada ao Google, 0 token.
 *
 * Promovido do harness do QA (volta 1 do fix).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../helpers/deno-mock";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MIGRATION = read("supabase/migrations/20280116000000_google_watch_channel_unico.sql");

// DDL literal do baseline de prod: CREATE TABLE + PK/UNIQUE + índices.
const BASELINE = read("supabase/migrations/20260101000000_baseline_prod_schema.sql").split("\n");
const TABLE_DDL = [
  BASELINE.slice(24529, 24541).join("\n"),
  BASELINE.slice(29087, 29094).join("\n"),
  BASELINE.slice(32395, 32408).join("\n"),
].join("\n");

type Handler = (req: Request) => Promise<Response>;
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({ handler: null as null | Handler, client: null as unknown }));

const denoGlobal = (globalThis as unknown as { Deno: { serve: unknown; env: { set(k: string, v: string): void } } }).Deno;
denoGlobal.serve = (fn: Handler) => {
  h.handler = fn;
};
denoGlobal.env.set("SUPABASE_URL", "https://proj.supabase.co");

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => h.client,
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
  getPipeEntry: vi.fn(),
  upsertPipeEntry: vi.fn(),
  updatePipeEntryById: vi.fn(),
}));

const getValidAccessToken = vi.fn();
vi.mock("../../supabase/functions/_shared/google-calendar-utils.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../supabase/functions/_shared/google-calendar-utils.ts")
  >();
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getValidAccessToken(...args),
    logCalendarOp: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Google dublado ───────────────────────────────────────────────────────────
const google = { watch: [] as string[], stop: [] as string[], list: 0 };
const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 3)); // embaralha a chegada

global.fetch = (async (url: string, init?: RequestInit) => {
  await jitter();
  if (url.includes("/events/watch")) {
    const { id } = JSON.parse(String(init!.body));
    google.watch.push(id);
    return {
      ok: true,
      json: async () => ({ resourceId: `res-${id}`, expiration: String(Date.now() + 7 * DAY) }),
    };
  }
  if (url.includes("/channels/stop")) {
    google.stop.push(JSON.parse(String(init!.body)).id);
    return { ok: true, json: async () => ({}) };
  }
  if (url.includes("/calendars/primary/events?")) {
    google.list++;
    return { ok: true, json: async () => ({ items: [] }), text: async () => "" };
  }
  throw new Error(`unexpected fetch ${url}`);
}) as unknown as typeof fetch;

// ── Supabase dublado sobre o PGlite (RPC real) ───────────────────────────────
let db: PGlite;
const ops = { total: 0, selects: 0 };

function makeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let mode: "select" | "update" = "select";
      let cols = "*";
      let patch: Row = {};
      const run = async (single: boolean) => {
        const where = filters.map(([c], i) => `${c} = $${i + 1}`).join(" AND ");
        const params = filters.map(([, v]) => v);
        ops.total++;
        if (mode === "select") {
          ops.selects++;
          const r = await db.query<Row>(`SELECT ${cols} FROM public.${table} WHERE ${where}`, params);
          const rows = r.rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
            ),
          );
          return { data: single ? rows[0] ?? null : rows, error: null };
        }
        const sets = Object.keys(patch).map((k, i) => `${k} = $${params.length + i + 1}`).join(", ");
        await db.query(`UPDATE public.${table} SET ${sets} WHERE ${where}`, [...params, ...Object.values(patch)]);
        return { data: null, error: null };
      };
      const q = {
        select(c: string) { cols = c; return q; },
        update(p: Row) { mode = "update"; patch = p; return q; },
        eq(c: string, v: unknown) { filters.push([c, v]); return q; },
        maybeSingle: () => run(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej),
      };
      return q;
    },
    async rpc(name: string, p: Row) {
      ops.total++;
      if (name !== "replace_google_watch_channel") throw new Error(`unexpected rpc ${name}`);
      await db.exec("SET ROLE service_role");
      try {
        const r = await db.query<{ out: unknown }>(
          `SELECT public.replace_google_watch_channel($1,$2,$3,$4,$5,$6,$7) AS out`,
          [p.p_user_id, p.p_org_id, p.p_calendar_id, p.p_channel_id, p.p_resource_id, p.p_expiration, p.p_expected_old_channel_id],
        );
        return { data: r.rows[0].out, error: null };
      } finally {
        await db.exec("RESET ROLE");
      }
    },
  };
}

const DAY = 864e5;
const U1 = "00000000-0000-0000-0000-000000000001";
const ORG = "00000000-0000-0000-0000-0000000000aa";

async function freshDb() {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ${TABLE_DDL}
    GRANT ALL ON public.google_calendar_watch_channels TO service_role;
  `);
  await db.exec(MIGRATION);
}

async function seed(channelId: string, expiresInMs: number, active = true) {
  await db.query(
    `INSERT INTO public.google_calendar_watch_channels
       (user_id, organization_id, channel_id, resource_id, expiration, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [U1, ORG, channelId, `res-${channelId}`, new Date(Date.now() + expiresInMs).toISOString(), active],
  );
}

const actives = async () =>
  (
    await db.query<{ channel_id: string }>(
      `SELECT channel_id FROM public.google_calendar_watch_channels WHERE is_active ORDER BY created_at`,
    )
  ).rows.map((r) => r.channel_id);

function notify(channelId: string) {
  return h.handler!(
    new Request("https://x/functions/v1/google-calendar-webhook", {
      method: "POST",
      headers: { "X-Goog-Channel-ID": channelId, "X-Goog-Resource-State": "exists", "X-Goog-Resource-ID": "r" },
    }),
  );
}

/** O handler responde 200 e processa em background; espera N processamentos. */
const processed = (n: number, timeout = 20_000) =>
  vi.waitFor(() => expect(logRuntime).toHaveBeenCalledTimes(n), { timeout, interval: 10 });

await import("../../supabase/functions/google-calendar-webhook/index.ts");
const utils = await import("../../supabase/functions/_shared/google-calendar-utils.ts");

beforeEach(async () => {
  google.watch = [];
  google.stop = [];
  google.list = 0;
  ops.total = 0;
  ops.selects = 0;
  logRuntime.mockClear();
  getValidAccessToken.mockReset().mockResolvedValue({ accessToken: "tok", googleEmail: "a@b.c" });
  h.client = makeClient();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await freshDb();
});

describe("rajada no canal ativo perto de expirar", () => {
  it("K=50 concurrent notifications → 1 active channel, 49 losers stopped, old channel stopped", async () => {
    await seed("ch-old", DAY); // 1 dia → dentro da janela de 2 dias
    const K = 50;

    const res = await Promise.all(Array.from({ length: K }, () => notify("ch-old")));
    expect(res.every((r) => r.status === 200)).toBe(true);
    await processed(K);

    const act = await actives();
    expect(act).toHaveLength(1);
    const [winner] = act;
    const stopped = new Set(google.stop);
    const losers = google.watch.filter((c) => c !== winner);

    expect(google.watch).toHaveLength(K);
    expect(google.watch).toContain(winner);
    expect(stopped.has(winner)).toBe(false);
    expect(stopped.has("ch-old")).toBe(true);
    expect(losers).toHaveLength(K - 1);
    expect(losers.every((l) => stopped.has(l))).toBe(true);
    expect(google.stop).toHaveLength(K); // K-1 perdedores + o antigo
    expect(logRuntime.mock.calls.filter((c) => (c[0] as Row).status === "error")).toHaveLength(0);

    // Segunda onda, já depois da troca: antigo (inativo) e novo (longe de expirar)
    // não criam canal nenhum.
    google.watch = [];
    logRuntime.mockClear();
    await Promise.all([
      ...Array.from({ length: 25 }, () => notify("ch-old")),
      ...Array.from({ length: 25 }, () => notify(winner)),
    ]);
    await processed(50);
    expect(google.watch).toHaveLength(0);
    expect(await actives()).toEqual([winner]);
  }, 30_000);
});

describe("tempestade de canais mortos", () => {
  it("3,000 notifications from inactive/unknown channels → exactly 1 SELECT each, 0 Google calls, 0 token", async () => {
    // expiração curta: se o webhook passasse do SELECT, renovaria
    for (let i = 0; i < 30; i++) await seed(`dead-${i}`, 3_600_000, false);
    await seed("live", DAY, true);
    const N = 3000;
    const ids = Array.from({ length: N }, (_, i) => (i % 3 === 0 ? `unknown-${i}` : `dead-${i % 30}`));

    await Promise.all(ids.map((id) => notify(id)));
    await processed(N, 60_000);

    expect(ops.total).toBe(N);
    expect(ops.selects).toBe(N);
    expect(google.watch.length + google.stop.length + google.list).toBe(0);
    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(await actives()).toEqual(["live"]);
  }, 60_000);
});

describe("reconexão OAuth e disconnect", () => {
  it("reconnect over 1 active channel → exactly 1 active (the new one), old stopped", async () => {
    await seed("ch-prev", 5 * DAY);

    // O que o callback chama (google-calendar-callback/index.ts:144): sem expected.
    const out = await utils.registerWatchChannel(U1, ORG, "tok", h.client as never);

    expect(out).toEqual({ renewed: true });
    expect(await actives()).toEqual(google.watch);
    expect(google.stop).toEqual(["ch-prev"]);
  });

  it("first connection then immediate reconnection → 1 active, the first one stopped", async () => {
    await utils.registerWatchChannel(U1, ORG, "tok", h.client as never);
    await utils.registerWatchChannel(U1, ORG, "tok", h.client as never);

    expect(await actives()).toEqual([google.watch[1]]);
    expect(google.stop).toEqual([google.watch[0]]);
  });

  it("disconnect stops the active channel and deactivates all; reconnect afterwards works", async () => {
    await seed("x-dead", DAY, false);
    await seed("x-live", DAY, true);

    await utils.cancelWatchChannels(U1, "tok", h.client as never);
    expect(google.stop).toEqual(["x-live"]);
    expect(await actives()).toEqual([]);

    await utils.registerWatchChannel(U1, ORG, "tok", h.client as never);
    expect(await actives()).toEqual(google.watch);
  });
});
