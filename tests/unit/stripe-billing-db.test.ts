// @vitest-environment node
/**
 * Migration e RPCs da Stripe em PGlite, sob os papéis reais (RLS + grants + claims).
 * Critérios 4, 5, 6, 7 (motor × catálogo), 8 (índice) e 9. Controle positivo em cada
 * negativa: "falha porque não pode", não "falha porque nada funciona".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  all, asService, attach, createBaseDb, createBillingDb, one, paidArgs, rpcAdapter, seedEvent, seedLink, seedOrg,
  stripeMigration, stripeRollback,
} from "../helpers/stripe-billing-pglite.mjs";
import { BILLING_CYCLES, catalogUnits, type BillingCycle } from "../../supabase/functions/_shared/stripe/catalog.ts";

let base: PGlite;
let db: PGlite;
let rpc: ReturnType<typeof rpcAdapter>;

beforeAll(async () => {
  base = await createBillingDb();
}, 60_000);

beforeEach(async () => {
  db = await base.clone();
  rpc = rpcAdapter(db);
});
afterEach(async () => {
  await db.close();
});

/** Assinatura paga até provisionar. */
async function pagar(opts: Parameters<typeof seedLink>[0] & { sub?: string; invoice?: string }) {
  const org = opts?.orgId ?? await seedOrg(db);
  const link = await seedLink(db, { ...opts, orgId: org });
  const sub = opts?.sub ?? `sub_${crypto.randomUUID()}`;
  const invoice = opts?.invoice ?? `in_${crypto.randomUUID()}`;
  await attach(db, { linkId: link.linkId, sub, invoice });
  const ev = await seedEvent(db);
  const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(ev, { invoice, sub, amount: link.amountCents }));
  expect(r.error).toBeNull();
  return { org, link, sub, invoice, ev, result: r.data };
}

const orgRow = (id: string) =>
  one(db, "SELECT subscription_status, subscription_plan, subscription_expires_at FROM public.organizations WHERE id=$1", [id]);

