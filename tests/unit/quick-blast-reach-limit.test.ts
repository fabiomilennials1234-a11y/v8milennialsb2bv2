// @vitest-environment node
/**
 * runQuickBlast — WhatsApp reach-allowance gate (#1168).
 *
 * The gate asks the provider what WhatsApp reports about the sending number's
 * reach ceiling, and refuses the blast when that ceiling is clearly reached.
 *
 * Same dep-injection + Supabase-stub style as quick-blast-instance-cap.test.ts,
 * plus the injected `reachLimitSource` seam.
 *
 * Asserts: refusal at the ceiling; fail-OPEN on unknown/error (the inverse of
 * the ledger guards); the gate runs last, so it never fires for an audience the
 * local ledgers already rejected; and the raw reading bubbles up for logging.
 */

import { describe, it, expect, vi } from "vitest";

const { runQuickBlast } = await import(
  "../../supabase/functions/quick-blast-create/run.ts"
);

const INSTANCE = {
  id: "inst-1",
  organization_id: "org-1",
  provider: "uazapi",
  daily_blast_cap: 80,
} as any;

function supabaseStub(opts: { dailyBudget?: number | null; leads: any[] }) {
  const queryReturning = (rows: any[]) => {
    const q: any = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.then = (resolve: (v: any) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  quick_blast_max_leads: null,
                  daily_blast_budget: opts.dailyBudget ?? null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "leads") return queryReturning(opts.leads);
      if (table === "upsell_clients") return queryReturning([]);
      if (table === "channel_messages") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
}

const lead = (id: string, phone: string | null) => ({ id, name: `L${id}`, company: "Co", phone });
const leads = (n: number) =>
  Array.from({ length: n }, (_, i) => lead(String(i), `11999${String(i).padStart(6, "0")}`));

function orgUsageStub(initialUsed = 0) {
  const state = { used: initialUsed, increments: [] as number[] };
  return {
    state,
    source: {
      async getUsedToday() { return state.used; },
      async increment(_org: string, _date: string, count: number) {
        state.used += count;
        state.increments.push(count);
      },
    },
  };
}

function instanceUsageStub(initialUsed = 0) {
  const state = { used: initialUsed, increments: [] as Array<{ instanceId: string; count: number }> };
  return {
    state,
    source: {
      async getUsedToday() { return state.used; },
      async increment(instanceId: string, _date: string, count: number) {
        state.used += count;
        state.increments.push({ instanceId, count });
      },
    },
  };
}

/** Reach-allowance seam. `reading` may be a value, null (unknown), or a thrower. */
function reachStub(reading: unknown) {
  const state = { calls: [] as string[] };
  return {
    state,
    source: {
      async get(instanceId: string) {
        state.calls.push(instanceId);
        if (typeof reading === "function") return (reading as () => any)();
        return reading as any;
      },
    },
  };
}

const okDispatch = () =>
  vi.fn(async () => ({ sender_job_id: "job-1", uazapi_sender_id: "uaz-1" }));

function run(extra: Record<string, unknown>, leadCount = 10) {
  const rows = leads(leadCount);
  return runQuickBlast(
    {
      supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: rows }),
      usageSource: orgUsageStub(0).source,
      instanceUsageSource: instanceUsageStub(0).source,
      ...extra,
    } as any,
    {
      orgId: "org-1",
      userId: "u",
      instance: INSTANCE,
      leadIds: rows.map((l) => l.id),
      message: "Hi",
    } as any,
  );
}

describe("runQuickBlast — WhatsApp reach allowance (#1168)", () => {
  it("refuses the blast when the account is at its reach ceiling", async () => {
    const dispatch = okDispatch();
    const reach = reachStub({ current: 80, limit: 80 });

    const out = await run({ dispatch, reachLimitSource: reach.source });

    expect(out.ok).toBe(false);
    expect(out.error).toBe("wa_reach_limit_reached");
    expect(out.count).toBe(0);
    // Nothing may leave — refusing after dispatch would defeat the point.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("bubbles the raw reading up so the caller can log it for calibration", async () => {
    const reading = { current: 80, limit: 80, reachout_timelock: 1_700_000_000 };
    const out = await run({
      dispatch: okDispatch(),
      reachLimitSource: reachStub(reading).source,
    });

    expect(out.reachLimit).toEqual(reading);
  });

  it("lets the blast through with headroom, and still reports the reading", async () => {
    const dispatch = okDispatch();
    const out = await run({
      dispatch,
      reachLimitSource: reachStub({ current: 10, limit: 80 }).source,
    });

    expect(out.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(out.reachLimit).toEqual({ current: 10, limit: 80 });
  });

  // --- fail-OPEN ------------------------------------------------------------
  // Inverse of the ledger guards on purpose. Those read our own accounting;
  // this reads the provider's opinion over the network. Not knowing it must
  // never refuse a send the user is entitled to make.

  it("sends when the reading is unknown", async () => {
    const dispatch = okDispatch();
    const out = await run({ dispatch, reachLimitSource: reachStub(null).source });

    expect(out.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("sends when the provider read throws", async () => {
    const dispatch = okDispatch();
    const thrower = reachStub(() => {
      throw new Error("provider down");
    });

    const out = await run({ dispatch, reachLimitSource: thrower.source });

    expect(out.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("sends when no reach source is injected at all — the gate is opt-in", async () => {
    const dispatch = okDispatch();
    const out = await run({ dispatch });

    expect(out.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  // --- ordering -------------------------------------------------------------

  it("does not consult the provider when the local ledgers already refuse", async () => {
    // The reach read is a network call. Spending it to refuse something the
    // org budget already refused is pure waste, and worse, it is provider
    // traffic generated by a blast that never happens.
    const reach = reachStub({ current: 0, limit: 80 });
    const out = await runQuickBlast(
      {
        supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: leads(10) }),
        dispatch: okDispatch(),
        usageSource: orgUsageStub(200).source, // budget fully consumed
        instanceUsageSource: instanceUsageStub(0).source,
        reachLimitSource: reach.source,
      } as any,
      {
        orgId: "org-1",
        userId: "u",
        instance: INSTANCE,
        leadIds: leads(10).map((l) => l.id),
        message: "Hi",
      } as any,
    );

    expect(out.error).toBe("daily_budget_exhausted");
    expect(reach.state.calls).toHaveLength(0);
  });

  it("does not consult the provider on a dry run", async () => {
    // A preview must not generate provider traffic, exactly as it must not
    // consume budget.
    const reach = reachStub({ current: 0, limit: 80 });
    const rows = leads(10);
    const out = await runQuickBlast(
      {
        supabaseAdmin: supabaseStub({ dailyBudget: 200, leads: rows }),
        dispatch: okDispatch(),
        usageSource: orgUsageStub(0).source,
        instanceUsageSource: instanceUsageStub(0).source,
        reachLimitSource: reach.source,
      } as any,
      {
        orgId: "org-1",
        userId: "u",
        instance: INSTANCE,
        leadIds: rows.map((l) => l.id),
        message: "Hi",
        dryRun: true,
      } as any,
    );

    expect(out.ok).toBe(true);
    expect(reach.state.calls).toHaveLength(0);
  });

  it("consults the provider once, for the sending number", async () => {
    const reach = reachStub({ current: 10, limit: 80 });
    await run({ dispatch: okDispatch(), reachLimitSource: reach.source });

    expect(reach.state.calls).toEqual(["inst-1"]);
  });
});
