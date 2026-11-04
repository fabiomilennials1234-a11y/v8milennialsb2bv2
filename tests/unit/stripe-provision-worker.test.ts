// @vitest-environment node
/** Worker da provisão sobre as RPCs reais. Critérios 1, 4 e 5 na ponta do acesso. */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { all, attach, createBillingDb, one, paidArgs, rpcAdapter, seedEvent, seedLink, seedOrg } from "../helpers/stripe-billing-pglite.mjs";
import { provisionExistingOrgs, type ProvisionDeps } from "../../supabase/functions/billing-provision-worker/existing-org.ts";

let base: PGlite;
let db: PGlite;
let logs: Parameters<ProvisionDeps["log"]>[0][];

const deps = (over: Partial<ProvisionDeps> = {}): ProvisionDeps => ({
  rpc: rpcAdapter(db),
  log: async (e) => { logs.push(e); },
  ...over,
});

async function paga(status = "trial") {
  const org = await seedOrg(db, { status });
  const link = await seedLink(db, { orgId: org, plan: "torque-2.0", seats: 7 });
  const sub = `sub_${crypto.randomUUID()}`;
  const invoice = `in_${crypto.randomUUID()}`;
  await attach(db, { linkId: link.linkId, sub, invoice });
  await rpcAdapter(db)("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice, sub, amount: link.amountCents }));
  return { org, sub, invoice, link };
}

beforeAll(async () => { base = await createBillingDb(); }, 60_000);
beforeEach(async () => { db = await base.clone(); logs = []; });
afterEach(async () => { await db.close(); });

describe("provisionExistingOrgs", () => {
  it("critério 1: pagou e a org fica active, com plano, validade e quota", async () => {
    const { org, invoice } = await paga("suspended");
    const r = await provisionExistingOrgs(50, deps());
    expect(r).toMatchObject({ pendentes: 1, feito: [invoice], falhou: [], recusado: [] });
    const o = await one(db, "SELECT subscription_status, subscription_plan, subscription_expires_at FROM public.organizations WHERE id=$1", [org]);
    expect(o.subscription_status).toBe("active");
    expect(o.subscription_plan).toBe("torque-2.0");
    expect(new Date(o.subscription_expires_at).toISOString()).toBe("2026-12-04T00:00:00.000Z");
    expect((await one(db, "SELECT effective_limit e FROM public.org_quotas WHERE organization_id=$1 AND resource_key='max_users'", [org])).e).toBe(7);
  });

  it("critério 4: segunda passada não acha nada e não mexe na validade", async () => {
    const { org } = await paga();
    await provisionExistingOrgs(50, deps());
    const antes = await one(db, "SELECT subscription_expires_at e FROM public.organizations WHERE id=$1", [org]);
    expect((await provisionExistingOrgs(50, deps())).pendentes).toBe(0);
    expect(await one(db, "SELECT subscription_expires_at e FROM public.organizations WHERE id=$1", [org])).toEqual(antes);
    expect(await all(db, "SELECT 1 FROM public.subscription_provisionings WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("critério 5: renovação entra na fila", async () => {
    const { org, sub, link } = await paga();
    await provisionExistingOrgs(50, deps());
    await rpcAdapter(db)("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), {
      invoice: "in_renov", sub, amount: link.amountCents, start: "2026-12-04T00:00:00Z", end: "2027-01-04T00:00:00Z", reason: "subscription_cycle",
    }));
    expect((await provisionExistingOrgs(50, deps())).feito).toEqual(["in_renov"]);
    const { e } = await one(db, "SELECT subscription_expires_at e FROM public.organizations WHERE id=$1", [org]);
    expect(new Date(e).toISOString()).toBe("2027-01-04T00:00:00.000Z");
  });

  it("falha numa org não para as outras, fica pendente e é vermelha", async () => {
    const a = await paga();
    const b = await paga();
    const real = rpcAdapter(db);
    const r = await provisionExistingOrgs(50, deps({
      rpc: async (name, args) => {
        if (name === "billing_provision_existing_org" && args.p_provider_payment_id === a.invoice) {
          return { data: null, error: { message: "caiu" } };
        }
        return real(name, args);
      },
    }));
    expect(r.falhou).toEqual([a.invoice]);
    expect(r.feito).toEqual([b.invoice]);
    expect(logs.find((l) => l.action === "provision_falhou")).toMatchObject({ status: "error", organizationId: a.org });
    expect((await provisionExistingOrgs(50, deps())).feito).toEqual([a.invoice]);
  });

  it("fila ilegível: registra e não finge sucesso", async () => {
    const r = await provisionExistingOrgs(50, deps({ rpc: async () => ({ data: null, error: { message: "x" } }) }));
    expect(r.leituraFalhou).toBe(true);
    expect(logs[0]).toMatchObject({ action: "provision_worker_falhou", status: "error" });
  });

  it("sem PII no log", async () => {
    await paga();
    await provisionExistingOrgs(50, deps());
    expect(JSON.stringify(logs)).not.toMatch(/@|tq_pay/);
  });
});
