// @vitest-environment node
/**
 * Blast Plan post-send move — the `onRecipientsSent` hook (wizard "Destino").
 *
 * The core invokes the injected hook with the lead ids just marked "sent",
 * after EVERY sent-marking site: lot 0 at creation (single-number and
 * multi-number) and the daily releaser (multi-number and legacy paths).
 * Skipped (refined-away) and deferred (budget-pressured) recipients NEVER
 * reach the hook. The hook is BEST-EFFORT: a throwing hook is logged and
 * swallowed — the send/release result is unaffected.
 *
 * Also covers the pure shape validation of the post_send_target payload
 * (parsePostSendTarget — the fail-closed contract used by blast-plan-create).
 *
 * Same dep-injection + in-memory stub style as blast-plan.test.ts /
 * blast-plan-multinumber.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

const { createBlastPlan, releaseBlastPlanLot } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-plan.ts"
);
const { parsePostSendTarget } = await import(
  "../../supabase/functions/_shared/quick-blast/post-send-target.ts"
);

const INSTANCE = { id: "inst-1", organization_id: "org-1", provider: "uazapi" } as any;
const numA = { id: "a", organization_id: "org-1", provider: "uazapi" } as any;
const numB = { id: "b", organization_id: "org-1", provider: "uazapi" } as any;

const lead = (id: string) => ({ id, name: `L${id}`, company: "Co", phone: `1199900${id.padStart(4, "0")}` });
const leads = (n: number) => Array.from({ length: n }, (_, i) => lead(String(i)));

function planStore() {
  const state = { plans: new Map<string, any>(), recipients: [] as any[], seq: 0 };
  return {
    state,
    store: {
      async insertPlan(row: any) {
        const id = `plan-${++state.seq}`;
        state.plans.set(id, { id, ...row });
        return id;
      },
      async insertRecipients(rows: any[]) {
        for (const r of rows) state.recipients.push({ ...r });
      },
      async getPlan(planId: string) {
        return state.plans.get(planId) ?? null;
      },
      async updatePlan(planId: string, patch: any) {
        const p = state.plans.get(planId);
        if (p) state.plans.set(planId, { ...p, ...patch });
      },
      async getLotRecipients(planId: string, lotIndex: number) {
        return state.recipients.filter((r) => r.plan_id === planId && r.lot_index === lotIndex);
      },
      async markRecipients(planId: string, leadIds: string[], status: string, reason: string | null) {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) {
            r.status = status;
            r.reason = reason;
          }
        }
      },
      async moveRecipientsToLot(planId: string, leadIds: string[], lotIndex: number) {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) r.lot_index = lotIndex;
        }
      },
      async listActivePlansDue(today: string) {
        return [...state.plans.values()].filter((p) => p.status === "active" && p.next_release_date <= today);
      },
    },
  };
}

function usageStub() {
  const state = { byDate: new Map<string, number>() };
  return {
    state,
    source: {
      async getUsedToday(_org: string, date: string) {
        return state.byDate.get(date) ?? 0;
      },
      async increment(_org: string, date: string, count: number) {
        state.byDate.set(date, (state.byDate.get(date) ?? 0) + count);
      },
    },
  };
}

function instanceUsageStub() {
  const state = { byKey: new Map<string, number>() };
  return {
    state,
    source: {
      async getUsedToday(instanceId: string, date: string) {
        return state.byKey.get(`${instanceId}|${date}`) ?? 0;
      },
      async increment(instanceId: string, date: string, count: number) {
        const key = `${instanceId}|${date}`;
        state.byKey.set(key, (state.byKey.get(key) ?? 0) + count);
      },
    },
  };
}

/** Refinement activity source — per-lead last outgoing/incoming. */
function activity(map: Record<string, { out?: string; in?: string }> = {}) {
  return {
    async getLeadActivity(_org: string, ids: string[]) {
      const out = new Map<string, { lastOutgoingAt: Date | null; lastIncomingAt: Date | null }>();
      for (const id of ids) {
        const a = map[id];
        out.set(id, {
          lastOutgoingAt: a?.out ? new Date(a.out) : null,
          lastIncomingAt: a?.in ? new Date(a.in) : null,
        });
      }
      return out;
    },
  };
}

const okDispatch = () =>
  vi.fn(async (_inst: any, input: any) => ({ sender_job_id: "j", uazapi_sender_id: "u", _n: input.recipients.length }));

const NOW = new Date("2026-06-05T12:00:00.000Z"); // BRT 2026-06-05

