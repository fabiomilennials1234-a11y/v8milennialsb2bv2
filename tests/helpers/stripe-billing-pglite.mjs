// Banco de prova do billing da Stripe: PGlite + chão de prod + as migrations reais.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const HERDADAS = [
  '20270807000003_billing_price_engine.sql',
  '20270811140000_payment_links.sql',
  '20270811170000_payment_link_charges_method_do_port.sql',
  '20270811220000_payment_webhook_ledger_and_coupon_redemptions.sql',
  '20270812100000_provision_existing_org_after_payment.sql',
  '20270812111845_payment_link_buyers.sql',
  '20270812190000_payment_links_package.sql',
];
export const STRIPE_MIGRATION = '20271225000000_stripe_billing_foundation.sql';

/** Prod tem estas colunas por 20270812160000; aqui só o que o caminho existing_org encosta. */
const PROVISIONINGS_PROD = `
  ALTER TABLE public.subscription_provisionings
    ALTER COLUMN organization_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'provisioned',
    ADD COLUMN IF NOT EXISTS blocked_code text,
    ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
`;

export const stripeMigration = () => read(`supabase/migrations/${STRIPE_MIGRATION}`);
export const stripeRollback = () => read(`supabase/migrations/rollback/${STRIPE_MIGRATION}`);

export async function createBaseDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(read('tests/fixtures/stripe-billing-schema.sql'));
  for (const f of HERDADAS) await db.exec(read(`supabase/migrations/${f}`));
  await db.exec(PROVISIONINGS_PROD);
  return db;
}

export async function createBillingDb() {
  const db = await createBaseDb();
  await db.exec(stripeMigration());
  return db;
}

export const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
export const all = async (db, sql, params) => (await db.query(sql, params)).rows;

const SERVICE_CLAIMS = JSON.stringify({ role: 'service_role' });

/** Executa como o service_role real (papel + claims), como a edge function via PostgREST. */
export async function asService(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims = '${SERVICE_CLAIMS}';`);
    return fn(tx);
  });
}

/** Chamada de RPC por nome, com a forma { data, error } do supabase-js. Erro não é Error. */
export function rpcAdapter(db) {
  return async (name, args = {}) => {
    const keys = Object.keys(args);
    const list = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    try {
      const data = await asService(db, async (tx) => {
        const r = await tx.query(`SELECT * FROM public.${name}(${list})`, keys.map((k) => args[k]));
        const fields = r.fields.map((f) => f.name);
        if (fields.length === 1 && fields[0] === name) return r.rows[0]?.[name] ?? null;
        return r.rows;
      });
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };
}

export async function seedOrg(db, over = {}) {
  const row = await one(db,
    `INSERT INTO public.organizations (name, subscription_status, subscription_plan, subscription_expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [over.name ?? 'Org Teste', over.status ?? 'trial', over.plan ?? null, over.expiresAt ?? null]);
  return row.id;
}

/** Link de verdade: o preço sai do motor, como em `billing_create_payment_link`. */
export async function seedLink(db, { orgId, plan = 'torque-v8', seats = 3, cycle = 'monthly', coupon = null,
  manual = null, reason = null, features = {}, limits = {}, expiresAt = null } = {}) {
  const token = `tq_pay_${crypto.randomUUID().replaceAll('-', '')}`;
  const actor = (await one(db, 'INSERT INTO auth.users DEFAULT VALUES RETURNING id')).id;
  const row = await one(db, `
    WITH q AS (
      SELECT public.billing_quote_price(
        (SELECT id FROM public.subscription_plans WHERE name = $2), $3::int, $4, 'credit_card', $5, $6::int) AS quote
    )
    INSERT INTO public.payment_links (
      token_hash, target_kind, organization_id, quote, amount_cents, expires_at, created_by,
      package_features, package_limits, manual_discount_cents, manual_discount_reason, manual_discount_by)
    SELECT encode(extensions.digest($7, 'sha256'), 'hex'), 'existing_org', $1::uuid, q.quote,
           (q.quote ->> 'charge_cents')::int, COALESCE($8::timestamptz, now() + interval '7 days'), $9::uuid,
           $10::jsonb, $11::jsonb, NULLIF((q.quote ->> 'manual_discount_cents')::int, 0),
           CASE WHEN NULLIF((q.quote ->> 'manual_discount_cents')::int, 0) IS NOT NULL THEN $12 END,
           CASE WHEN NULLIF((q.quote ->> 'manual_discount_cents')::int, 0) IS NOT NULL THEN $9::uuid END
      FROM q
    RETURNING id, amount_cents, quote`,
    [orgId, plan, seats, cycle, coupon, manual, token, expiresAt, actor,
     JSON.stringify(features), JSON.stringify(limits), reason]);
  return { linkId: row.id, token, amountCents: row.amount_cents, quote: row.quote };
}

