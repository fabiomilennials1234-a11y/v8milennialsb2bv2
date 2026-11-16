// @vitest-environment node
/**
 * Migration 20280116000000_google_watch_channel_unico — contra Postgres de
 * verdade (PGlite, em memória).
 *
 * Trava:
 *   - migration só schema: com duplicata ativa o CREATE INDEX falha alto;
 *   - índice único parcial: 2 ativas para o mesmo (user, calendar) é impossível;
 *   - replace_google_watch_channel: CAS (mesmo expected 2× ⇒ só 1 vence),
 *     reconexão substitui todas, unique_violation não propaga e desfaz a
 *     desativação;
 *   - grants: só service_role executa.
 *
 * PGlite é uma conexão só, então a concorrência real (dois UPDATE no mesmo
 * canal) não é exercitada aqui; ela se apoia no lock de linha do Postgres sob
 * READ COMMITTED — o segundo UPDATE reavalia `is_active` após o commit do
 * primeiro e não afeta nada. O caso sequencial abaixo é o mesmo resultado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20280116000000_google_watch_channel_unico.sql", import.meta.url),
  "utf8",
);

// Recorte do baseline (20260101000000_baseline_prod_schema.sql) + o que a
// Supabase faz por padrão: funções novas em public nascem executáveis por
// anon/authenticated/service_role.
const FIXTURE = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

  CREATE TABLE public.google_calendar_watch_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    channel_id text NOT NULL UNIQUE,
    resource_id text,
    calendar_id text DEFAULT 'primary' NOT NULL,
    expiration timestamptz,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
  );
  GRANT ALL ON public.google_calendar_watch_channels TO service_role;
`;

const U1 = "00000000-0000-0000-0000-000000000001";
const U2 = "00000000-0000-0000-0000-000000000002";
const ORG = "00000000-0000-0000-0000-0000000000aa";

let db: PGlite;

async function seedChannel(
  channelId: string,
  opts: { user?: string; active?: boolean; expiration?: string; createdAt?: string; resource?: string | null } = {},
) {
  await db.query(
    `INSERT INTO public.google_calendar_watch_channels
       (user_id, organization_id, channel_id, resource_id, expiration, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`,
    [
      opts.user ?? U1,
      ORG,
      channelId,
      opts.resource === undefined ? `res-${channelId}` : opts.resource,
      opts.expiration ?? "2026-11-20T00:00:00Z",
      opts.active ?? true,
      opts.createdAt ?? null,
    ],
  );
}

type Outcome = { won: boolean; stopped: Array<{ channel_id: string; resource_id: string | null }> };

async function replace(channelId: string, expected: string | null, user = U1): Promise<Outcome> {
  await db.exec("SET ROLE service_role");
  try {
    const { rows } = await db.query<{ r: Outcome }>(
      `SELECT public.replace_google_watch_channel($1, $2, 'primary', $3, $4, $5, $6) AS r`,
      [user, ORG, channelId, `res-${channelId}`, "2026-11-23T00:00:00Z", expected],
    );
    return rows[0].r;
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function active(user = U1): Promise<string[]> {
  const { rows } = await db.query<{ channel_id: string }>(
    `SELECT channel_id FROM public.google_calendar_watch_channels
      WHERE user_id = $1 AND is_active ORDER BY channel_id`,
    [user],
  );
  return rows.map((r) => r.channel_id);
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(FIXTURE);
});

describe("migration: índice único parcial (só schema, sem DML)", () => {
  it("fails loudly when two active rows already exist for the same (user, calendar)", async () => {
    await seedChannel("a", { expiration: "2026-11-18T00:00:00Z" });
    await seedChannel("b", { expiration: "2026-11-22T00:00:00Z" });

    await expect(db.exec(MIGRATION)).rejects.toThrow(/could not create unique index|uq_watch_channels_active_user_calendar/);
    // nada foi "consertado" por baixo: as duas seguem ativas
    expect(await active(U1)).toEqual(["a", "b"]);
  });

  it("applies cleanly with 1 active per (user, calendar) + inactive leftovers, and is re-runnable", async () => {
    await seedChannel("a");
    await seedChannel("old", { active: false });
    await seedChannel("z", { user: U2 });
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await active(U1)).toEqual(["a"]);
    expect(await active(U2)).toEqual(["z"]);
  });

  it("contains no top-level DML", () => {
    const outsideFunction = MIGRATION.replace(/AS \$\$[\s\S]*?\$\$;/, "").replace(/--.*$/gm, "");
    expect(outsideFunction).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });

  it("rejects a second active row for the same (user, calendar)", async () => {
    await db.exec(MIGRATION);
    await seedChannel("a");
    await expect(seedChannel("b")).rejects.toThrow(/uq_watch_channels_active_user_calendar/);
    // inativas não contam
    await seedChannel("c", { active: false });
  });
});

describe("replace_google_watch_channel", () => {
  beforeEach(async () => {
    await db.exec(MIGRATION);
  });

  it("CAS: two renewals with the same expected → only one wins, 1 active channel", async () => {
    await seedChannel("old");

    const first = await replace("new-1", "old");
    const second = await replace("new-2", "old");

    expect(first).toEqual({ won: true, stopped: [{ channel_id: "old", resource_id: "res-old" }] });
    expect(second).toEqual({ won: false, stopped: [] });
    expect(await active()).toEqual(["new-1"]);
    // o perdedor não deixou linha nenhuma
    const { rows } = await db.query(`SELECT 1 FROM public.google_calendar_watch_channels WHERE channel_id = 'new-2'`);
    expect(rows).toHaveLength(0);
  });

  it("CAS against a channel that is not the active one loses", async () => {
    await seedChannel("dead", { active: false });
    await seedChannel("live");

    expect(await replace("new", "dead")).toEqual({ won: false, stopped: [] });
    expect(await active()).toEqual(["live"]);
  });

  it("CAS does not touch another user's channel", async () => {
    await seedChannel("other", { user: U2 });
    expect(await replace("new", "other", U1)).toEqual({ won: false, stopped: [] });
    expect(await active(U2)).toEqual(["other"]);
  });

  it("reconnect (expected = null) replaces the active channel and reports it to stop", async () => {
    await seedChannel("old");
    const out = await replace("fresh", null);
    expect(out).toEqual({ won: true, stopped: [{ channel_id: "old", resource_id: "res-old" }] });
    expect(await active()).toEqual(["fresh"]);
  });

  it("first connection (no active row) wins with nothing to stop", async () => {
    expect(await replace("first", null)).toEqual({ won: true, stopped: [] });
    expect(await active()).toEqual(["first"]);
  });

  it("unique_violation is swallowed as won=false and rolls back the deactivation", async () => {
    await seedChannel("live");
    await seedChannel("taken", { active: false });

    // channel_id já existe ⇒ INSERT viola UNIQUE(channel_id)
    expect(await replace("taken", null)).toEqual({ won: false, stopped: [] });
    expect(await active()).toEqual(["live"]);
  });

  it("is executable only by service_role", async () => {
    const { rows } = await db.query<{ role: string; ok: boolean }>(`
      SELECT r AS role,
             has_function_privilege(r, 'public.replace_google_watch_channel(uuid, uuid, text, text, text, timestamptz, text)', 'EXECUTE') AS ok
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'public']) AS r
    `);
    expect(Object.fromEntries(rows.map((r) => [r.role, r.ok]))).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
      public: false,
    });
  });

  it("is SECURITY INVOKER with a pinned search_path", async () => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] }>(`
      SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'replace_google_watch_channel'
    `);
    expect(rows[0].prosecdef).toBe(false);
    expect(rows[0].proconfig).toEqual(["search_path=public, pg_temp"]);
  });
});