/** All lead ids the hook saw, across every invocation. */
const seenIds = (hook: ReturnType<typeof vi.fn>) => hook.mock.calls.flatMap((c) => c[0] as string[]);

describe("onRecipientsSent — createBlastPlan (single-number, lot 0)", () => {
  const baseParams = (overrides: any = {}) => ({
    orgId: "org-1",
    userId: "user-1",
    instance: INSTANCE,
    leads: leads(5),
    message: "Olá {primeiro_nome}",
    refinements: {},
    dailyBudget: 200,
    now: NOW,
    ...overrides,
  });

  it("invokes the hook with exactly the lot-0 lead ids marked sent", async () => {
    const { store, state } = planStore();
    const hook = vi.fn(async () => {});

    const out = await createBlastPlan(
      { store, usageSource: usageStub().source, dispatch: okDispatch(), onRecipientsSent: hook },
      baseParams(),
    );

    expect(out.ok).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(seenIds(hook).sort()).toEqual(["0", "1", "2", "3", "4"]);
    // hook fired only for rows actually marked sent
    const sent = state.recipients.filter((r) => r.status === "sent").map((r) => r.lead_id);
    expect(seenIds(hook).sort()).toEqual(sent.sort());
  });

  it("budget-deferred leads never reach the hook", async () => {
    const { store } = planStore();
    const usage = usageStub();
    usage.state.byDate.set("2026-06-05", 197); // only 3 of 200 left today
    const hook = vi.fn(async () => {});

    await createBlastPlan(
      { store, usageSource: usage.source, dispatch: okDispatch(), onRecipientsSent: hook },
      baseParams({ leads: leads(5) }),
    );

    expect(hook).toHaveBeenCalledTimes(1);
    expect(seenIds(hook)).toHaveLength(3); // 2 deferred to tomorrow — not moved
  });

  it("is not invoked when nothing dispatches today (budget exhausted)", async () => {
    const { store } = planStore();
    const usage = usageStub();
    usage.state.byDate.set("2026-06-05", 200);
    const hook = vi.fn(async () => {});

    await createBlastPlan(
      { store, usageSource: usage.source, dispatch: okDispatch(), onRecipientsSent: hook },
      baseParams(),
    );
    expect(hook).not.toHaveBeenCalled();
  });

  it("a throwing hook never fails the creation (best-effort)", async () => {
    const { store, state } = planStore();
    const hook = vi.fn(async () => {
      throw new Error("move exploded");
    });

    const out = await createBlastPlan(
      { store, usageSource: usageStub().source, dispatch: okDispatch(), onRecipientsSent: hook },
      baseParams(),
    );

    expect(out.ok).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    // sends are unaffected: everything still marked sent
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(5);
  });
});

