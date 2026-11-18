// @vitest-environment node
/**
 * stopOrphanWatchChannels — incidente 2026-11-18.
 *
 * 3.618 canais `is_active=false` ainda vivos no Google faziam cada mudança de
 * agenda virar ~3,6 mil webhooks simultâneos. A rotina para cada órfão no
 * Google com o token do dono e zera a expiration — e não toca em mais nada.
 */
import { describe, it, expect, vi } from "vitest";
import "../helpers/deno-mock";
import { stopOrphanWatchChannels } from "../../supabase/functions/_shared/google-watch-orphans";

type Row = {
  channel_id: string;
  resource_id: string | null;
  user_id: string;
  is_active: boolean;
  expiration: string;
};

const NOW = new Date("2026-11-18T18:00:00Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const H = 3_600_000;

/** Dublê mínimo do query builder, com a semântica dos filtros usados. */
function fakeDb(rows: Row[]) {
  const updates: string[][] = [];
  const client = {
    from() {
      const preds: Array<(r: Row) => boolean> = [];
      let mode: "select" | "update" = "select";
      let patch: Partial<Row> = {};
      let lim = Infinity;
      const q = {
        select: () => q,
        update: (p: Partial<Row>) => { mode = "update"; patch = p; return q; },
        eq: (c: keyof Row, v: unknown) => { preds.push((r) => r[c] === v); return q; },
        gt: (c: keyof Row, v: string) => { preds.push((r) => String(r[c]) > v); return q; },
        not: (c: keyof Row, _op: string, _v: null) => { preds.push((r) => r[c] !== null); return q; },
        in: (c: keyof Row, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return q; },
        order: () => q,
        limit: (n: number) => { lim = n; return q; },
        then: (res: (v: unknown) => unknown) => {
          const hit = rows.filter((r) => preds.every((p) => p(r)));
          if (mode === "update") {
            updates.push(hit.map((r) => r.channel_id));
            hit.forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null }).then(res);
          }
          return Promise.resolve({ data: hit.slice(0, lim), error: null }).then(res);
        },
      };
      return q;
    },
  };
  return { client: client as never, updates };
}

const orphan = (id: string, user = "u1", resource: string | null = `res-${id}`): Row => ({
  channel_id: id,
  resource_id: resource,
  user_id: user,
  is_active: false,
  expiration: iso(48 * H),
});

describe("stopOrphanWatchChannels", () => {
  it("para só órfãos vivos, com o token do dono, e zera a expiration deles", async () => {
    const rows: Row[] = [
      orphan("o1", "u1"),
      orphan("o2", "u2"),
      { ...orphan("expired"), expiration: iso(-H) },          // Google já não notifica
      { ...orphan("active"), is_active: true },                // canal vivo de verdade
      orphan("no-res", "u1", null),                            // sem resource_id: não dá pra parar
    ];
    const { client } = fakeDb(rows);
    const stop = vi.fn().mockResolvedValue(204);
    const getAccessToken = vi.fn(async (u: string) => `tok-${u}`);

    const out = await stopOrphanWatchChannels(client, { getAccessToken, stopChannel: stop, now: () => NOW });

    expect(out).toEqual({ found: 2, stopped: 2, alreadyGone: 0, failed: 0, usersWithoutToken: 0, remaining: false });
    expect(stop.mock.calls.map((c) => c.slice(0, 2)).sort()).toEqual([["tok-u1", "o1"], ["tok-u2", "o2"]]);
    expect(rows.find((r) => r.channel_id === "o1")!.expiration).toBe(NOW.toISOString());
    expect(rows.find((r) => r.channel_id === "active")!.expiration).toBe(iso(48 * H));
    expect(rows.find((r) => r.channel_id === "active")!.is_active).toBe(true);
  });

  it("um refresh de token por dono, não por canal", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => orphan(`c${i}`, i % 2 ? "u1" : "u2"));
    const { client } = fakeDb(rows);
    const getAccessToken = vi.fn(async (u: string) => `tok-${u}`);

    await stopOrphanWatchChannels(client, { getAccessToken, stopChannel: async () => 204, now: () => NOW });

    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("404 conta como já parado; erro e falta de token deixam a linha para a próxima passada", async () => {
    const rows = [orphan("gone"), orphan("boom"), orphan("net"), orphan("notoken", "u-sem-token")];
    const { client } = fakeDb(rows);
    const status: Record<string, number | null> = { gone: 404, boom: 500, net: null };

    const out = await stopOrphanWatchChannels(client, {
      getAccessToken: async (u) => (u === "u-sem-token" ? null : "tok"),
      stopChannel: async (_t, id) => status[id],
      now: () => NOW,
    });

    expect(out).toMatchObject({ found: 4, stopped: 0, alreadyGone: 1, failed: 3, usersWithoutToken: 1 });
    const exp = Object.fromEntries(rows.map((r) => [r.channel_id, r.expiration]));
    expect(exp.gone).toBe(NOW.toISOString());
    expect(exp.boom).toBe(iso(48 * H));
    expect(exp.net).toBe(iso(48 * H));
    expect(exp.notoken).toBe(iso(48 * H));
  });

  it("respeita o limite e sinaliza que sobrou; segunda passada termina", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => orphan(`c${i}`));
    const { client } = fakeDb(rows);
    const deps = { getAccessToken: async () => "tok", stopChannel: async () => 204, now: () => NOW };

    const first = await stopOrphanWatchChannels(client, deps, 3);
    expect(first).toMatchObject({ found: 3, stopped: 3, remaining: true });

    const second = await stopOrphanWatchChannels(client, deps, 3);
    expect(second).toMatchObject({ found: 2, stopped: 2, remaining: false });

    const third = await stopOrphanWatchChannels(client, deps, 3);
    expect(third).toMatchObject({ found: 0, remaining: false });
  });

  it("UPDATE em blocos de no máximo 200 ids", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => orphan(`c${i}`));
    const { client, updates } = fakeDb(rows);

    await stopOrphanWatchChannels(client, { getAccessToken: async () => "tok", stopChannel: async () => 204, now: () => NOW });

    expect(updates.map((u) => u.length)).toEqual([200, 200, 50]);
  });
});
