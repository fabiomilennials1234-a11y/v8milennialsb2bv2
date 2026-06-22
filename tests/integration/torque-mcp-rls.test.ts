/**
 * Torque MCP — RLS-inherited security anchor (docs/adr/0011).
 *
 * The MCP authenticates as a real master user and queries with RLS ON. This
 * proves the architecture: a master sees data cross-org (via master-ghost
 * policies), a non-master admin stays scoped to its own org — and it validates
 * the master-ghost migration (20261222000000) on pipeline_entries.
 *
 * Runs in CI `integration-tests` (local Supabase + seed + migrations applied).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient, getMaster, getOrgAAdmin, getOrgBAdmin } from './rls-helpers';

const ORG_B = '00000000-0000-0000-0000-000000000002';
const BUDGET_DATE = '2099-01-01'; // far-future date → no collision with real usage rows

describe('torque-mcp: RLS-inherited master visibility', () => {
  const svc = createServiceClient();
  let leadId: string;
  let pipelineId: string;
  let entryId: string;

  beforeAll(async () => {
    const { data: lead, error: le } = await svc
      .from('leads')
      .insert({ organization_id: ORG_B, name: 'MCP RLS Probe' })
      .select('id')
      .single();
    if (le) throw new Error(`seed lead: ${le.message}`);
    leadId = lead.id;

    const { data: pipe, error: pe } = await svc
      .from('pipelines')
      .insert({
        organization_id: ORG_B,
        name: 'MCP Probe',
        slug: `mcp_probe_${leadId.slice(0, 8)}`,
        type: 'custom',
      })
      .select('id')
      .single();
    if (pe) throw new Error(`seed pipeline: ${pe.message}`);
    pipelineId = pipe.id;

    const { data: entry, error: ee } = await svc
      .from('pipeline_entries')
      .insert({ organization_id: ORG_B, pipeline_id: pipelineId, lead_id: leadId, stage_key: 'novo' })
      .select('id')
      .single();
    if (ee) throw new Error(`seed pipeline_entry: ${ee.message}`);
    entryId = entry.id;

    // Row in a table whose master-ghost policy is ADDED by migration 20261222000000.
    const { error: be } = await svc
      .from('blast_daily_usage')
      .insert({ organization_id: ORG_B, usage_date: BUDGET_DATE, leads_sent: 1 });
    if (be) throw new Error(`seed blast_daily_usage: ${be.message}`);
  });

  afterAll(async () => {
    if (entryId) await svc.from('pipeline_entries').delete().eq('id', entryId);
    if (pipelineId) await svc.from('pipelines').delete().eq('id', pipelineId);
    if (leadId) await svc.from('leads').delete().eq('id', leadId);
    await svc.from('blast_daily_usage').delete().eq('organization_id', ORG_B).eq('usage_date', BUDGET_DATE);
  });

  it('master reads an Org B lead cross-org; an Org A admin cannot', async () => {
    const master = await getMaster();
    const adminA = await getOrgAAdmin();

    const { data: m } = await master.from('leads').select('id').eq('id', leadId).maybeSingle();
    expect(m?.id).toBe(leadId);

    const { data: a } = await adminA.from('leads').select('id').eq('id', leadId).maybeSingle();
    expect(a).toBeNull();
  });

  it('master reads an Org B pipeline_entry cross-org (master-ghost migration); Org A admin cannot', async () => {
    const master = await getMaster();
    const adminA = await getOrgAAdmin();

    const { data: m } = await master
      .from('pipeline_entries')
      .select('id')
      .eq('id', entryId)
      .maybeSingle();
    expect(m?.id).toBe(entryId); // pre-existing master_select_all_pipeline_entries (20260509010000)

    const { data: a } = await adminA
      .from('pipeline_entries')
      .select('id')
      .eq('id', entryId)
      .maybeSingle();
    expect(a).toBeNull();
  });

  it('Org B admin reads its own pipeline_entry — baseline org RLS intact', async () => {
    const adminB = await getOrgBAdmin();
    const { data } = await adminB
      .from('pipeline_entries')
      .select('id')
      .eq('id', entryId)
      .maybeSingle();
    expect(data?.id).toBe(entryId);
  });

  it('master reads an Org B blast_daily_usage row cross-org (NEW migration 20261222000000); Org A admin cannot', async () => {
    const master = await getMaster();
    const adminA = await getOrgAAdmin();

    const { data: m } = await master
      .from('blast_daily_usage')
      .select('organization_id')
      .eq('organization_id', ORG_B)
      .eq('usage_date', BUDGET_DATE)
      .maybeSingle();
    expect(m?.organization_id).toBe(ORG_B); // master_select_all_blast_daily_usage (added by migration)

    const { data: a } = await adminA
      .from('blast_daily_usage')
      .select('organization_id')
      .eq('organization_id', ORG_B)
      .eq('usage_date', BUDGET_DATE)
      .maybeSingle();
    expect(a).toBeNull();
  });
});