describe("onRecipientsSent — createBlastPlan (multi-number, lot 0)", () => {
  const baseParams = (overrides: any = {}) => ({
    orgId: "org-1",
    userId: "user-1",
    numbers: [
      { instance: numA, cap: 3 },
      { instance: numB, cap: 3 },
    ],
    leads: leads(6),
    message: "Olá {primeiro_nome}",
    refinements: {},
    dailyBudget: 200,
    now: NOW,
    ...overrides,
  });

  it("invokes the hook per sending number, covering every lot-0 lead sent", async () => {
    const { store, state } = planStore();
    const hook = vi.fn(async () => {});

    const out = await createBlastPlan(
      {
        store,
        usageSource: usageStub().source,
        instanceUsageSource: instanceUsageStub().source,
        dispatch: okDispatch(),
        onRecipientsSent: hook,
      },
      baseParams(),
    );

    expect(out.ok).toBe(true);
    // one hook call per number that dispatched (A and B)
    expect(hook).toHaveBeenCalledTimes(2);
    const sent = state.recipients.filter((r) => r.status === "sent").map((r) => r.lead_id);
    expect(seenIds(hook).sort()).toEqual(sent.sort());
    expect(seenIds(hook).sort()).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("per-number cap-deferred leads never reach the hook", async () => {
    const { store, state } = planStore();
    const instUsage = instanceUsageStub();
    instUsage.state.byKey.set("a|2026-06-05", 2); // number A: only 1 of 3 left
    const hook = vi.fn(async () => {});

    await createBlastPlan(
      {
        store,
        usageSource: usageStub().source,
        instanceUsageSource: instUsage.source,
        dispatch: okDispatch(),
        onRecipientsSent: hook,
      },
      baseParams(),
    );

    const sent = state.recipients.filter((r) => r.status === "sent").map((r) => r.lead_id);
    expect(seenIds(hook).sort()).toEqual(sent.sort()); // exactly the sent set
    const pendingCount = state.recipients.filter((r) => r.status === "pending").length;
    expect(pendingCount).toBeGreaterThan(0); // something deferred
    expect(seenIds(hook)).toHaveLength(6 - pendingCount);
  });
});

describe("onRecipientsSent — releaseBlastPlanLot", () => {
  async function seedPlan(
    store: any,
    opts: {
      lot1: any[];
      lotsTotal?: number;
      instanceStamp?: (leadId: string) => string | null;
      refinements?: Record<string, unknown>;
    },
  ) {
    const planId = await store.insertPlan({
      organization_id: "org-1",
      instance_id: "inst-1",
      status: "active",
      message: "Olá {primeiro_nome}",
      refinements: opts.refinements ?? {},
      image_url: null,
      delay_min_ms: null,
      delay_max_ms: null,
      total_recipients: opts.lot1.length,
      lots_total: opts.lotsTotal ?? 2,
      lots_released: 1,
      next_release_date: "2026-06-06",
      instance: INSTANCE,
    });
    await store.insertRecipients(
      opts.lot1.map((l: any) => ({
        plan_id: planId,
        lead_id: l.id,
        phone: l.phone,
        variable_snapshot: { primeiro_nome: l.name },
        lot_index: 1,
        instance_id: opts.instanceStamp ? opts.instanceStamp(l.id) : null,
        status: "pending",
        reason: null,
      })),
    );
    return planId;
  }

  const RELEASE_NOW = new Date("2026-06-06T12:00:00Z");

  it("legacy single-number release: hook receives the sent ids only (deferred excluded)", async () => {
    const { store, state } = planStore();
    const usage = usageStub();
    usage.state.byDate.set("2026-06-06", 198); // only 2 of 200 left
    const hook = vi.fn(async () => {});
    const planId = await seedPlan(store, { lot1: leads(5) });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usage.source, dispatch: okDispatch(), activitySource: activity(), onRecipientsSent: hook },
      { planId, dailyBudget: 200, now: RELEASE_NOW },
    );

    expect(out.ok).toBe(true);
    expect(out.sent).toBe(2);
    expect(out.deferred).toBe(3);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(seenIds(hook)).toHaveLength(2);
    const sent = state.recipients.filter((r) => r.status === "sent").map((r) => r.lead_id);
    expect(seenIds(hook).sort()).toEqual(sent.sort());
  });

  it("refined-away (skipped) recipients never reach the hook", async () => {
    const { store, state } = planStore();
    const hook = vi.fn(async () => {});
    const planId = await seedPlan(store, {
      lot1: leads(3),
      refinements: { onlyNonResponders: true },
    });
    // leads 0 and 1 replied → skipped; only lead 2 survives.
    const act = activity({
      "0": { out: "2026-06-01T10:00:00Z", in: "2026-06-01T11:00:00Z" },
      "1": { out: "2026-06-01T10:00:00Z", in: "2026-06-01T11:00:00Z" },
    });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usageStub().source, dispatch: okDispatch(), activitySource: act, onRecipientsSent: hook },
      { planId, dailyBudget: 200, now: RELEASE_NOW },
    );

    expect(out.skippedReplied).toBe(2);
    expect(seenIds(hook)).toEqual(["2"]);
    expect(state.recipients.filter((r) => r.status === "skipped")).toHaveLength(2);
  });

  it("multi-number release: hook fires per number group with that group's sent ids", async () => {
    const { store, state } = planStore();
    const hook = vi.fn(async () => {});
    // 4 recipients: 2 stamped to inst-1 (primary), 2 to number b.
    const planId = await seedPlan(store, {
      lot1: leads(4),
      instanceStamp: (id) => (Number(id) < 2 ? "inst-1" : "b"),
    });
    const instanceResolver = async (instanceId: string) =>
      instanceId === "b"
        ? { id: "b", organization_id: "org-1", provider: "uazapi", daily_blast_cap: 80 }
        : { ...INSTANCE, daily_blast_cap: 80 };

    const out = await releaseBlastPlanLot(
      {
        store,
        usageSource: usageStub().source,
        instanceUsageSource: instanceUsageStub().source,
        dispatch: okDispatch(),
        activitySource: activity(),
        instanceResolver,
        onRecipientsSent: hook,
      },
      { planId, dailyBudget: 200, now: RELEASE_NOW },
    );

    expect(out.sent).toBe(4);
    expect(hook).toHaveBeenCalledTimes(2); // one call per number group
    expect(seenIds(hook).sort()).toEqual(["0", "1", "2", "3"]);
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(4);
  });

  it("a throwing hook never fails the release (best-effort)", async () => {
    const { store, state } = planStore();
    const hook = vi.fn(async () => {
      throw new Error("move exploded");
    });
    const planId = await seedPlan(store, { lot1: leads(3) });

    const out = await releaseBlastPlanLot(
      { store, usageSource: usageStub().source, dispatch: okDispatch(), activitySource: activity(), onRecipientsSent: hook },
      { planId, dailyBudget: 200, now: RELEASE_NOW },
    );

    expect(out.ok).toBe(true);
    expect(out.sent).toBe(3);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(3);
  });

  it("without the hook injected, release behaves exactly as before", async () => {
    const { store } = planStore();
    const planId = await seedPlan(store, { lot1: leads(3) });
    const out = await releaseBlastPlanLot(
      { store, usageSource: usageStub().source, dispatch: okDispatch(), activitySource: activity() },
      { planId, dailyBudget: 200, now: RELEASE_NOW },
    );
    expect(out.ok).toBe(true);
    expect(out.sent).toBe(3);
  });
});

