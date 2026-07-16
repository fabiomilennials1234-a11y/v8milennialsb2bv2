// @vitest-environment node
/**
 * selectSendableInstance — prefer-live-with-fallback (anti-ban Onda 0 QW5).
 *
 * The three acceptance cases from the spec:
 *  (a) org with a live and a zombie instance → picks the live one;
 *  (b) org whose ONLY instance is flagged session_dead_since but still
 *      status=connected → the FALLBACK still returns it (the copilot reply
 *      must never be silenced by a stale watchdog flag);
 *  (c) org with no connected instance at all → null, same as before.
 */
import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

const { selectSendableInstance } = await import(
  "../../supabase/functions/_shared/whatsapp-dispatch.ts"
);

/** Chainable stub honouring eq/in/is/order/limit the way the helper uses them. */
function instancesStub(rows: any[]) {
  return {
    from(table: string) {
      if (table !== "whatsapp_instances") throw new Error(`unexpected table ${table}`);
      const filters: Array<(r: any) => boolean> = [];
      let ordering: { col: string; asc: boolean; nullsFirst?: boolean } | null = null;
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return q;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((r) => vals.includes(r[col]));
          return q;
        },
        is: (col: string, val: unknown) => {
          filters.push((r) => (val === null ? r[col] == null : r[col] === val));
          return q;
        },
        order: (col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => {
          ordering = { col, asc: opts?.ascending !== false, nullsFirst: opts?.nullsFirst };
          return q;
        },
        limit: () => q,
        maybeSingle: async () => {
          let out = rows.filter((r) => filters.every((f) => f(r)));
          if (ordering) {
            const { col, asc, nullsFirst } = ordering;
            out = out.slice().sort((a, b) => {
              const av = a[col];
              const bv = b[col];
              if (av == null && bv == null) return 0;
              if (av == null) return nullsFirst ? -1 : 1;
              if (bv == null) return nullsFirst ? 1 : -1;
              return asc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
            });
          }
          return { data: out[0] ?? null, error: null };
        },
      };
      return q;
    },
  } as any;
}

const inst = (over: Record<string, unknown>) => ({
  id: "i",
  organization_id: "org-1",
  provider: "uazapi",
  status: "connected",
  session_dead_since: null,
  last_connection_at: null,
  ...over,
});

describe("selectSendableInstance — prefer live, fall back, never regress", () => {
  it("(a) picks the live instance over the zombie (dead flag, frozen status)", async () => {
    const zombie = inst({ id: "zombie", session_dead_since: "2026-07-10T00:00:00Z", last_connection_at: "2026-07-16T09:00:00Z" });
    const live = inst({ id: "live", last_connection_at: "2026-07-15T10:00:00Z" });
    const out = await selectSendableInstance(instancesStub([zombie, live]), "org-1");
    expect(out?.id).toBe("live");
  });

  it("(a2) among live instances, prefers the most recently connected; NULL last_connection_at sorts last", async () => {
    const stale = inst({ id: "stale", last_connection_at: "2026-07-01T00:00:00Z" });
    const fresh = inst({ id: "fresh", last_connection_at: "2026-07-16T08:00:00Z" });
    const unknown = inst({ id: "never-polled", last_connection_at: null });
    const out = await selectSendableInstance(instancesStub([stale, unknown, fresh]), "org-1");
    expect(out?.id).toBe("fresh");
  });

  it("(b) the ONLY instance is dead-flagged but status=connected → fallback STILL sends (chat never silenced)", async () => {
    const flagged = inst({ id: "flagged", session_dead_since: "2026-07-16T07:00:00Z" });
    const out = await selectSendableInstance(instancesStub([flagged]), "org-1");
    expect(out?.id).toBe("flagged"); // never no_active_instance when connected exists
  });

  it("(c) no connected instance at all → null, exactly like the legacy query", async () => {
    const disconnected = inst({ id: "off", status: "disconnected" });
    const out = await selectSendableInstance(instancesStub([disconnected]), "org-1");
    expect(out).toBeNull();
  });

  it("scopes strictly by organization_id (multi-tenant)", async () => {
    const foreign = inst({ id: "foreign", organization_id: "org-2" });
    const out = await selectSendableInstance(instancesStub([foreign]), "org-1");
    expect(out).toBeNull();
  });

  it("treats Evolution 'open' as live too", async () => {
    const evo = inst({ id: "evo", provider: "evolution", status: "open" });
    const out = await selectSendableInstance(instancesStub([evo]), "org-1");
    expect(out?.id).toBe("evo");
  });
});
