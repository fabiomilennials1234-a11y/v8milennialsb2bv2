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

/** Chainable Supabase stub. Returns org-cap row for `organizations`,
 *  and the provided leads for `leads` (only those matching org filter). */
function supabaseStub(opts: { cap?: number | null; leads: any[]; upsell?: any[] }) {
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
              maybeSingle: async () => ({ data: { quick_blast_max_leads: opts.cap ?? null }, error: null }),
            }),
          }),
        };
      }
      if (table === "leads") return queryReturning(opts.leads);
      if (table === "upsell_clients") return queryReturning(opts.upsell ?? []);
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
});