describe("parsePostSendTarget — fail-closed shape validation + normalization", () => {
  const CUSTOM_ID = "3f2b8c1a-1111-4222-8333-444455556666";
  const STAGE_ID = "9a8b7c6d-1111-4222-8333-444455556666";

  it("normalizes the CANONICAL shape (pipelineId + stageId) — Fatia B", () => {
    const out = parsePostSendTarget({
      pipelineId: CUSTOM_ID,
      stageId: STAGE_ID,
      label: "Reativação · Dia 2",
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.target).toEqual({
        pipelineRef: CUSTOM_ID,
        stageRef: STAGE_ID,
        label: "Reativação · Dia 2",
      });
    }
  });

  it("normalizes the canonical shape with a legacy stageKey ref", () => {
    const out = parsePostSendTarget({ pipelineId: CUSTOM_ID, stageKey: "novo_lead", label: "x" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.target.stageRef).toBe("novo_lead");
  });

  it("accepts the LEGACY system shape forever — normalizes slug + stage_key refs", () => {
    const out = parsePostSendTarget({
      funnelKind: "system",
      pipelineType: "propostas",
      stageKey: "enviada",
      label: "Orçamentos · Enviada",
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.target).toEqual({
        pipelineRef: "propostas",
        stageRef: "enviada",
        label: "Orçamentos · Enviada",
      });
    }
  });

  it("accepts the LEGACY custom shape forever (uuid pipeline + uuid stage)", () => {
    const out = parsePostSendTarget({
      funnelKind: "custom",
      pipelineId: CUSTOM_ID,
      stageKey: STAGE_ID,
      label: "Reativação · Dia 2",
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.target).toEqual({
        pipelineRef: CUSTOM_ID,
        stageRef: STAGE_ID,
        label: "Reativação · Dia 2",
      });
    }
  });

  it("rejects non-objects, missing stage, bad funnel kind", () => {
    expect(parsePostSendTarget(null).ok).toBe(false);
    expect(parsePostSendTarget("x").ok).toBe(false);
    expect(parsePostSendTarget([]).ok).toBe(false);
    expect(parsePostSendTarget({ funnelKind: "system", pipelineType: "whatsapp", stageKey: "" }).ok).toBe(false);
    expect(parsePostSendTarget({ funnelKind: "wat", stageKey: "x" }).ok).toBe(false);
    expect(parsePostSendTarget({ pipelineId: CUSTOM_ID }).ok).toBe(false);
  });

  it("rejects a legacy system target with an unknown pipeline_type", () => {
    const out = parsePostSendTarget({ funnelKind: "system", pipelineType: "vendas", stageKey: "x" });
    expect(out).toEqual({ ok: false, error: "post_send_target_invalid_pipeline_type" });
  });

  it("rejects a legacy custom target with non-uuid ids", () => {
    expect(
      parsePostSendTarget({ funnelKind: "custom", pipelineId: "not-a-uuid", stageKey: STAGE_ID }).ok,
    ).toBe(false);
    expect(
      parsePostSendTarget({ funnelKind: "custom", pipelineId: CUSTOM_ID, stageKey: "novo_lead" }).ok,
    ).toBe(false);
  });
});
