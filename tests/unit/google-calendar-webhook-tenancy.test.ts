// @vitest-environment node
/**
 * google-calendar-webhook — isolamento entre tenants.
 *
 * Handler REAL do webhook, registerWatchChannel REAL, schema REAL (DDL do
 * baseline de prod + migrations 20280116000000 e 20280116020000 num Postgres
 * em memória — PGlite), Google dublado. Trava os três vetores:
 *
 *   1. lead_id vem de extendedProperties.private do evento, escrito por quem é
 *      dono da agenda. Lead de OUTRA org não é tocado (compromisso_date,
 *      vínculo no cache, pipeline), nem em evento confirmado nem cancelado.
 *   2. O id de evento do Google se repete entre participantes de orgs
 *      diferentes. A linha de cache de um usuário NUNCA muda de dono/tenant
 *      quando outro usuário sincroniza o mesmo evento.
 *   3. X-Goog-Channel-Token: canal com hash exige o token; canal legado (hash
 *      NULL) é aceito até a renovação; registerWatchChannel manda o token ao
 *      Google e grava só o hash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../helpers/deno-mock";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const WATCH_MIGRATION = read("supabase/migrations/20280116000000_google_watch_channel_unico.sql");
const MIGRATION = read("supabase/migrations/20280116020000_google_calendar_cache_por_usuario_e_token_do_canal.sql");
const ROLLBACK = read("supabase/migrations/rollback/20280116020000_google_calendar_cache_por_usuario_e_token_do_canal.sql");

// DDL literal do baseline de prod.
const BASELINE = read("supabase/migrations/20260101000000_baseline_prod_schema.sql").split("\n");
const slice = (from: number, to: number) => BASELINE.slice(from - 1, to).join("\n");
const CACHE_DDL = [slice(24417, 24438), slice(29068, 29069), slice(30296, 30296)].join("\n");
const WATCH_DDL = [slice(24530, 24541), slice(29088, 29094), slice(32396, 32408)].join("\n");

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

const pipe = vi.hoisted(() => ({
  getPipeEntry: vi.fn(),
  upsertPipeEntry: vi.fn(),
  updatePipeEntryById: vi.fn(),
}));
vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => pipe);

const getValidAccessToken = vi.fn();
const logCalendarOp = vi.fn().mockResolvedValue(undefined);
vi.mock("../../supabase/functions/_shared/google-calendar-utils.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../supabase/functions/_shared/google-calendar-utils.ts")
  >();
  return {
    ...actual,
    getValidAccessToken: (...args: unknown[]) => getValidAccessToken(...args),
    logCalendarOp: (...args: unknown[]) => logCalendarOp(...args),
  };
});

// ── Google dublado ───────────────────────────────────────────────────────────
const google = {
  /** eventos devolvidos pelo list, por access token (= por usuário) */
  eventsByToken: {} as Record<string, Row[]>,
  watch: [] as Array<{ id: string; token?: string }>,
  stop: [] as string[],
  list: 0,
};

global.fetch = (async (url: string, init?: RequestInit) => {
  if (url.includes("/events/watch")) {
    const body = JSON.parse(String(init!.body));
    google.watch.push({ id: body.id, token: body.token });
    return {
      ok: true,
      json: async () => ({ resourceId: `res-${body.id}`, expiration: String(Date.now() + 7 * DAY) }),
    };
  }
  if (url.includes("/channels/stop")) {
    google.stop.push(JSON.parse(String(init!.body)).id);
    return { ok: true, json: async () => ({}) };
  }
  if (url.includes("/calendars/primary/events?")) {
    google.list++;
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    const items = google.eventsByToken[auth.replace("Bearer ", "")] ?? [];
    return { ok: true, json: async () => ({ items }), text: async () => "" };
  }
  throw new Error(`unexpected fetch ${url}`);
}) as unknown as typeof fetch;

// ── Supabase dublado sobre o PGlite ──────────────────────────────────────────
let db: PGlite;

const toParam = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
const normalize = (row: Row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));

function makeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let mode: "select" | "update" | "upsert" = "select";
      let cols = "*";
      let patch: Row = {};
      let conflict = "";
      const run = async (single: boolean) => {
        try {
          if (mode === "upsert") {
            const keys = Object.keys(patch);
            const conflictCols = conflict.split(",").map((c) => c.trim());
            const sets = keys
              .filter((k) => !conflictCols.includes(k))
              .map((k) => `${k} = EXCLUDED.${k}`)
              .join(", ");
            await db.query(
              `INSERT INTO public.${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
               ON CONFLICT (${conflictCols.join(", ")}) DO UPDATE SET ${sets}`,
              keys.map((k) => toParam(patch[k])),
            );
            return { data: null, error: null };
          }
          const where = filters.map(([c], i) => `${c} = $${i + 1}`).join(" AND ") || "true";
          const params = filters.map(([, v]) => v);
          if (mode === "select") {
            const r = await db.query<Row>(`SELECT ${cols} FROM public.${table} WHERE ${where}`, params);
            const rows = r.rows.map(normalize);
            return { data: single ? rows[0] ?? null : rows, error: null };
          }
          const sets = Object.keys(patch).map((k, i) => `${k} = $${params.length + i + 1}`).join(", ");
          await db.query(`UPDATE public.${table} SET ${sets} WHERE ${where}`, [
            ...params,
            ...Object.values(patch).map(toParam),
          ]);
          return { data: null, error: null };
        } catch (e) {
          return { data: null, error: { message: String(e), code: "XX000" } };
        }
      };
      const q = {
        select(c: string) { cols = c; return q; },
        update(p: Row) { mode = "update"; patch = p; return q; },
        upsert(p: Row, opts: { onConflict: string }) {
          mode = "upsert"; patch = p; conflict = opts.onConflict;
          return run(false);
        },
        eq(c: string, v: unknown) { filters.push([c, v]); return q; },
        maybeSingle: () => run(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej),
      };
      return q;
    },
    async rpc(name: string, p: Row) {
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
const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const ORG_B = "00000000-0000-0000-0000-0000000000bb";
const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const LEAD_A = "11111111-1111-1111-1111-111111111111"; // lead da org A (vítima)
const LEAD_B = "22222222-2222-2222-2222-222222222222"; // lead da org B (atacante)
const ORIGINAL_DATE = "2026-12-01T13:00:00.000Z";

async function freshDb() {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ${CACHE_DDL}
    ${WATCH_DDL}
    GRANT ALL ON public.google_calendar_watch_channels TO service_role;
    CREATE TABLE public.leads (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      compromisso_date timestamptz
    );
  `);
  await db.exec(WATCH_MIGRATION);
  await db.exec(MIGRATION);
  await db.query(`INSERT INTO public.leads VALUES ($1, $2, $3), ($4, $5, $6)`, [
    LEAD_A, ORG_A, ORIGINAL_DATE,
    LEAD_B, ORG_B, ORIGINAL_DATE,
  ]);
}

async function seedChannel(channelId: string, userId: string, orgId: string, tokenHash: string | null = null) {
  await db.query(
    `INSERT INTO public.google_calendar_watch_channels
       (user_id, organization_id, channel_id, resource_id, expiration, is_active, channel_token_hash)
     VALUES ($1, $2, $3, $4, $5, true, $6)`,
    [userId, orgId, channelId, `res-${channelId}`, new Date(Date.now() + 6 * DAY).toISOString(), tokenHash],
  );
}

function googleEvent(id: string, opts: { leadId?: string; status?: string; start?: string } = {}): Row {
  return {
    id,
    status: opts.status ?? "confirmed",
    summary: "Reunião",
    start: { dateTime: opts.start ?? "2027-01-15T15:00:00.000Z" },
    end: { dateTime: "2027-01-15T16:00:00.000Z" },
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    ...(opts.leadId ? { extendedProperties: { private: { lead_id: opts.leadId } } } : {}),
  };
}

function notify(channelId: string, token?: string) {
  const headers: Record<string, string> = {
    "X-Goog-Channel-ID": channelId,
    "X-Goog-Resource-State": "exists",
    "X-Goog-Resource-ID": "r",
  };
  if (token !== undefined) headers["X-Goog-Channel-Token"] = token;
  return h.handler!(new Request("https://x/functions/v1/google-calendar-webhook", { method: "POST", headers }));
}

/** O handler responde 200 e processa em background; espera N processamentos. */
const processed = (n = 1) => vi.waitFor(() => expect(logRuntime).toHaveBeenCalledTimes(n), { interval: 5 });

const leadDate = async (id: string) =>
  normalize((await db.query<Row>(`SELECT compromisso_date FROM public.leads WHERE id = $1`, [id])).rows[0])
    .compromisso_date;

const cacheRows = async (eventId: string) =>
  (
    await db.query<Row>(
      `SELECT user_id, organization_id, lead_id, title FROM public.google_calendar_events_cache
       WHERE id = $1 ORDER BY user_id`,
      [eventId],
    )
  ).rows;

await import("../../supabase/functions/google-calendar-webhook/index.ts");
const utils = await import("../../supabase/functions/_shared/google-calendar-utils.ts");

beforeEach(async () => {
  google.eventsByToken = {};
  google.watch = [];
  google.stop = [];
  google.list = 0;
  logRuntime.mockClear();
  logCalendarOp.mockClear();
  pipe.getPipeEntry.mockReset().mockResolvedValue(null);
  pipe.upsertPipeEntry.mockReset().mockResolvedValue(undefined);
  pipe.updatePipeEntryById.mockReset().mockResolvedValue(undefined);
  getValidAccessToken.mockReset().mockImplementation(async (userId: string) => ({
    accessToken: `tok-${userId}`,
    googleEmail: "x@y.z",
  }));
  h.client = makeClient();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await freshDb();
});

// ── 1. lead_id do evento só vale na org do canal ─────────────────────────────
describe("lead_id from the event is scoped to the channel's org", () => {
  it("confirmed event pointing at another org's lead: lead untouched, no cache link, no pipeline write", async () => {
    await seedChannel("ch-b", USER_B, ORG_B);
    google.eventsByToken[`tok-${USER_B}`] = [googleEvent("evt-attack", { leadId: LEAD_A })];

    await notify("ch-b");
    await processed();

    expect(await leadDate(LEAD_A)).toBe(ORIGINAL_DATE);
    expect(await cacheRows("evt-attack")).toEqual([
      { user_id: USER_B, organization_id: ORG_B, lead_id: null, title: "Reunião" },
    ]);
    expect(pipe.getPipeEntry).not.toHaveBeenCalled();
    expect(pipe.upsertPipeEntry).not.toHaveBeenCalled();
    expect(pipe.updatePipeEntryById).not.toHaveBeenCalled();
    expect(logCalendarOp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed", googleEventId: "evt-attack" }),
    );
  });

  it("cancelled event pointing at another org's lead does not clear its compromisso_date", async () => {
    await seedChannel("ch-b", USER_B, ORG_B);
    google.eventsByToken[`tok-${USER_B}`] = [googleEvent("evt-cancel", { leadId: LEAD_A, status: "cancelled" })];

    await notify("ch-b");
    await processed();

    expect(await leadDate(LEAD_A)).toBe(ORIGINAL_DATE);
  });

  it("malformed lead_id never reaches the leads table", async () => {
    await seedChannel("ch-b", USER_B, ORG_B);
    google.eventsByToken[`tok-${USER_B}`] = [googleEvent("evt-bad", { leadId: "' OR 1=1 --" })];

    await notify("ch-b");
    await processed();

    expect(await leadDate(LEAD_A)).toBe(ORIGINAL_DATE);
    expect(await leadDate(LEAD_B)).toBe(ORIGINAL_DATE);
    expect(logRuntime.mock.calls[0][0]).toMatchObject({ status: "success" });
  });

  it("control: lead of the channel's own org is updated and linked", async () => {
    await seedChannel("ch-b", USER_B, ORG_B);
    google.eventsByToken[`tok-${USER_B}`] = [
      googleEvent("evt-own", { leadId: LEAD_B, start: "2027-02-01T12:00:00.000Z" }),
    ];

    await notify("ch-b");
    await processed();

    expect(await leadDate(LEAD_B)).toBe("2027-02-01T12:00:00.000Z");
    expect(await cacheRows("evt-own")).toEqual([
      { user_id: USER_B, organization_id: ORG_B, lead_id: LEAD_B, title: "Reunião" },
    ]);
    expect(pipe.getPipeEntry).toHaveBeenCalledWith(expect.anything(), LEAD_B, ORG_B, "confirmacao");
    expect(pipe.upsertPipeEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ leadId: LEAD_B, orgId: ORG_B }),
    );
  });
});

// ── 2. linha de cache não muda de tenant ─────────────────────────────────────
describe("events cache rows never change tenant", () => {
  it("same Google event id synced by a user of another org: owner's row intact, each user gets their own", async () => {
    await seedChannel("ch-a", USER_A, ORG_A);
    await seedChannel("ch-b", USER_B, ORG_B);
    google.eventsByToken[`tok-${USER_A}`] = [googleEvent("evt-shared", { leadId: LEAD_A })];

    await notify("ch-a");
    await processed(1);
    expect(await cacheRows("evt-shared")).toEqual([
      { user_id: USER_A, organization_id: ORG_A, lead_id: LEAD_A, title: "Reunião" },
    ]);

    // B (outra org) é convidado do mesmo evento, renomeia na própria cópia e
    // sincroniza: o Google devolve o MESMO id.
    google.eventsByToken[`tok-${USER_B}`] = [{ ...googleEvent("evt-shared"), summary: "sequestro" }];
    await notify("ch-b");
    await processed(2);

    expect(await cacheRows("evt-shared")).toEqual([
      { user_id: USER_A, organization_id: ORG_A, lead_id: LEAD_A, title: "Reunião" },
      { user_id: USER_B, organization_id: ORG_B, lead_id: null, title: "sequestro" },
    ]);
  });

  it("the old key would have let it happen: rollback restores PK(id) and the same upsert hijacks the row", async () => {
    // Prova de que o teste acima depende da migration (e não passa por acaso).
    await db.exec(ROLLBACK);
    await db.query(
      `INSERT INTO public.google_calendar_events_cache (id, user_id, organization_id, start_at)
       VALUES ('evt-x', $1, $2, now())`,
      [USER_A, ORG_A],
    );
    await db.query(
      `INSERT INTO public.google_calendar_events_cache (id, user_id, organization_id, start_at)
       VALUES ('evt-x', $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, organization_id = EXCLUDED.organization_id`,
      [USER_B, ORG_B],
    );
    expect((await cacheRows("evt-x")).map((r) => r.organization_id)).toEqual([ORG_B]);
  });
});

// ── 3. X-Goog-Channel-Token ──────────────────────────────────────────────────
describe("watch channel token", () => {
  it("channel with token hash: missing or wrong token stops before access token and Google", async () => {
    await seedChannel("ch-b", USER_B, ORG_B, await utils.hashWatchChannelToken("right"));

    await notify("ch-b");
    await notify("ch-b", "wrong");
    await processed(2);

    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(google.list).toBe(0);
  });

  it("channel with token hash: right token is processed", async () => {
    await seedChannel("ch-b", USER_B, ORG_B, await utils.hashWatchChannelToken("right"));

    await notify("ch-b", "right");
    await processed();

    expect(getValidAccessToken).toHaveBeenCalledWith(USER_B, expect.anything());
    expect(google.list).toBe(1);
  });

  it("legacy channel without hash is still accepted while alive", async () => {
    await seedChannel("ch-legacy", USER_B, ORG_B, null);

    await notify("ch-legacy");
    await processed();

    expect(google.list).toBe(1);
  });

  it("legacy channel without hash is refused once expired (forged POST to a dead channel)", async () => {
    await seedChannel("ch-legacy-dead", USER_B, ORG_B, null);
    await db.query(
      `UPDATE public.google_calendar_watch_channels SET expiration = now() - interval '1 hour' WHERE channel_id = $1`,
      ["ch-legacy-dead"],
    );

    await notify("ch-legacy-dead");
    await processed();

    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(google.list).toBe(0);
  });

  it("registerWatchChannel sends a token to Google and stores only its hash; webhook accepts it", async () => {
    const out = await utils.registerWatchChannel(USER_B, ORG_B, `tok-${USER_B}`, h.client as never);
    expect(out).toEqual({ renewed: true });

    const [{ id, token }] = google.watch;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const row = (
      await db.query<Row>(
        `SELECT channel_token_hash FROM public.google_calendar_watch_channels WHERE channel_id = $1`,
        [id],
      )
    ).rows[0];
    expect(row.channel_token_hash).toBe(await utils.hashWatchChannelToken(token!));
    expect(row.channel_token_hash).not.toBe(token);

    await notify(id, token);
    await notify(id, "forged");
    await processed(2);
    expect(google.list).toBe(1);
  });
});