describe("critério 9: grants medidos", () => {
  const SIGS = [
    "public.billing_stripe_assert_service()",
    "public.billing_stripe_attach_checkout(uuid,text,text,text,integer)",
    "public.billing_stripe_record_consent(uuid,text)",
    "public.billing_stripe_apply_invoice_paid(uuid,text,text,integer,text,timestamptz,timestamptz,timestamptz,text,text,boolean)",
    "public.billing_stripe_apply_invoice_failed(uuid,text,text,integer,timestamptz,timestamptz,text)",
    "public.billing_stripe_mirror_subscription(uuid,text,text,timestamptz,boolean,timestamptz)",
    "public.billing_pending_provisionings(integer)",
    "public.billing_provision_existing_org(text)",
    "public.billing_quote_price(uuid,integer,text,text,text,integer)",
  ];
  // pg_read_all_stats não recebe grant direto: só enxerga o que PUBLIC tem.
  it.each(SIGS)("%s só para service_role", async (sig) => {
    const r = await one(db, `SELECT
      has_function_privilege('anon', $1, 'EXECUTE') anon,
      has_function_privilege('authenticated', $1, 'EXECUTE') auth,
      has_function_privilege('service_role', $1, 'EXECUTE') service,
      has_function_privilege('pg_read_all_stats', $1, 'EXECUTE') pub`, [sig]);
    expect(r).toEqual({ anon: false, auth: false, service: true, pub: false });
  });

  it("toda RPC nova é DEFINER com search_path fixo (menos o gate, que é INVOKER)", async () => {
    const rows = await all(db, `SELECT proname, prosecdef, proconfig FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname LIKE 'billing_stripe%'`);
    expect(rows).toHaveLength(6);
    for (const r of rows as { proname: string; prosecdef: boolean; proconfig: string[] }[]) {
      expect(r.proconfig.join()).toContain('search_path=""');
      expect(r.prosecdef).toBe(r.proname !== "billing_stripe_assert_service");
    }
  });

  it("anon e authenticated não executam; service_role executa (controle positivo)", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(db.transaction(async (tx) => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        await tx.query("SELECT * FROM public.billing_pending_provisionings(1)");
      })).rejects.toMatchObject({ code: "42501" });
    }
    expect((await rpc("billing_pending_provisionings", { p_limit: 1 })).error).toBeNull();
  });

  it("gate do corpo: com EXECUTE devolvido por engano, sessão sem claim continua barrada", async () => {
    await db.exec(`
      CREATE ROLE intruso NOLOGIN;
      GRANT USAGE ON SCHEMA public TO intruso;
      GRANT EXECUTE ON FUNCTION public.billing_pending_provisionings(integer) TO intruso;
      GRANT EXECUTE ON FUNCTION public.billing_stripe_assert_service() TO intruso;
    `);
    await expect(db.transaction(async (tx) => {
      await tx.exec("SET LOCAL SESSION AUTHORIZATION intruso");
      await tx.query("SELECT * FROM public.billing_pending_provisionings(1)");
    })).rejects.toMatchObject({ code: "42501" });

    // Controle positivo: a mesma sessão com o claim de service_role passa pelo gate.
    await db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL SESSION AUTHORIZATION intruso; SET LOCAL request.jwt.claims = '{"role":"service_role"}'`);
      await tx.query("SELECT * FROM public.billing_pending_provisionings(1)");
    });
  });

  it("org_billing_customers: RLS ligada, sem policy; service_role só SELECT e INSERT", async () => {
    const t = await one(db, "SELECT relrowsecurity FROM pg_class WHERE oid='public.org_billing_customers'::regclass");
    expect(t.relrowsecurity).toBe(true);
    expect(await all(db, "SELECT 1 FROM pg_policies WHERE tablename='org_billing_customers'")).toHaveLength(0);
    const p = await one(db, `SELECT
      has_table_privilege('anon','public.org_billing_customers','SELECT') a,
      has_table_privilege('authenticated','public.org_billing_customers','SELECT') b,
      has_table_privilege('service_role','public.org_billing_customers','SELECT') c,
      has_table_privilege('service_role','public.org_billing_customers','INSERT') d,
      has_table_privilege('service_role','public.org_billing_customers','UPDATE') e,
      has_table_privilege('service_role','public.org_billing_customers','DELETE') f`);
    expect(p).toEqual({ a: false, b: false, c: true, d: true, e: false, f: false });
  });
});

describe("#1559: override acima do preço", () => {
  const quote = (manual: number, cycle = "annual") => one(db, `SELECT public.billing_quote_price(
    (SELECT id FROM public.subscription_plans WHERE name='torque-v8'), 3, $1, 'credit_card', NULL, $2::int) q`, [cycle, manual]);

  it("recusa 22023 quando o valor é maior (o total do ciclo no lugar do mensal)", async () => {
    await expect(quote(2036940)).rejects.toMatchObject({ code: "22023" });
  });
  it("aceita igual e menor", async () => {
    expect((await quote(169745)).q.charge_cents).toBe(2036940);
    const r = (await quote(100000)).q;
    expect(r.charge_cents).toBe(1200000);
    expect(r.manual_discount_cents).toBe(69745);
  });
});

describe("critério 7: catálogo == motor na matriz", () => {
  it("toda combinação plano × ciclo × assentos", async () => {
    for (const plan of ["torque-v8", "torque-2.0", "torque-1.0"]) {
      for (const cycle of Object.keys(BILLING_CYCLES) as BillingCycle[]) {
        for (const seats of [1, 2, 3, 4, 5, 6, 9, 10, 25, 100]) {
          const { q } = await one(db, `SELECT public.billing_quote_price(
            (SELECT id FROM public.subscription_plans WHERE name=$1), $2::int, $3, 'credit_card', NULL, NULL) q`, [plan, seats, cycle]);
          const units = catalogUnits(plan, cycle, q)!;
          expect(units.reduce((acc, u) => acc + u.unit_amount * u.quantity, 0), `${plan} ${cycle} ${seats}`).toBe(q.charge_cents);
        }
      }
    }
  });
});

describe("apply_invoice_paid", () => {
  it("critério 6: org paga mantém as features do plano, sem cair no default", async () => {
    const { org } = await pagar({ plan: "torque-v8", seats: 3 });
    const { r } = await one(db, "SELECT public.org_get_features_and_limits($1) r", [org]);
    // v8 liga marketing/copilot/whatsapp_bulk, que têm default false: é o rebaixamento.
    expect(r.features.copilot).toBe(true);
    expect(r.features.marketing).toBe(true);
    expect(r.features.whatsapp_bulk).toBe(true);
    // E o plano desliga voice_calls; chave fora do plano e vendável fica false, não default.
    expect(r.features.voice_calls).toBe(false);
    expect(r.features.white_label).toBe(false);
    expect(r.features.automations).toBe(true);
  });

  it("B1: chave vendável fora do plano herda o default do catálogo, não false", async () => {
    // campaigns_manual em prod: vendável, default true, ausente dos 3 planos. OrgFeaturesContext.tsx:50 gateia por ela.
    const { c } = await one(db, "SELECT count(*)::int c FROM public.subscription_plans WHERE features ? 'campaigns_manual'");
    expect(c).toBe(0);
    const { org } = await pagar({ plan: "torque-v8", seats: 3 });
    const s = await one(db, "SELECT features FROM public.org_subscriptions WHERE organization_id=$1", [org]);
    expect(s.features.campaigns_manual).toBe(true);
    const { r } = await one(db, "SELECT public.org_get_features_and_limits($1) r", [org]);
    expect(r.features.campaigns_manual).toBe(true);
    // Controle: default false continua false.
    expect(s.features.api_access).toBe(false);
  });

  it("B1: falso explícito do plano vence default true", async () => {
    await db.query(`UPDATE public.subscription_plans SET features = features || '{"oraculo": false}' WHERE name='torque-1.0'`);
    const { org } = await pagar({ plan: "torque-1.0", seats: 2 });
    const s = await one(db, "SELECT features FROM public.org_subscriptions WHERE organization_id=$1", [org]);
    expect(s.features.oraculo).toBe(false);
  });

  it("B1: falso explícito do pacote vence plano e default", async () => {
    const { org } = await pagar({ plan: "torque-v8", seats: 3, features: { campaigns_manual: false, chat: false } });
    const s = await one(db, "SELECT features FROM public.org_subscriptions WHERE organization_id=$1", [org]);
    expect(s.features.campaigns_manual).toBe(false);
    expect(s.features.chat).toBe(false);
  });

  it("B3: link revogado com pagamento concluído: aplica e sinaliza", async () => {
    const org = await seedOrg(db);
    const link = await seedLink(db, { orgId: org });
    await attach(db, { linkId: link.linkId, sub: "sub_rv", invoice: "in_rv" });
    await db.query("UPDATE public.payment_links SET revoked_at = now() WHERE id=$1", [link.linkId]);
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_rv", sub: "sub_rv", amount: link.amountCents }));
    expect(r.data).toMatchObject({ ok: true, code: "applied", link_revoked: true });
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(1);
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("N7: renovação com link revogado DEPOIS de pago não sinaliza", async () => {
    const p = await pagar({});
    await db.query("UPDATE public.payment_links SET revoked_at = now() WHERE id=$1", [p.link.linkId]);
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), {
      invoice: "in_ren_rv", sub: p.sub, amount: p.link.amountCents, start: "2026-12-04T00:00:00Z", end: "2027-01-04T00:00:00Z", reason: "subscription_cycle",
    }));
    expect(r.data).toMatchObject({ code: "applied", link_revoked: false });
  });

  it("N7: pagamento feito após revogar sinaliza, e reentrega por outro evento depois do carimbo não repete", async () => {
    const org = await seedOrg(db);
    const link = await seedLink(db, { orgId: org });
    await attach(db, { linkId: link.linkId, sub: "sub_n7", invoice: "in_n7" });
    await db.query("UPDATE public.payment_links SET revoked_at = now() WHERE id=$1", [link.linkId]);
    const args = { invoice: "in_n7", sub: "sub_n7", amount: link.amountCents };
    expect((await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), args))).data).toMatchObject({ link_revoked: true });
    expect((await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), args))).data).toMatchObject({ link_revoked: false });
  });

  it("B3: controle positivo: link não revogado devolve link_revoked=false", async () => {
    const { result } = await pagar({});
    expect(result).toMatchObject({ code: "applied", link_revoked: false });
  });

  it("snapshot: exaustivo sobre vendáveis e pacote vence plano; não vendável fora", async () => {
    const { org } = await pagar({ plan: "torque-1.0", seats: 2, features: { copilot: true, leads: false }, limits: { max_leads: 77 } });
    const s = await one(db, "SELECT features, limits, base_amount_cents, final_amount_cents, user_count, provider, payment_method FROM public.org_subscriptions WHERE organization_id=$1", [org]);
    const { n } = await one(db, "SELECT count(*)::int n FROM public.feature_catalog WHERE is_sellable");
    expect(Object.keys(s.features)).toHaveLength(n);
    expect(s.features.copilot).toBe(true);
    expect(s.features.leads).toBe(false);
    // Plano Base de prod não tem chat: o snapshot segue o plano, e não o default do catálogo.
    expect(s.features.chat).toBe(false);
    expect(s.features.deals).toBe(true);
    expect(s.features).not.toHaveProperty("merged_opportunity_funnel");
    expect(s.limits.max_leads).toBe(77);
    expect(s.limits.max_users).toBe(5);
    expect(s).toMatchObject({ base_amount_cents: 59400, final_amount_cents: 59400, user_count: 2, provider: "stripe", payment_method: "credit_card" });
  });

  it("valores do snapshot são mensais, e o histórico guarda o total do ciclo", async () => {
    const { org } = await pagar({ plan: "torque-v8", seats: 3, cycle: "annual" });
    const s = await one(db, "SELECT base_amount_cents, final_amount_cents, discount_amount_cents, cycle_discount_pct::int pct FROM public.org_subscriptions WHERE organization_id=$1", [org]);
    expect(s).toEqual({ base_amount_cents: 199700, final_amount_cents: 169745, discount_amount_cents: 29955, pct: 15 });
    const h = await one(db, "SELECT amount::numeric(12,2)::text amount, discount_applied::numeric(12,2)::text d, billing_type, status, asaas_payment_id, provider FROM public.payment_history WHERE organization_id=$1", [org]);
    expect(h).toEqual({ amount: "20369.40", d: "3594.60", billing_type: "CREDIT_CARD", status: "received", asaas_payment_id: null, provider: "stripe" });
  });

  it("preço negociado grava motivo e autor, e passa nos CHECKs da assinatura", async () => {
    const { org } = await pagar({ plan: "torque-v8", seats: 3, manual: 150000, reason: "fechamento" });
    const s = await one(db, "SELECT manual_discount_cents, manual_discount_reason, manual_discount_by IS NOT NULL autor FROM public.org_subscriptions WHERE organization_id=$1", [org]);
    expect(s).toEqual({ manual_discount_cents: 49700, manual_discount_reason: "fechamento", autor: true });
  });

  it("cupom: consome uma vez, por link, mesmo com renovação", async () => {
    const { id: coupon } = await one(db, "INSERT INTO public.coupons (code, discount_pct) VALUES ('C10', 10) RETURNING id");
    const p = await pagar({ plan: "torque-v8", seats: 3, coupon: "C10" });
    await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), {
      invoice: "in_renov", sub: p.sub, amount: p.link.amountCents, start: "2026-12-04T00:00:00Z", end: "2027-01-04T00:00:00Z", reason: "subscription_cycle",
    }));
    const r = await all(db, "SELECT discount_applied_cents FROM public.coupon_redemptions WHERE coupon_id=$1", [coupon]);
    expect(r).toEqual([{ discount_applied_cents: 19970 }]);
  });

  it("critério 4: mesmo evento reentregue não duplica nada", async () => {
    const p = await pagar({});
    const antes = await one(db, "SELECT updated_at FROM public.org_subscriptions WHERE organization_id=$1", [p.org]);
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(p.ev, { invoice: p.invoice, sub: p.sub, amount: p.link.amountCents }));
    expect(r.data.code).toBe("already_applied");
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [p.org])).toHaveLength(1);
    expect((await one(db, "SELECT updated_at FROM public.org_subscriptions WHERE organization_id=$1", [p.org])).updated_at).toEqual(antes.updated_at);
  });

  it("critério 4: dois eventos diferentes da mesma invoice dão uma linha de histórico", async () => {
    const p = await pagar({});
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: p.invoice, sub: p.sub, amount: p.link.amountCents }));
    expect(r.data.code).toBe("applied");
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [p.org])).toHaveLength(1);
  });

  it("critério 4: crash no meio desfaz tudo; a reentrega aplica", async () => {
    const org = await seedOrg(db);
    const link = await seedLink(db, { orgId: org });
    await attach(db, { linkId: link.linkId, sub: "sub_c", invoice: "in_c" });
    const ev = await seedEvent(db);
    // Falha injetada no último passo: o UPDATE do ledger.
    await db.exec(`CREATE FUNCTION public.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'crash' USING ERRCODE='XX000'; END $$;
      CREATE TRIGGER boom BEFORE UPDATE ON public.payment_webhook_events FOR EACH ROW EXECUTE FUNCTION public.boom();`);
    const args = paidArgs(ev, { invoice: "in_c", sub: "sub_c", amount: link.amountCents });
    expect((await rpc("billing_stripe_apply_invoice_paid", args)).error).toMatchObject({ code: "XX000" });
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [org])).toHaveLength(0);
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(0);
    expect((await one(db, "SELECT paid_at FROM public.payment_links WHERE id=$1", [link.linkId])).paid_at).toBeNull();

    await db.exec("DROP TRIGGER boom ON public.payment_webhook_events");
    expect((await rpc("billing_stripe_apply_invoice_paid", args)).data.code).toBe("applied");
    expect((await one(db, "SELECT status FROM public.payment_webhook_events WHERE id=$1", [ev])).status).toBe("applied");
  });

  it("assinatura desconhecida: evento failed, sem escrever nada", async () => {
    const ev = await seedEvent(db);
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(ev, { invoice: "in_x", sub: "sub_x", amount: 1 }));
    expect(r.data).toEqual({ ok: false, code: "subscription_unknown" });
    expect(await one(db, "SELECT status, error_message FROM public.payment_webhook_events WHERE id=$1", [ev])).toEqual({ status: "failed", error_message: "subscription_unknown" });
    expect(await all(db, "SELECT 1 FROM public.payment_history")).toHaveLength(0);
  });

  it("critério 8: outra assinatura viva não é sobrescrita; devolve conflict e alarma", async () => {
    const p = await pagar({ plan: "torque-v8", seats: 3 });
    const link2 = await seedLink(db, { orgId: p.org, plan: "torque-1.0", seats: 2 });
    await attach(db, { linkId: link2.linkId, sub: "sub_2", invoice: "in_2" });
    const ev = await seedEvent(db);
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(ev, { invoice: "in_2", sub: "sub_2", amount: link2.amountCents }));
    expect(r.data).toMatchObject({ ok: false, code: "conflict" });
    const s = await all(db, "SELECT provider_subscription_id FROM public.org_subscriptions WHERE organization_id=$1", [p.org]);
    expect(s).toEqual([{ provider_subscription_id: p.sub }]);
    // O dinheiro entrou: histórico e link pago ficam, e o ledger segue visível como failed.
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE provider_payment_id='in_2'")).toHaveLength(1);
    expect(await one(db, "SELECT status, error_message FROM public.payment_webhook_events WHERE id=$1", [ev])).toEqual({ status: "failed", error_message: "org_conflict" });
  });

  it("valor pago diferente do link: registra e sinaliza, sem recusar", async () => {
    const org = await seedOrg(db);
    const link = await seedLink(db, { orgId: org });
    await attach(db, { linkId: link.linkId, sub: "sub_m", invoice: "in_m" });
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_m", sub: "sub_m", amount: 1 }));
    expect(r.data).toMatchObject({ ok: true, code: "applied", amount_mismatch: true });
  });

  it("assinatura não ativa: registra o dinheiro, não materializa assinatura", async () => {
    const org = await seedOrg(db);
    const link = await seedLink(db, { orgId: org });
    await attach(db, { linkId: link.linkId, sub: "sub_n", invoice: "in_n" });
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_n", sub: "sub_n", amount: link.amountCents, status: "canceled" }));
    expect(r.data.code).toBe("not_active");
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(0);
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("primeiro carimbo de paid_at vence", async () => {
    const p = await pagar({});
    await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_r", sub: p.sub, amount: 1, paidAt: "2027-06-01T00:00:00Z", start: "2026-12-04T00:00:00Z", end: "2027-01-04T00:00:00Z" }));
    const { paid_at } = await one(db, "SELECT paid_at FROM public.payment_links WHERE id=$1", [p.link.linkId]);
    expect(new Date(paid_at).toISOString()).toBe("2026-11-04T00:00:01.000Z");
  });
});

describe("attach_checkout", () => {
  it("attempt novo troca a linha; attempt velho não recua", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    expect((await attach(db, { linkId, sub: "s1", invoice: "i1" })).data).toMatchObject({ code: "ok", must_cancel: false });
    expect((await attach(db, { linkId, sub: "s2", invoice: "i2", attempt: 2 })).data).toMatchObject({ code: "ok", must_cancel: false });
    expect((await attach(db, { linkId, sub: "s1", invoice: "i1", attempt: 1 })).data).toMatchObject({ code: "stale_attempt", must_cancel: true });
    expect(await all(db, "SELECT provider_subscription_id, attempt, provider FROM public.payment_link_charges WHERE payment_link_id=$1", [linkId]))
      .toEqual([{ provider_subscription_id: "s2", attempt: 2, provider: "stripe" }]);
  });

  it("link revogado grava e manda cancelar", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    await db.query("UPDATE public.payment_links SET revoked_at=now() WHERE id=$1", [linkId]);
    expect((await attach(db, { linkId, sub: "s9", invoice: "i9" })).data).toMatchObject({ must_cancel: true, reason: "link_revoked" });
    expect(await all(db, "SELECT 1 FROM public.payment_link_charges WHERE payment_link_id=$1", [linkId])).toHaveLength(1);
  });
});

describe("attach_checkout: N3", () => {
  it("link pago e a linha já aponta para esta assinatura: não manda cancelar", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    await attach(db, { linkId, sub: "s_p", invoice: "i_p" });
    await db.query("UPDATE public.payment_links SET paid_at=now() WHERE id=$1", [linkId]);
    expect((await attach(db, { linkId, sub: "s_p", invoice: "i_p" })).data).toMatchObject({ must_cancel: false, reason: "already_paid" });
  });
  it("mesma situação com link pago e revogado: assinatura paga não é cancelada", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    await attach(db, { linkId, sub: "s_q", invoice: "i_q" });
    await db.query("UPDATE public.payment_links SET paid_at=now(), revoked_at=now() WHERE id=$1", [linkId]);
    expect((await attach(db, { linkId, sub: "s_q", invoice: "i_q" })).data).toMatchObject({ must_cancel: false });
  });
  it("controle positivo: link pago por OUTRA assinatura manda cancelar a nova", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    await attach(db, { linkId, sub: "s_a", invoice: "i_a" });
    await db.query("UPDATE public.payment_links SET paid_at=now() WHERE id=$1", [linkId]);
    expect((await attach(db, { linkId, sub: "s_b", invoice: "i_b", attempt: 2 })).data).toMatchObject({ must_cancel: true, reason: "already_paid" });
  });
});

describe("B2: record_consent", () => {
  const consent = (linkId: string, v: string) => rpc("billing_stripe_record_consent", { p_link_id: linkId, p_version: v });
  const buyer = (linkId: string) => rpc("billing_upsert_link_buyer", { p_link_id: linkId, p_provider: null, p_provider_customer_id: null, p_legal_name: "Empresa", p_email: "a@b.co", p_tax_id: "11222333000181" });

  it("sem comprador: recusa; com comprador grava versão e data", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    expect((await consent(linkId, "v1")).data).toEqual({ ok: false, code: "buyer_missing" });
    await buyer(linkId);
    expect((await consent(linkId, "v1")).data).toEqual({ ok: true, code: "ok" });
    const r = await one(db, "SELECT recurring_consent_version v, recurring_consent_at IS NOT NULL a FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId]);
    expect(r).toEqual({ v: "v1", a: true });
  });

  it("mesma versão preserva a data do primeiro aceite; versão nova atualiza", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    await buyer(linkId);
    await consent(linkId, "v1");
    await db.query("UPDATE public.payment_link_buyers SET recurring_consent_at='2020-06-01T00:00:00Z' WHERE payment_link_id=$1", [linkId]);
    await consent(linkId, "v1");
    const at = async () => new Date((await one(db, "SELECT recurring_consent_at a FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId])).a).getFullYear();
    expect(await at()).toBe(2020);
    await consent(linkId, "v2");
    expect(await at()).toBeGreaterThan(2020);
  });

  it("upsert do comprador não apaga o consentimento", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    await buyer(linkId);
    await consent(linkId, "v1");
    await buyer(linkId);
    expect((await one(db, "SELECT recurring_consent_version v FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId])).v).toBe("v1");
  });

  it("versão vazia é erro de chamador", async () => {
    const org = await seedOrg(db);
    const { linkId } = await seedLink(db, { orgId: org });
    await buyer(linkId);
    expect((await consent(linkId, " ")).error).toMatchObject({ code: "22023" });
  });
});

describe("mirror e invoice_failed", () => {
  it("assinatura ainda não materializada: ignored, sem erro", async () => {
    const ev = await seedEvent(db, undefined, "customer.subscription.updated");
    const r = await rpc("billing_stripe_mirror_subscription", { p_event_row_id: ev, p_subscription_id: "sub_z", p_status: "active", p_period_end: "2027-01-01T00:00:00Z", p_cancel_at_period_end: false, p_ended_at: null });
    expect(r.data.code).toBe("subscription_not_materialized");
    expect((await one(db, "SELECT status FROM public.payment_webhook_events WHERE id=$1", [ev])).status).toBe("ignored");
  });

  it("espelha status, cancel_at_period_end, e renews_at só avança", async () => {
    const p = await pagar({});
    const mirror = (end: string, status = "past_due", cape = true) => seedEvent(db, undefined, "customer.subscription.updated").then((ev) =>
      rpc("billing_stripe_mirror_subscription", { p_event_row_id: ev, p_subscription_id: p.sub, p_status: status, p_period_end: end, p_cancel_at_period_end: cape, p_ended_at: null }));
    await mirror("2027-02-01T00:00:00Z");
    await mirror("2026-11-20T00:00:00Z");
    const s = await one(db, "SELECT provider_status, cancel_at_period_end, renews_at FROM public.org_subscriptions WHERE organization_id=$1", [p.org]);
    expect(s.provider_status).toBe("past_due");
    expect(s.cancel_at_period_end).toBe(true);
    expect(new Date(s.renews_at).toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });

  it("deleted carimba cancelled_at e NÃO toca a org", async () => {
    const p = await pagar({});
    await rpc("billing_provision_existing_org", { p_provider_payment_id: p.invoice });
    const antes = await orgRow(p.org);
    const ev = await seedEvent(db, undefined, "customer.subscription.deleted");
    await rpc("billing_stripe_mirror_subscription", { p_event_row_id: ev, p_subscription_id: p.sub, p_status: "canceled", p_period_end: null, p_cancel_at_period_end: false, p_ended_at: "2027-03-01T00:00:00Z" });
    const s = await one(db, "SELECT cancelled_at, provider_status FROM public.org_subscriptions WHERE organization_id=$1", [p.org]);
    expect(new Date(s.cancelled_at).toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(s.provider_status).toBe("canceled");
    expect(await orgRow(p.org)).toEqual(antes);
  });

  it("failed atrasado não rebaixa invoice recebida", async () => {
    const p = await pagar({});
    const ev = await seedEvent(db, undefined, "invoice.payment_failed");
    const r = await rpc("billing_stripe_apply_invoice_failed", { p_event_row_id: ev, p_invoice_id: p.invoice, p_subscription_id: p.sub, p_amount_due_cents: 100, p_period_start: "2026-11-04T00:00:00Z", p_period_end: "2026-12-04T00:00:00Z", p_status: "past_due" });
    expect(r.data.code).toBe("applied");
    expect((await one(db, "SELECT status FROM public.payment_history WHERE provider_payment_id=$1", [p.invoice])).status).toBe("received");
    expect((await one(db, "SELECT provider_status FROM public.org_subscriptions WHERE organization_id=$1", [p.org])).provider_status).toBe("past_due");
  });

  it("failed depois received: a mesma invoice vira received", async () => {
    const org = await seedOrg(db);
    const link = await seedLink(db, { orgId: org });
    await attach(db, { linkId: link.linkId, sub: "sub_f", invoice: "in_f" });
    const ev = await seedEvent(db, undefined, "invoice.payment_failed");
    await rpc("billing_stripe_apply_invoice_failed", { p_event_row_id: ev, p_invoice_id: "in_f", p_subscription_id: "sub_f", p_amount_due_cents: link.amountCents, p_period_start: "2026-11-04T00:00:00Z", p_period_end: "2026-12-04T00:00:00Z", p_status: "incomplete" });
    expect((await one(db, "SELECT status FROM public.payment_history WHERE provider_payment_id='in_f'")).status).toBe("failed");
    await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_f", sub: "sub_f", amount: link.amountCents }));
    expect((await one(db, "SELECT status FROM public.payment_history WHERE provider_payment_id='in_f'")).status).toBe("received");
  });
});

describe("provisão", () => {
  it("critério 1/4: ativa com validade = renews_at, e a 2ª execução não soma", async () => {
    const p = await pagar({});
    const r1 = await rpc("billing_provision_existing_org", { p_provider_payment_id: p.invoice });
    expect(r1.data.code).toBe("provisioned");
    const o1 = await orgRow(p.org);
    expect(o1.subscription_status).toBe("active");
    expect(o1.subscription_plan).toBe("torque-v8");
    expect(new Date(o1.subscription_expires_at).toISOString()).toBe("2026-12-04T00:00:00.000Z");
    const r2 = await rpc("billing_provision_existing_org", { p_provider_payment_id: p.invoice });
    expect(r2.data.code).toBe("already_provisioned");
    expect(await orgRow(p.org)).toEqual(o1);
    expect(await all(db, "SELECT 1 FROM public.subscription_provisionings WHERE organization_id=$1", [p.org])).toHaveLength(1);
  });

  it("critério 5: renovação gera +1 histórico, +1 provisão, validade realinhada", async () => {
    const p = await pagar({});
    await rpc("billing_provision_existing_org", { p_provider_payment_id: p.invoice });
    const r = await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), {
      invoice: "in_ren", sub: p.sub, amount: p.link.amountCents, start: "2026-12-04T00:00:00Z", end: "2027-01-04T00:00:00Z", reason: "subscription_cycle",
    }));
    expect(r.data.code).toBe("applied");
    const pend = await rpc("billing_pending_provisionings", { p_limit: 10 });
    expect(pend.data).toEqual([{ provider_payment_id: "in_ren", organization_id: p.org }]);
    await rpc("billing_provision_existing_org", { p_provider_payment_id: "in_ren" });
    expect(new Date((await orgRow(p.org)).subscription_expires_at).toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(await all(db, "SELECT 1 FROM public.subscription_provisionings WHERE organization_id=$1", [p.org])).toHaveLength(2);
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [p.org])).toHaveLength(2);
  });

  it("critério 4: invoice antiga chegando depois não recua ponteiro nem validade", async () => {
    const p = await pagar({});
    await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_nova", sub: p.sub, amount: 1, start: "2027-01-04T00:00:00Z", end: "2027-02-04T00:00:00Z" }));
    await rpc("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_velha", sub: p.sub, amount: 1, start: "2026-12-04T00:00:00Z", end: "2027-01-04T00:00:00Z" }));
    const s = await one(db, "SELECT provider_payment_id, renews_at FROM public.org_subscriptions WHERE organization_id=$1", [p.org]);
    expect(s.provider_payment_id).toBe("in_nova");
    expect(new Date(s.renews_at).toISOString()).toBe("2027-02-04T00:00:00.000Z");
  });

  it("critério 6: quota de assentos cobre o que foi pago", async () => {
    const p = await pagar({ plan: "torque-2.0", seats: 8 });
    await rpc("billing_provision_existing_org", { p_provider_payment_id: p.invoice });
    const q = await one(db, "SELECT plan_base, purchased_addons, effective_limit FROM public.org_quotas WHERE organization_id=$1 AND resource_key='max_users'", [p.org]);
    expect(q).toEqual({ plan_base: 5, purchased_addons: 3, effective_limit: 8 });
    const { r } = await one(db, "SELECT public.org_get_features_and_limits($1) r", [p.org]);
    expect(r.limits.max_users).toBe(8);
  });

  it("assentos dentro da base: add-on zero", async () => {
    const p = await pagar({ plan: "torque-v8", seats: 3 });
    await rpc("billing_provision_existing_org", { p_provider_payment_id: p.invoice });
    expect((await one(db, "SELECT purchased_addons a FROM public.org_quotas WHERE organization_id=$1 AND resource_key='max_users'", [p.org])).a).toBe(0);
  });

  it("plano ilimitado: quota não recebe add-on", async () => {
    const org = await seedOrg(db);
    const { id: plan } = await one(db, "SELECT id FROM public.subscription_plans WHERE name='enterprise'");
    await db.query(`INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle, user_count, provider_payment_id, renews_at) VALUES ($1,$2,'monthly',50,'in_e', now() + interval '30 days')`, [org, plan]);
    await rpc("billing_provision_existing_org", { p_provider_payment_id: "in_e" });
    expect(await one(db, "SELECT plan_base, purchased_addons, effective_limit FROM public.org_quotas WHERE organization_id=$1 AND resource_key='max_users'", [org]))
      .toEqual({ plan_base: -1, purchased_addons: 0, effective_limit: -1 });
  });

  it("org suspensa reativa, com o gatilho do Oráculo disparando", async () => {
    const org = await seedOrg(db, { status: "suspended" });
    const p = await pagar({ orgId: org });
    expect((await rpc("billing_provision_existing_org", { p_provider_payment_id: p.invoice })).error).toBeNull();
    expect((await orgRow(org)).subscription_status).toBe("active");
    expect(await all(db, "SELECT 1 FROM public.oraculo_benchmark_weekly WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("linha sem renews_at (caminho Asaas deployado) mantém a soma antiga", async () => {
    const org = await seedOrg(db);
    const { id: plan } = await one(db, "SELECT id FROM public.subscription_plans WHERE name='torque-v8'");
    await db.query(`INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle, user_count, provider_payment_id) VALUES ($1,$2,'monthly',3,'pay_a')`, [org, plan]);
    await rpc("billing_provision_existing_org", { p_provider_payment_id: "pay_a" });
    const dias = (new Date((await orgRow(org)).subscription_expires_at).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(27);
    expect(dias).toBeLessThan(32);
  });

  it("achado 4: anti-join antes do limite não deixa pagante de fora", async () => {
    const { id: plan } = await one(db, "SELECT id FROM public.subscription_plans WHERE name='torque-v8'");
    for (let i = 0; i < 3; i++) {
      const o = await seedOrg(db);
      await db.query(`INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle, provider_payment_id, updated_at) VALUES ($1,$2,'monthly',$3, now() - interval '1 year')`, [o, plan, `pay_${i}`]);
      await db.query(`INSERT INTO public.subscription_provisionings (organization_id, provider_payment_id) VALUES ($1,$2)`, [o, `pay_${i}`]);
    }
    const nova = await seedOrg(db);
    await db.query(`INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle, provider_payment_id) VALUES ($1,$2,'monthly','pay_novo')`, [nova, plan]);
    expect((await rpc("billing_pending_provisionings", { p_limit: 1 })).data).toEqual([{ provider_payment_id: "pay_novo", organization_id: nova }]);
  });
});

describe("migration", () => {
  it("idempotente: aplicar de novo não falha nem muda grants", async () => {
    await db.exec(stripeMigration());
    const r = await one(db, "SELECT has_function_privilege('anon','public.billing_provision_existing_org(text)','EXECUTE') a");
    expect(r.a).toBe(false);
  });

  it("rollback volta ao estado anterior e reaplica", async () => {
    await db.exec(stripeRollback());
    expect(await all(db, "SELECT 1 FROM pg_class WHERE oid = to_regclass('public.org_billing_customers')")).toHaveLength(0);
    expect(await all(db, "SELECT 1 FROM pg_proc WHERE proname LIKE 'billing_stripe%'")).toHaveLength(0);
    expect(await all(db, "SELECT 1 FROM information_schema.columns WHERE table_name='payment_history' AND column_name='provider'")).toHaveLength(0);
    expect(await all(db, "SELECT 1 FROM information_schema.columns WHERE table_name='payment_link_buyers' AND column_name LIKE 'recurring_consent%'")).toHaveLength(0);
    expect(await one(db, "SELECT has_function_privilege('anon','public.billing_provision_existing_org(text)','EXECUTE') a, has_function_privilege('service_role','public.billing_provision_existing_org(text)','EXECUTE') s")).toEqual({ a: false, s: true });
    // O corpo antigo volta: a guarda #1559 some.
    const { q } = await one(db, `SELECT public.billing_quote_price((SELECT id FROM public.subscription_plans WHERE name='torque-v8'), 3, 'monthly', 'credit_card', NULL, 999999) q`);
    expect(q.final_amount_cents).toBe(999999);
    await db.exec(stripeMigration());
    expect(await all(db, "SELECT 1 FROM pg_proc WHERE proname LIKE 'billing_stripe%'")).toHaveLength(6);
  });

  it("base sem a migration é o baseline dos defeitos (controle)", async () => {
    const velho = await createBaseDb();
    try {
      const { q } = await one(velho, `SELECT public.billing_quote_price((SELECT id FROM public.subscription_plans WHERE name='torque-v8'), 3, 'annual', 'credit_card', NULL, 2036940) q`);
      expect(q.charge_cents).toBe(2036940 * 12);
    } finally {
      await velho.close();
    }
  }, 30_000);
});
