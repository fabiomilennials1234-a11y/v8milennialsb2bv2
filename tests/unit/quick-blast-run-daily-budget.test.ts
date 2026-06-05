// @vitest-environment node
/**
 * runQuickBlast — Daily Blast Budget enforcement (ADR-0003, #706).
 *
 * Layers the Org-wide daily ceiling on top of the per-blast clamp. Same
 * dep-injection + Supabase-stub style as quick-blast-run.test.ts: an injected
 * `usageSource` is the day-ledger seam, so the budget logic is exercised without
 * a live DB.
 *
 * Asserts: remaining computed from the shared ledger; blast clamped to remaining;
 * a second blast the same day sees the reduced budget; dry-run never consumes
 * budget; fail-closed default when config missing; the ledger increments by the
 * actually-dispatched count; zero remaining rejects the blast.
 */

import { describe, it, expect, vi } from "vitest";

const { runQuickBlast } = await import(
  "../../supabase/functions/quick-blast-create/run.ts"
);

const INSTANCE = { id: "inst-1", organization_id: "org-1", provider: "uazapi" } as any;

/** Chainable Supabase stub — org-cap/daily-budget row for `organizations`,
 *  leads for `leads`, no upsell. `dailyBudget` drives daily_blast_budget. */
function supabaseStub(opts: {
  cap?: number | null;
  dailyBudget?: number | null;
  leads: any[];
}) {
  const calls: any = { leadsQuery: {} };
  const queryReturning = (rows: any[]) => {
    const q: any = {};
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { calls.leadsQuery[col] = val; return q; };
    q.in = (col: string, val: unknown) => { calls.leadsQuery[col] = val; return q; };
    q.then = (resolve: (v: any) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return {
    calls,
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  quick_blast_max_leads: opts.cap ?? null,
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
        return { insert: async (rows: any[]) => { calls.logRows = rows; return { error: null }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
}

const lead = (id: string, phone: string | null) => ({ id, name: `L${id}`, company: "Co", phone });
const leads = (n: number) =>
  Array.from({ length: n }, (_, i) => lead(String(i), `11999${String(i).padStart(6, "0")}`));

/** In-memory usage ledger seam — mirrors how the real source behaves. */
function usageStub(initialUsed = 0) {
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

const okDispatch = () =>
  vi.fn(async (_inst: any, input: any) => ({ sender_job_id: "j", uazapi_sender_id: "u", _n: input.recipients.length }));

describe("runQuickBlast — daily blast budget", () => {
  it("clamps a blast to the remaining daily budget (shared across blasts)", async () => {
    const dispatch = okDispatch();
    const supabase = supabaseStub({ cap: null, dailyBudget: 100, leads: leads(80) });
    const { source } = usageStub(70); // 70 already sent today → 30 remaining

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, usageSource: source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(80).map((l) => l.id), message: "Hi" },
    );

    expect(out.count).toBe(30);
    expect(out.skipped.overDailyBudget).toBe(50);
    expect(out.remaining).toBe(30);
    const passed = (dispatch.mock.calls[0][1] as any).recipients.length;
    expect(passed).toBe(30);
  });

  it("a second blast the same day sees the reduced (shared) budget", async () => {
    const usage = usageStub(0);
    const supabase = supabaseStub({ cap: null, dailyBudget: 100, leads: leads(60) });

    const first = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch: okDispatch(), usageSource: usage.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(60).map((l) => l.id), message: "Hi" },
    );
    expect(first.count).toBe(60);
    expect(usage.state.used).toBe(60); // ledger incremented by dispatched count

    const second = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch: okDispatch(), usageSource: usage.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(60).map((l) => l.id), message: "Hi" },
    );
    // only 40 budget left → second blast clamped to 40, rest over-budget.
    expect(second.count).toBe(40);
    expect(second.skipped.overDailyBudget).toBe(20);
    expect(usage.state.used).toBe(100);
  });

  it("rejects a blast when zero budget remains, without dispatching", async () => {
    const dispatch = okDispatch();
    const usage = usageStub(100); // budget fully consumed
    const supabase = supabaseStub({ cap: null, dailyBudget: 100, leads: leads(10) });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, usageSource: usage.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(10).map((l) => l.id), message: "Hi" },
    );

    expect(out.ok).toBe(false);
    expect(out.error).toBe("daily_budget_exhausted");
    expect(out.remaining).toBe(0);
    expect(out.skipped.overDailyBudget).toBe(10);
    expect(dispatch).not.toHaveBeenCalled();
    expect(usage.state.increments).toHaveLength(0);
  });

  it("increments the ledger by the actually-dispatched count (not the requested count)", async () => {
    const usage = usageStub(0);
    // 5 leads, but 2 have no phone → only 3 dispatched.
    const mixed = [
      lead("a", "11999990001"),
      lead("b", null),
      lead("c", "11999990003"),
      lead("d", ""),
      lead("e", "11999990005"),
    ];
    const supabase = supabaseStub({ cap: null, dailyBudget: 200, leads: mixed });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch: okDispatch(), usageSource: usage.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: mixed.map((l) => l.id), message: "Hi" },
    );

    expect(out.count).toBe(3);
    expect(usage.state.increments).toEqual([3]); // ledger += dispatched, not 5
    expect(usage.state.used).toBe(3);
  });

  it("dry-run reports the clamp + remaining WITHOUT consuming budget", async () => {
    const dispatch = okDispatch();
    const usage = usageStub(180); // 20 remaining
    const supabase = supabaseStub({ cap: null, dailyBudget: 200, leads: leads(50) });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, usageSource: usage.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(50).map((l) => l.id), message: "Hi", dryRun: true },
    );

    expect(out.ok).toBe(true);
    expect(out.count).toBe(20);
    expect(out.skipped.overDailyBudget).toBe(30);
    expect(out.remaining).toBe(20);
    expect(dispatch).not.toHaveBeenCalled();
    expect(usage.state.increments).toHaveLength(0); // preview never consumes
    expect(usage.state.used).toBe(180);
  });

  it("fails closed to the default ceiling when daily_blast_budget config is missing", async () => {
    const dispatch = okDispatch();
    const usage = usageStub(0);
    // config null → resolveDailyBudget → 200 (NOT unlimited).
    const supabase = supabaseStub({ cap: null, dailyBudget: null, leads: leads(250) });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, usageSource: usage.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(250).map((l) => l.id), message: "Hi" },
    );

    expect(out.count).toBe(200); // clamped to the default daily ceiling
    expect(out.skipped.overDailyBudget).toBe(50);
  });

  it("a per-blast max still clamps WITHIN the daily budget", async () => {
    const dispatch = okDispatch();
    const usage = usageStub(0);
    const supabase = supabaseStub({ cap: null, dailyBudget: 200, leads: leads(120) });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, usageSource: usage.source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(120).map((l) => l.id), message: "Hi", maxLeads: 50 },
    );

    // perBlastMax 50 is tighter than daily remaining 200 → 50 dispatched.
    expect(out.count).toBe(50);
    expect(usage.state.used).toBe(50);
  });

  it("fails closed (remaining 0) when the ledger read errors — never unlimited", async () => {
    const dispatch = okDispatch();
    const supabase = supabaseStub({ cap: null, dailyBudget: 200, leads: leads(10) });
    // Source that simulates a read failure resolving to "budget fully used".
    const source = {
      async getUsedToday(_org: string, _date: string, dailyBudget: number) { return dailyBudget; },
      async increment() { /* not reached */ },
    };

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, usageSource: source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(10).map((l) => l.id), message: "Hi" },
    );

    expect(out.ok).toBe(false);
    expect(out.error).toBe("daily_budget_exhausted");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("defaults overDailyBudget to zero when nothing is clipped by the budget", async () => {
    const out = await runQuickBlast(
      { supabaseAdmin: supabaseStub({ cap: null, dailyBudget: 200, leads: leads(3) }), dispatch: okDispatch(), usageSource: usageStub(0).source },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads(3).map((l) => l.id), message: "Hi" },
    );
    expect(out.skipped.overDailyBudget).toBe(0);
    // `remaining` is the budget available to this blast BEFORE it consumed —
    // 200 - 0 used. The wizard reads it as "today's headroom".
    expect(out.remaining).toBe(200);
  });
});
