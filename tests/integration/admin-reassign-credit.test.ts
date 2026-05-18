/**
 * Integration tests — `admin_reassign_meeting_credit` and
 * `admin_reassign_sale_credit` RPCs (PRD #211 / slice S2 / issue #213).
 *
 * Business rule
 * -------------
 * After the `snapshot_responsible_from_lead` trigger has frozen
 * `metadata.pre_sale_responsible_id` / `metadata.sale_responsible_id` on a
 * pipeline_entries row, the only sanctioned way to mutate that snapshot is
 * through these two RPCs:
 *
 *   - admin_reassign_meeting_credit(entry_id, new_sdr_id, reason)
 *       Updates metadata.pre_sale_responsible_id on a `confirmacao` entry.
 *   - admin_reassign_sale_credit(entry_id, new_closer_id, reason)
 *       Updates metadata.sale_responsible_id on a `propostas` entry.
 *
 * Both require the caller to be admin/master of the entry's organization,
 * both require a non-empty `reason`, both audit the change in
 * `lead_history` (action='credit_reassigned', metric_type='meeting' or 'sale').
 *
 * Covered scenarios per acceptance criteria
 * -----------------------------------------
 *   1. admin caller succeeds → metadata mutated + audit written.
 *   2. master caller succeeds (global master_users.is_active=true).
 *   3. membro caller rejected with 42501 / insufficient_privilege; nothing
 *      changes in metadata or lead_history.
 *   4. cross-org admin (admin of Org B) rejected operating on Org A entry.
 *   5. new_sdr_id from another org rejected (23503 / invalid_team_member).
 *   6. inactive team_member rejected.
 *   7. empty / null / whitespace-only reason rejected (22023 / reason_required).
 *   8. `admin_reassign_sale_credit` mirrors the same checks on a `propostas`
 *      entry.
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  supabase,
  TEST_ORG_ID,
  TEST_ORG_B_ID,
  TEST_TM_ADMIN_ID,
  TEST_TM_MEMBER_1_ID,
  TEST_TM_ADMIN_B_ID,
  TEST_TM_MASTER_ID,
} from './setup';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgBAdmin,
  getMaster,
  clearClients,
} from './rls-helpers';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const PERIOD_AT = '2099-09-15T12:00:00Z';

describe.skipIf(shouldSkip)('admin_reassign_*_credit RPCs', () => {
  // Synthetic team members owned by this suite (besides the seeded ones above).
  let sdrSource: string;       // active SDR in Org A — initial credit holder
  let sdrTarget: string;       // active SDR in Org A — target of valid reassign
  let sdrInactive: string;     // inactive SDR in Org A
  let sdrOrgB: string;         // active SDR in Org B — wrong org
  let closerSource: string;    // active Closer in Org A
  let closerTarget: string;    // active Closer in Org A
  let closerOrgB: string;      // active Closer in Org B

  let confirmacaoPipelineId: string;
  let propostasPipelineId: string;

  const createdLeadIds: string[] = [];
  const createdEntryIds: string[] = [];

  async function createLead(
    name: string,
    opts: {
      pre_sale_responsible_id?: string | null;
      sale_responsible_id?: string | null;
      organization_id?: string;
    } = {},
  ): Promise<string> {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name,
        phone: `+5511${Math.floor(Math.random() * 900000000 + 100000000)}`,
        organization_id: opts.organization_id ?? TEST_ORG_ID,
        pre_sale_responsible_id: opts.pre_sale_responsible_id ?? null,
        sale_responsible_id: opts.sale_responsible_id ?? null,
      })
      .select('id')
      .single();
    expect(error, `lead insert error: ${error?.message}`).toBeNull();
    const id = data!.id as string;
    createdLeadIds.push(id);
    return id;
  }

  async function createConfirmacaoEntry(
    leadId: string,
    organizationId: string = TEST_ORG_ID,
    pipelineId: string = confirmacaoPipelineId,
  ): Promise<string> {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .insert({
        lead_id: leadId,
        organization_id: organizationId,
        pipeline_id: pipelineId,
        stage_key: 'reuniao_marcada',
        metadata: { meeting_date: PERIOD_AT, metrics_period_at: PERIOD_AT },
      })
      .select('id')
      .single();
    expect(error, `confirmacao insert error: ${error?.message}`).toBeNull();
    const id = data!.id as string;
    createdEntryIds.push(id);
    return id;
  }

  async function createPropostasEntry(
    leadId: string,
  ): Promise<string> {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .insert({
        lead_id: leadId,
        organization_id: TEST_ORG_ID,
        pipeline_id: propostasPipelineId,
        stage_key: 'proposta_enviada',
        metadata: { metrics_period_at: PERIOD_AT },
      })
      .select('id')
      .single();
    expect(error, `propostas insert error: ${error?.message}`).toBeNull();
    const id = data!.id as string;
    createdEntryIds.push(id);
    return id;
  }

  async function readMetadata(entryId: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('metadata')
      .eq('id', entryId)
      .single();
    expect(error).toBeNull();
    return (data!.metadata as Record<string, unknown>) || {};
  }

  async function countAuditRows(leadId: string): Promise<number> {
    const { count, error } = await supabase
      .from('lead_history')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .eq('action', 'credit_reassigned');
    expect(error).toBeNull();
    return count ?? 0;
  }

  beforeAll(async () => {
    sdrSource = randomUUID();
    sdrTarget = randomUUID();
    sdrInactive = randomUUID();
    sdrOrgB = randomUUID();
    closerSource = randomUUID();
    closerTarget = randomUUID();
    closerOrgB = randomUUID();

    const { error: tmErr } = await supabase.from('team_members').insert([
      {
        id: sdrSource, organization_id: TEST_ORG_ID, role: 'membro',
        name: 'Reassign SDR source', email: `r-sdr-src-${sdrSource.slice(0, 8)}@test.com`,
        is_active: true, metric_type: 'meetings', job_title: 'SDR',
      },
      {
        id: sdrTarget, organization_id: TEST_ORG_ID, role: 'membro',
        name: 'Reassign SDR target', email: `r-sdr-tgt-${sdrTarget.slice(0, 8)}@test.com`,
        is_active: true, metric_type: 'meetings', job_title: 'SDR',
      },
      {
        id: sdrInactive, organization_id: TEST_ORG_ID, role: 'membro',
        name: 'Reassign SDR inactive', email: `r-sdr-ina-${sdrInactive.slice(0, 8)}@test.com`,
        is_active: false, metric_type: 'meetings', job_title: 'SDR',
      },
      {
        id: sdrOrgB, organization_id: TEST_ORG_B_ID, role: 'membro',
        name: 'Reassign SDR orgB', email: `r-sdr-orgb-${sdrOrgB.slice(0, 8)}@test.com`,
        is_active: true, metric_type: 'meetings', job_title: 'SDR',
      },
      {
        id: closerSource, organization_id: TEST_ORG_ID, role: 'membro',
        name: 'Reassign Closer source', email: `r-clo-src-${closerSource.slice(0, 8)}@test.com`,
        is_active: true, metric_type: 'sales', job_title: 'Closer',
      },
      {
        id: closerTarget, organization_id: TEST_ORG_ID, role: 'membro',
        name: 'Reassign Closer target', email: `r-clo-tgt-${closerTarget.slice(0, 8)}@test.com`,
        is_active: true, metric_type: 'sales', job_title: 'Closer',
      },
      {
        id: closerOrgB, organization_id: TEST_ORG_B_ID, role: 'membro',
        name: 'Reassign Closer orgB', email: `r-clo-orgb-${closerOrgB.slice(0, 8)}@test.com`,
        is_active: true, metric_type: 'sales', job_title: 'Closer',
      },
    ]);
    expect(tmErr, `team_members insert error: ${tmErr?.message}`).toBeNull();

    const { data: confPipe, error: confErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('organization_id', TEST_ORG_ID)
      .eq('slug', 'confirmacao')
      .eq('type', 'system')
      .maybeSingle();
    if (confErr) throw confErr;
    if (!confPipe) throw new Error('Seed missing: confirmacao pipeline in TEST_ORG_ID.');
    confirmacaoPipelineId = confPipe.id;

    const { data: propPipe, error: propErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('organization_id', TEST_ORG_ID)
      .eq('slug', 'propostas')
      .eq('type', 'system')
      .maybeSingle();
    if (propErr) throw propErr;
    if (!propPipe) throw new Error('Seed missing: propostas pipeline in TEST_ORG_ID.');
    propostasPipelineId = propPipe.id;
  });

  afterAll(async () => {
    if (createdEntryIds.length > 0) {
      // Clean up the audit rows we generated too.
      await supabase.from('lead_history').delete().in('entity_id', createdEntryIds);
      await supabase.from('pipeline_entries').delete().in('id', createdEntryIds);
    }
    if (createdLeadIds.length > 0) {
      await supabase.from('leads').delete().in('id', createdLeadIds);
    }
    for (const id of [sdrSource, sdrTarget, sdrInactive, sdrOrgB, closerSource, closerTarget, closerOrgB]) {
      if (id) await supabase.from('team_members').delete().eq('id', id);
    }
    await clearClients();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1 — admin caller successfully reassigns meeting credit.
  // ──────────────────────────────────────────────────────────────────────────
  it('admin reassigns meeting credit → metadata mutated + audit logged', async () => {
    const leadId = await createLead('S1 — admin happy path', {
      pre_sale_responsible_id: sdrSource,
    });
    const entryId = await createConfirmacaoEntry(leadId);

    // Trigger pre-populated metadata with sdrSource.
    const before = await readMetadata(entryId);
    expect(before.pre_sale_responsible_id).toBe(sdrSource);

    const auditBefore = await countAuditRows(leadId);

    const admin = await getOrgAAdmin();
    const { data, error } = await admin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: 'Atribuição inicial errada, era do colega Y.',
    });
    expect(error, `RPC failed: ${error?.message}`).toBeNull();
    expect(data).toMatchObject({
      ok: true,
      entry_id: entryId,
      metric_type: 'meeting',
      before: sdrSource,
      after: sdrTarget,
    });

    const after = await readMetadata(entryId);
    expect(after.pre_sale_responsible_id).toBe(sdrTarget);

    const auditAfter = await countAuditRows(leadId);
    expect(auditAfter).toBe(auditBefore + 1);

    const { data: history } = await supabase
      .from('lead_history')
      .select('action, metadata, entity_type, entity_id, source')
      .eq('lead_id', leadId)
      .eq('action', 'credit_reassigned')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(history?.entity_type).toBe('pipeline_entry');
    expect(history?.entity_id).toBe(entryId);
    expect(history?.source).toBe('manual');
    const meta = history?.metadata as Record<string, unknown>;
    expect(meta.metric_type).toBe('meeting');
    expect(meta.before).toBe(sdrSource);
    expect(meta.after).toBe(sdrTarget);
    expect(meta.entry_id).toBe(entryId);
    expect(typeof meta.reason).toBe('string');
    expect((meta.reason as string).length).toBeGreaterThan(0);
    expect(meta.actor_user_id).toBeDefined();
    expect(meta.rpc).toBe('admin_reassign_meeting_credit');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2 — global master_users entry also passes the permission check.
  // ──────────────────────────────────────────────────────────────────────────
  it('master_users caller reassigns meeting credit successfully', async () => {
    const leadId = await createLead('S2 — master happy path', {
      pre_sale_responsible_id: sdrSource,
    });
    const entryId = await createConfirmacaoEntry(leadId);

    const master = await getMaster();
    const { data, error } = await master.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: 'Master adjusting after support ticket.',
    });
    expect(error, `master RPC failed: ${error?.message}`).toBeNull();
    expect((data as Record<string, unknown>).after).toBe(sdrTarget);

    const after = await readMetadata(entryId);
    expect(after.pre_sale_responsible_id).toBe(sdrTarget);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3 — membro caller is rejected and nothing changes.
  // ──────────────────────────────────────────────────────────────────────────
  it('membro caller rejected — metadata and audit unchanged', async () => {
    const leadId = await createLead('S3 — membro denied', {
      pre_sale_responsible_id: sdrSource,
    });
    const entryId = await createConfirmacaoEntry(leadId);

    const auditBefore = await countAuditRows(leadId);
    const metaBefore = await readMetadata(entryId);

    const member = await getOrgAMember1();
    const { error } = await member.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: 'I want to take credit.',
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('insufficient_privilege');

    const metaAfter = await readMetadata(entryId);
    expect(metaAfter.pre_sale_responsible_id).toBe(metaBefore.pre_sale_responsible_id);

    const auditAfter = await countAuditRows(leadId);
    expect(auditAfter).toBe(auditBefore);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4 — admin of another org cannot reassign credit cross-tenant.
  // ──────────────────────────────────────────────────────────────────────────
  it('cross-org admin rejected on Org A entry', async () => {
    const leadId = await createLead('S4 — cross-org admin', {
      pre_sale_responsible_id: sdrSource,
    });
    const entryId = await createConfirmacaoEntry(leadId);

    const orgBAdmin = await getOrgBAdmin();
    const { error } = await orgBAdmin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: 'Trying to reassign in another org.',
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('insufficient_privilege');

    const meta = await readMetadata(entryId);
    expect(meta.pre_sale_responsible_id).toBe(sdrSource);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5 — passing a team_member from another org is rejected.
  // ──────────────────────────────────────────────────────────────────────────
  it('new_sdr_id from another org rejected — invalid_team_member', async () => {
    const leadId = await createLead('S5 — wrong-org target', {
      pre_sale_responsible_id: sdrSource,
    });
    const entryId = await createConfirmacaoEntry(leadId);

    const admin = await getOrgAAdmin();
    const { error } = await admin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrOrgB,
      p_reason: 'Reason that should never apply.',
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('invalid_team_member');

    const meta = await readMetadata(entryId);
    expect(meta.pre_sale_responsible_id).toBe(sdrSource);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6 — inactive team_member rejected.
  // ──────────────────────────────────────────────────────────────────────────
  it('inactive team_member rejected — invalid_team_member', async () => {
    const leadId = await createLead('S6 — inactive target', {
      pre_sale_responsible_id: sdrSource,
    });
    const entryId = await createConfirmacaoEntry(leadId);

    const admin = await getOrgAAdmin();
    const { error } = await admin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrInactive,
      p_reason: 'Reason that should never apply.',
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('invalid_team_member');

    const meta = await readMetadata(entryId);
    expect(meta.pre_sale_responsible_id).toBe(sdrSource);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 7 — reason must be non-empty and non-whitespace.
  // ──────────────────────────────────────────────────────────────────────────
  it('empty / null / whitespace-only reason rejected', async () => {
    const leadId = await createLead('S7 — bad reason', {
      pre_sale_responsible_id: sdrSource,
    });
    const entryId = await createConfirmacaoEntry(leadId);

    const admin = await getOrgAAdmin();

    const r1 = await admin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: '',
    });
    expect(r1.error?.message ?? '').toContain('reason_required');

    const r2 = await admin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: '   ',
    });
    expect(r2.error?.message ?? '').toContain('reason_required');

    const r3 = await admin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: null as unknown as string,
    });
    expect(r3.error?.message ?? '').toContain('reason_required');

    const meta = await readMetadata(entryId);
    expect(meta.pre_sale_responsible_id).toBe(sdrSource);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 8 — `admin_reassign_sale_credit` mirrors the rules on `propostas`.
  // ──────────────────────────────────────────────────────────────────────────
  it('admin_reassign_sale_credit happy path + membro denied + reason guard', async () => {
    const leadId = await createLead('S8 — sale reassign', {
      sale_responsible_id: closerSource,
    });
    const entryId = await createPropostasEntry(leadId);

    const before = await readMetadata(entryId);
    expect(before.sale_responsible_id).toBe(closerSource);

    // Happy path
    const admin = await getOrgAAdmin();
    const { data, error } = await admin.rpc('admin_reassign_sale_credit', {
      p_entry_id: entryId,
      p_new_closer_id: closerTarget,
      p_reason: 'Splitting commission with new closer per CTO decision.',
    });
    expect(error, `RPC failed: ${error?.message}`).toBeNull();
    expect(data).toMatchObject({
      ok: true,
      entry_id: entryId,
      metric_type: 'sale',
      before: closerSource,
      after: closerTarget,
    });
    const after = await readMetadata(entryId);
    expect(after.sale_responsible_id).toBe(closerTarget);

    // Audit row present with metric_type=sale
    const { data: hist } = await supabase
      .from('lead_history')
      .select('metadata, action')
      .eq('lead_id', leadId)
      .eq('action', 'credit_reassigned')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const histMeta = hist?.metadata as Record<string, unknown>;
    expect(histMeta.metric_type).toBe('sale');
    expect(histMeta.rpc).toBe('admin_reassign_sale_credit');

    // Membro caller blocked
    const member = await getOrgAMember1();
    const r = await member.rpc('admin_reassign_sale_credit', {
      p_entry_id: entryId,
      p_new_closer_id: closerSource,
      p_reason: 'Trying to swap back.',
    });
    expect(r.error?.message ?? '').toContain('insufficient_privilege');

    // Cross-org closer rejected
    const r2 = await admin.rpc('admin_reassign_sale_credit', {
      p_entry_id: entryId,
      p_new_closer_id: closerOrgB,
      p_reason: 'Cross-org closer attempt.',
    });
    expect(r2.error?.message ?? '').toContain('invalid_team_member');

    // Empty reason rejected
    const r3 = await admin.rpc('admin_reassign_sale_credit', {
      p_entry_id: entryId,
      p_new_closer_id: closerSource,
      p_reason: '',
    });
    expect(r3.error?.message ?? '').toContain('reason_required');

    const final = await readMetadata(entryId);
    expect(final.sale_responsible_id).toBe(closerTarget);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 9 — meeting RPC on a `propostas` entry rejected (wrong pipe).
  // ──────────────────────────────────────────────────────────────────────────
  it('meeting RPC on propostas entry rejected — invalid_entry_pipe', async () => {
    const leadId = await createLead('S9 — wrong pipe target', {
      sale_responsible_id: closerSource,
    });
    const entryId = await createPropostasEntry(leadId);

    const admin = await getOrgAAdmin();
    const { error } = await admin.rpc('admin_reassign_meeting_credit', {
      p_entry_id: entryId,
      p_new_sdr_id: sdrTarget,
      p_reason: 'Should fail — wrong pipe.',
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('invalid_entry_pipe');
  });

  // Reference seeded ids so eslint does not flag the imports as unused if a
  // future maintainer trims a scenario.
  it('seeded ids resolve (smoke)', () => {
    expect(TEST_TM_ADMIN_ID).toBeTruthy();
    expect(TEST_TM_MEMBER_1_ID).toBeTruthy();
    expect(TEST_TM_ADMIN_B_ID).toBeTruthy();
    expect(TEST_TM_MASTER_ID).toBeTruthy();
  });
});
