// @vitest-environment node
/**
 * Integration tests — soft-delete leak in metric RPCs (SP-0 fix).
 *
 * Regression: get_analytics_overview_metrics and get_analytics_financial_metrics
 * (live defs in 20261114000011) scanned `leads` without filtering the trash
 * (`deleted_at IS NULL`) or shadow rows (`is_shadow`). A soft-deleted or shadow
 * lead — and its sold proposal — therefore kept inflating revenue, customer
 * counts and origin attribution. The newer meeting_events RPCs
 * (20261125000001) already filter both; the fix mirrors that predicate on
 * every leads scan of the two older RPCs.
 *
 * These tests seed one normal lead, one soft-deleted lead and one shadow lead
 * (same origin, each with a `vendido` proposal in the window) and assert only
 * the normal lead contributes to overview + financial output.
 *
 * Prerequisites: local `supabase start` + migrations, OR point at a remote
 * project via SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY envs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Dedicated fixture org (never collides with seeds/real data)
const ORG = 'ffffffff-0000-4000-a000-00000000f702';
const ORIGIN = 'meta_ads';

// Window: [15 days ago .. today]. The RPCs treat p_end_date inclusively
// (`< p_end_date + interval '1 day'`), so a sale closed "now" is inside.
const now = new Date();
const START = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const END = now.toISOString().slice(0, 10);
const TS_IN_WINDOW = now.toISOString();

const SALE_NORMAL = 1000;
const SALE_DELETED = 5000;
const SALE_SHADOW = 7000;

let leadSeq = 0;

interface SeedOpts {
  saleValue: number;
  deleted?: boolean;
  shadow?: boolean;
}

/** Seed a lead + a `vendido` proposal inside the window. Returns the lead id. */
async function seedLeadWithSale(opts: SeedOpts): Promise<string> {
  leadSeq += 1;
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({
      organization_id: ORG,
      name: `SoftDelete Fixture ${leadSeq}`,
      phone: `+5599955${String(leadSeq).padStart(6, '0')}`,
      origin: ORIGIN,
      created_at: TS_IN_WINDOW,
      is_shadow: opts.shadow ?? false,
      deleted_at: opts.deleted ? TS_IN_WINDOW : null,
    })
    .select('id')
    .single();
  if (leadErr) throw new Error(`seedLead failed: ${leadErr.message}`);
  const leadId = lead.id as string;

  const { error: propErr } = await supabase.from('pipe_propostas').insert({
    organization_id: ORG,
    lead_id: leadId,
    status: 'vendido',
    product_type: 'projeto',
    sale_value: opts.saleValue,
    closed_at: TS_IN_WINDOW,
  });
  if (propErr) throw new Error(`seedProposta failed: ${propErr.message}`);

  return leadId;
}

async function callFinancial(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('get_analytics_financial_metrics', {
    p_org_id: ORG,
    p_start_date: START,
    p_end_date: END,
  });
  if (error) throw new Error(`financial rpc failed: ${error.message}`);
  return (data ?? {}) as Record<string, unknown>;
}

async function callOverview(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('get_analytics_overview_metrics', {
    p_org_id: ORG,
    p_start_date: START,
    p_end_date: END,
  });
  if (error) throw new Error(`overview rpc failed: ${error.message}`);
  return (data ?? {}) as Record<string, unknown>;
}

async function wipe(): Promise<void> {
  await supabase.from('pipe_propostas').delete().eq('organization_id', ORG);
  await supabase.from('leads').delete().eq('organization_id', ORG);
}

describe.skipIf(shouldSkip)('metric RPCs — exclude soft-deleted / shadow leads', () => {
  beforeAll(async () => {
    const { error: orgErr } = await supabase
      .from('organizations')
      .upsert(
        { id: ORG, name: 'Soft-Delete Test Org', slug: 'soft-delete-metrics-test' },
        { onConflict: 'id' }
      );
    if (orgErr) throw new Error(`org seed failed: ${orgErr.message}`);

    await wipe();

    // One real lead (must count) + one trashed + one shadow (must NOT count).
    await seedLeadWithSale({ saleValue: SALE_NORMAL });
    await seedLeadWithSale({ saleValue: SALE_DELETED, deleted: true });
    await seedLeadWithSale({ saleValue: SALE_SHADOW, shadow: true });
  });

  afterAll(async () => {
    await wipe();
    await supabase.from('organizations').delete().eq('id', ORG);
  });

  it('financial: revenue + new_customers count only the live lead', async () => {
    const fin = await callFinancial();
    // Only the normal lead's sale survives; trashed 5000 + shadow 7000 dropped.
    expect(Number(fin.total_revenue)).toBe(SALE_NORMAL);
    expect(Number(fin.new_customers)).toBe(1);
  });

  it('overview: origin attribution counts only the live lead', async () => {
    const ov = await callOverview();
    const attribution = (ov.attribution ?? []) as Array<{
      origin: string;
      lead_count: number;
      revenue: number;
    }>;
    const row = attribution.find((r) => r.origin === ORIGIN);
    expect(row).toBeDefined();
    // Trashed + shadow leads (and their sales) must not inflate the origin.
    expect(Number(row!.lead_count)).toBe(1);
    expect(Number(row!.revenue)).toBe(SALE_NORMAL);
  });
});
