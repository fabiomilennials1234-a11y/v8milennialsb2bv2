// @vitest-environment node
/**
 * runQuickBlast — Quick Blast orchestration (Module D core).
 *
 * Integration-style: real org-cap + recipient-builder modules, mocked Supabase
 * reads and an injected dispatch fn (so no provider/network). Asserts the
 * end-to-end policy: any member may fire (no role gate), recipients are scoped
 * to the caller's org, the org cap clamps volume, and a job is created.
 */

import { describe, it, expect, vi } from "vitest";

const { runQuickBlast } = await import(
  "../../supabase/functions/quick-blast-create/run.ts"
);

const INSTANCE = { id: "inst-1", organization_id: "org-1", provider: "uazapi" } as any;

/** Chainable Supabase stub. Returns org-cap + daily-budget row for
 *  `organizations`, the provided leads for `leads` (only those matching the org
 *  filter), and a `blast_daily_usage` ledger (#706, ADR-0003) defaulting to zero
 *  usage with a generous daily budget so the per-blast assertions below are not
 *  clipped by the daily ceiling. `rpc` models the atomic increment. */
function supabaseStub(opts: { cap?: number | null; leads: any[]; upsell?: any[]; dailyBudget?: number | null; usedToday?: number }) {
  const calls: any = { leadsQuery: {}, increments: [] as number[] };
  const queryReturning = (rows: any[]) => {
    const q: any = {};
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { calls.leadsQuery[col] = val; return q; };
    q.in = (col: string, val: unknown) => { calls.leadsQuery[col] = val; return q; };
    q.then = (resolve: (v: any) => void) => resolve({ data: rows, error: null });
    return q;
  };
  // Default to a budget large enough that the daily ceiling never clips the
  // per-blast tests (which assert org-cap behavior). Individual tests can lower it.
  const dailyBudget = opts.dailyBudget !== undefined ? opts.dailyBudget : 100000;
  const usedToday = opts.usedToday ?? 0;
  return {
    calls,
    rpc: async (fn: string, args: any) => {
      if (fn === "increment_blast_daily_usage") {
        calls.increments.push(args?.p_count);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { quick_blast_max_leads: opts.cap ?? null, daily_blast_budget: dailyBudget },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "blast_daily_usage") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { leads_sent: usedToday }, error: null }) }),
            }),
          }),
        };
      }
      if (table === "leads") return queryReturning(opts.leads);
      if (table === "upsell_clients") return queryReturning(opts.upsell ?? []);
      if (table === "channel_messages") {
        return { insert: async (rows: any[]) => { calls.logRows = rows; return { error: null }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
}

const lead = (id: string, phone: string | null) => ({ id, name: `L${id}`, company: "Co", phone });

describe("runQuickBlast", () => {
  it("fires for a member with no role check, returning the job id and count", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "job-1", uazapi_sender_id: "uz-1" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001"), lead("b", "11999990002")] });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "user-1", instance: INSTANCE, leadIds: ["a", "b"], message: "Promo!" },
    );

    expect(out.ok).toBe(true);
    expect(out.sender_job_id).toBe("job-1");
    expect(out.count).toBe(2);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("scopes the lead fetch to the caller's organization", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "job-1", uazapi_sender_id: "uz-1" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001")] });

    await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "user-1", instance: INSTANCE, leadIds: ["a", "foreign"], message: "Hi" },
    );

    expect(supabase.calls.leadsQuery.organization_id).toBe("org-1");
    expect(supabase.calls.leadsQuery.id).toEqual(["a", "foreign"]);
  });

  it("clamps to the org cap when max_leads exceeds it", async () => {
    const dispatch = vi.fn(async (_inst: any, input: any) => ({ sender_job_id: "j", uazapi_sender_id: "u", _n: input.recipients.length }));
    const leads = Array.from({ length: 250 }, (_, i) => lead(String(i), `11999${String(i).padStart(6, "0")}`));
    const supabase = supabaseStub({ cap: 200, leads });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: leads.map((l) => l.id), message: "Hi", maxLeads: 1000 },
    );

    expect(out.count).toBe(200);
    expect(out.skipped.overCap).toBe(50);
    const passed = (dispatch.mock.calls[0][1] as any).recipients.length;
    expect(passed).toBe(200);
  });

  it("does not dispatch when no recipient has a valid phone", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "j", uazapi_sender_id: "u" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", null), lead("b", "")] });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: ["a", "b"], message: "Hi" },
    );

    expect(out.ok).toBe(false);
    expect(out.count).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("merges carteira data so portfolio variables resolve per recipient", async () => {
    let sentText = "";
    const dispatch = vi.fn(async (_inst: any, input: any) => {
      sentText = input.recipients[0].text;
      return { sender_job_id: "j", uazapi_sender_id: "u" };
    });
    const supabase = supabaseStub({
      cap: 200,
      leads: [lead("a", "11999990001")],
      upsell: [{ lead_id: "a", segment: "ouro", avg_ticket: 1500, days_since_last_order: 30, lifetime_value: 9000 }],
    });

    await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: ["a"], message: "Seg {segmento}, {dias_sem_pedido} dias" },
    );

    expect(sentText).toBe("Seg ouro, 30 dias");
  });

  it("forwards an image blast to dispatch with file + caption per recipient", async () => {
    let recipient: any;
    const dispatch = vi.fn(async (_inst: any, input: any) => {
      recipient = input.recipients[0];
      return { sender_job_id: "j", uazapi_sender_id: "u" };
    });
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001")] });

    await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: ["a"], message: "Promo", imageUrl: "https://cdn/x.jpg" },
    );

    expect(recipient.type).toBe("image");
    expect(recipient.file).toBe("https://cdn/x.jpg");
    expect(recipient.caption).toBe("Promo");
  });

  it("logs one outbound channel_messages row per dispatched recipient", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "job-9", uazapi_sender_id: "uz" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001"), lead("b", "11999990002")] });

    await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "user-1", instance: INSTANCE, leadIds: ["a", "b"], message: "Oi" },
    );

    expect(supabase.calls.logRows).toHaveLength(2);
    expect(supabase.calls.logRows[0]).toMatchObject({
      organization_id: "org-1",
      lead_id: "a",
      direction: "outbound",
      channel: "whatsapp",
    });
    expect(supabase.calls.logRows[0].metadata).toMatchObject({ source: "quick_blast", sender_job_id: "job-9" });
  });

  it("forwards an optional scheduledFor to dispatch", async () => {
    let input: any;
    const dispatch = vi.fn(async (_inst: any, i: any) => { input = i; return { sender_job_id: "j", uazapi_sender_id: "u" }; });
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001")] });

    await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: ["a"], message: "Oi", scheduledFor: "2026-06-01T09:00:00.000Z" },
    );

    expect(input.scheduledFor).toBe("2026-06-01T09:00:00.000Z");
  });

  it("rejects when the instance belongs to another organization", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "j", uazapi_sender_id: "u" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001")] });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "u", instance: { ...INSTANCE, organization_id: "org-2" }, leadIds: ["a"], message: "Hi" },
    );

    expect(out.ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("defaults the new skip counts to zero when no refinements are passed", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "j", uazapi_sender_id: "u" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001")] });

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: ["a"], message: "Hi" },
    );

    expect(out.skipped).toMatchObject({ alreadyContactedWithinWindow: 0, replied: 0 });
  });

  it("honors a contact-recency refinement, excluding a recently-blasted lead before dispatch", async () => {
    let recipients: any[] = [];
    const dispatch = vi.fn(async (_inst: any, input: any) => {
      recipients = input.recipients;
      return { sender_job_id: "j", uazapi_sender_id: "u" };
    });
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001"), lead("b", "11999990002")] });
    // a was blasted recently → refinement drops it; b is kept.
    const activitySource = {
      async getLeadActivity() {
        return new Map([
          ["a", { lastOutgoingAt: new Date("2026-06-04T00:00:00Z"), lastIncomingAt: null }],
          ["b", { lastOutgoingAt: null, lastIncomingAt: null }],
        ]);
      },
    };

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, activitySource },
      {
        orgId: "org-1",
        userId: "u",
        instance: INSTANCE,
        leadIds: ["a", "b"],
        message: "Hi",
        refinements: { excludeBlastedWithinDays: 7 },
      },
    );

    expect(out.ok).toBe(true);
    expect(out.count).toBe(1);
    // dispatch recipients carry the normalized number (leadId is stripped at
    // the dispatch boundary); 11999990002 → 5511999990002 is lead b.
    expect(recipients.map((r) => r.number)).toEqual(["5511999990002"]);
    expect(out.skipped.alreadyContactedWithinWindow).toBe(1);
    expect(out.skipped.replied).toBe(0);
  });

  it("honors a non-responder refinement, keeping only leads silent since their last blast", async () => {
    let recipients: any[] = [];
    const dispatch = vi.fn(async (_inst: any, input: any) => {
      recipients = input.recipients;
      return { sender_job_id: "j", uazapi_sender_id: "u" };
    });
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001"), lead("b", "11999990002")] });
    // a replied after its last send → excluded. b silent since last send → kept.
    const activitySource = {
      async getLeadActivity() {
        return new Map([
          ["a", { lastOutgoingAt: new Date("2026-05-01T10:00:00Z"), lastIncomingAt: new Date("2026-05-01T11:00:00Z") }],
          ["b", { lastOutgoingAt: new Date("2026-05-01T10:00:00Z"), lastIncomingAt: null }],
        ]);
      },
    };

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, activitySource },
      {
        orgId: "org-1",
        userId: "u",
        instance: INSTANCE,
        leadIds: ["a", "b"],
        message: "Hi",
        refinements: { onlyNonResponders: true },
      },
    );

    expect(out.count).toBe(1);
    expect(recipients.map((r) => r.number)).toEqual(["5511999990002"]);
    expect(out.skipped.replied).toBe(1);
  });

  it("does not query the activity source when no refinement is requested", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "j", uazapi_sender_id: "u" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001")] });
    const getLeadActivity = vi.fn(async () => new Map());

    await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, activitySource: { getLeadActivity } },
      { orgId: "org-1", userId: "u", instance: INSTANCE, leadIds: ["a"], message: "Hi" },
    );

    expect(getLeadActivity).not.toHaveBeenCalled();
  });

  it("returns no_recipients with refinement skips when a refinement empties the set", async () => {
    const dispatch = vi.fn(async () => ({ sender_job_id: "j", uazapi_sender_id: "u" }));
    const supabase = supabaseStub({ cap: 200, leads: [lead("a", "11999990001")] });
    const activitySource = {
      async getLeadActivity() {
        return new Map([["a", { lastOutgoingAt: new Date("2026-06-04T00:00:00Z"), lastIncomingAt: null }]]);
      },
    };

    const out = await runQuickBlast(
      { supabaseAdmin: supabase, dispatch, activitySource },
      {
        orgId: "org-1",
        userId: "u",
        instance: INSTANCE,
        leadIds: ["a"],
        message: "Hi",
        refinements: { excludeBlastedWithinDays: 7 },
      },
    );

    expect(out.ok).toBe(false);
    expect(out.error).toBe("no_recipients");
    expect(out.skipped.alreadyContactedWithinWindow).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