/** Ledger como o handler grava. */
export async function seedEvent(db, id = `evt_${crypto.randomUUID()}`, type = 'invoice.paid') {
  const row = await asService(db, (tx) => tx.query(
    `INSERT INTO public.payment_webhook_events (provider, provider_event_id, event_type)
     VALUES ('stripe', $1, $2) RETURNING id`, [id, type]));
  return row.rows[0].id;
}

export async function attach(db, { linkId, sub, invoice, customer = 'cus_t', attempt = 1 }) {
  const rpc = rpcAdapter(db);
  return rpc('billing_stripe_attach_checkout', {
    p_link_id: linkId, p_subscription_id: sub, p_invoice_id: invoice, p_customer_id: customer, p_attempt: attempt,
  });
}

export function paidArgs(eventRow, { invoice, sub, amount, start = '2026-11-04T00:00:00Z', end = '2026-12-04T00:00:00Z',
  paidAt = '2026-11-04T00:00:01Z', reason = 'subscription_create', status = 'active', currency = 'brl', cape = false }) {
  return {
    p_event_row_id: eventRow, p_invoice_id: invoice, p_subscription_id: sub, p_amount_paid_cents: amount,
    p_currency: currency, p_period_start: start, p_period_end: end, p_paid_at: paidAt,
    p_billing_reason: reason, p_status: status, p_cancel_at_period_end: cape,
  };
}

/** As portas do handler do webhook, sobre o service_role real. */
export function webhookDbAdapter(db) {
  return {
    insertEvent: async (row) => {
      try {
        const r = await asService(db, (tx) => tx.query(
          `INSERT INTO public.payment_webhook_events (provider, provider_event_id, event_type, provider_payment_id, status, payload)
           VALUES ('stripe', $1, $2, $3, $4, $5::jsonb) RETURNING id`,
          [row.provider_event_id, row.event_type, row.provider_payment_id, row.status, JSON.stringify(row.payload)]));
        return { data: r.rows[0], error: null };
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } };
      }
    },
    findEvent: async (id) => {
      const r = await asService(db, (tx) => tx.query(
        `SELECT id, status FROM public.payment_webhook_events WHERE provider='stripe' AND provider_event_id=$1`, [id]));
      return { data: r.rows[0] ?? null, error: null };
    },
    markEvent: async (id, status, msg) => {
      await asService(db, (tx) => tx.query(
        `UPDATE public.payment_webhook_events SET status=$2, error_message=$3, processed_at=now() WHERE id=$1`, [id, status, msg]));
    },
    rpc: rpcAdapter(db),
  };
}

/** As portas do checkout, com as mesmas tabelas e RPCs que index.ts usa, como service_role. */
export function checkoutDbAdapter(db) {
  const rpc = rpcAdapter(db);
  const asRow = async (sql, params) => {
    try {
      const r = await asService(db, (tx) => tx.query(sql, params));
      return { data: r.rows[0] ?? null, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };
  return {
    resolveLink: (token) => rpc('billing_resolve_payment_link', { p_token: token }),
    upsertBuyer: (a) => rpc('billing_upsert_link_buyer', {
      p_link_id: a.linkId,
      p_provider: a.providerCustomerId ? 'stripe' : null,
      p_provider_customer_id: a.providerCustomerId,
      p_legal_name: a.legalName,
      p_email: a.email,
      p_tax_id: a.taxId,
    }),
    recordConsent: (linkId, version) => rpc('billing_stripe_record_consent', { p_link_id: linkId, p_version: version }),
    attachCheckout: (a) => rpc('billing_stripe_attach_checkout', {
      p_link_id: a.linkId, p_subscription_id: a.subscriptionId, p_invoice_id: a.invoiceId,
      p_customer_id: a.customerId, p_attempt: a.attempt,
    }),
    getOrgCustomer: (orgId) => asRow(
      'SELECT provider_customer_id, livemode FROM public.org_billing_customers WHERE organization_id=$1', [orgId]),
    insertOrgCustomer: async (orgId, id, live) => {
      const { error } = await asRow(
        `INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode)
         VALUES ($1,'stripe',$2,$3)`, [orgId, id, live]);
      return { error };
    },
    getLinkCharge: (linkId) => asRow(
      `SELECT provider, provider_subscription_id, attempt FROM public.payment_link_charges
        WHERE payment_link_id=$1 AND method='credit_card'`, [linkId]),
    otherLinkSubscriptions: async (orgId, linkId) => {
      try {
        const r = await asService(db, (tx) => tx.query(
          `SELECT c.provider_subscription_id AS subscription_id, l.revoked_at IS NOT NULL AS link_revoked
             FROM public.payment_link_charges c
             JOIN public.payment_links l ON l.id = c.payment_link_id
            WHERE c.provider='stripe' AND c.provider_subscription_id IS NOT NULL
              AND c.payment_link_id <> $1 AND l.organization_id = $2`, [linkId, orgId]));
        return { data: r.rows, error: null };
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } };
      }
    },
    currentSubscription: (orgId) => asRow(
      'SELECT provider_subscription_id FROM public.org_subscriptions WHERE organization_id=$1 AND cancelled_at IS NULL', [orgId]),
  };
}
