/**
 * meta-cloud-window — the 24h customer-service window guard (Meta-ONLY, Rule 6).
 *
 * Verifies the open/closed verdict against the last inbound message, and the
 * fail-safe (no row → closed). The query shape is asserted so a schema rename
 * can't silently re-open the window.
 */

import { describe, it, expect, vi } from "vitest";
import { isSessionOpen } from "../../supabase/functions/_shared/whatsapp-providers/meta-cloud-window.ts";

const INSTANCE = "inst-1";
const PHONE = "5511999998888";

/** A query-builder mock that records the chained filters and returns one row. */
function makeAdmin(row: { timestamp: string } | null, error: unknown = null) {
  const calls: Record<string, unknown> = {};
  const api: Record<string, unknown> = {
    select(sel: string) {
      calls.select = sel;
      return api;
    },
    eq(col: string, val: unknown) {
      calls[`eq:${col}`] = val;
      return api;
    },
    order(col: string, opts: unknown) {
      calls.order = { col, opts };
      return api;
    },
    limit(n: number) {
      calls.limit = n;
      return api;
    },
    maybeSingle() {
      return Promise.resolve({ data: row, error });
    },
  };
  return {
    from(table: string) {
      calls.table = table;
      return api;
    },
    __calls: calls,
  };
}

describe("isSessionOpen", () => {
  it("queries the latest incoming row for (instance, phone) by timestamp desc", async () => {
    const now = Date.parse("2026-06-18T12:00:00Z");
    const admin = makeAdmin({ timestamp: "2026-06-18T11:00:00Z" });

    await isSessionOpen(admin as never, INSTANCE, PHONE, now);

    expect(admin.__calls.table).toBe("whatsapp_messages");
    expect(admin.__calls["eq:instance_id"]).toBe(INSTANCE);
    expect(admin.__calls["eq:phone_number"]).toBe(PHONE);
    expect(admin.__calls["eq:direction"]).toBe("incoming");
    expect(admin.__calls.order).toEqual({ col: "timestamp", opts: { ascending: false } });
    expect(admin.__calls.limit).toBe(1);
  });

  it("OPEN when the last inbound is younger than 24h", async () => {
    const now = Date.parse("2026-06-18T12:00:00Z");
    const admin = makeAdmin({ timestamp: "2026-06-18T11:00:00Z" }); // 1h ago

    const r = await isSessionOpen(admin as never, INSTANCE, PHONE, now);
    expect(r.open).toBe(true);
    expect(r.lastInboundAt).toBe("2026-06-18T11:00:00Z");
  });

  it("CLOSED when the last inbound is older than 24h", async () => {
    const now = Date.parse("2026-06-18T12:00:00Z");
    const admin = makeAdmin({ timestamp: "2026-06-16T11:00:00Z" }); // ~49h ago

    const r = await isSessionOpen(admin as never, INSTANCE, PHONE, now);
    expect(r.open).toBe(false);
    expect(r.lastInboundAt).toBe("2026-06-16T11:00:00Z");
  });

  it("CLOSED exactly at the 24h boundary (strict <)", async () => {
    const now = Date.parse("2026-06-18T12:00:00Z");
    const admin = makeAdmin({ timestamp: "2026-06-17T12:00:00Z" }); // exactly 24h

    const r = await isSessionOpen(admin as never, INSTANCE, PHONE, now);
    expect(r.open).toBe(false);
  });

  it("CLOSED (fail-safe) when there is no incoming row", async () => {
    const admin = makeAdmin(null);
    const r = await isSessionOpen(admin as never, INSTANCE, PHONE, Date.now());
    expect(r.open).toBe(false);
    expect(r.lastInboundAt).toBeNull();
  });

  it("CLOSED (fail-safe) on a query error", async () => {
    const admin = makeAdmin(null, { message: "boom" });
    const r = await isSessionOpen(admin as never, INSTANCE, PHONE, Date.now());
    expect(r.open).toBe(false);
  });

  it("CLOSED (fail-safe) on an unparseable timestamp", async () => {
    const admin = makeAdmin({ timestamp: "not-a-date" });
    const r = await isSessionOpen(admin as never, INSTANCE, PHONE, Date.now());
    expect(r.open).toBe(false);
  });
});
