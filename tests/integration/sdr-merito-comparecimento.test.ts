/**
 * Integration tests — meeting attendance credit goes to SDR only.
 *
 * Business rule
 * -------------
 *   pre_sale_responsible_id (fallback sdr_id) → meeting credit (SDR)
 *   sale_responsible_id     (fallback closer_id, responsible_id) → sale credit
 *
 * RPC under test:
 *   public.get_ranking_data(p_month INT, p_year INT, p_organization_id UUID)
 *     → meetingsRanking[*].meetings = COUNT of stage_key='compareceu' entries
 *       attributed to the member via COALESCE(pre_sale_responsible_id, sdr_id).
 *
 * Covered scenarios
 * -----------------
 *   1. Meeting with pre_sale=SDR_A and sale=CLOSER_B → credit goes to SDR_A,
 *      CLOSER_B receives nothing in meetingsRanking.
 *   2. Meeting with pre_sale=NULL but sdr_id=SDR_A → still credited to SDR_A.
 *   3. Meeting with pre_sale=NULL AND sdr_id=NULL → falls in the
 *      "sem SDR" bucket: neither SDR_A nor CLOSER_B receives credit.
 *   4. Two meetings for the same SDR are deduplicated when both dual and
 *      legacy ids resolve to the same member (no double counting).
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  supabase,
  TEST_ORG_ID,
} from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Pinned month/year so the test does not race other data in seed.
const TEST_MONTH = 7;
const TEST_YEAR = 2099;
const PERIOD_AT = `${TEST_YEAR}-0${TEST_MONTH}-15T12:00:00Z`;

describe.skipIf(shouldSkip)('SDR mérito comparecimento — get_ranking_data', () => {
  // Ids reused across the suite
  let sdrA: string;
  let closerB: string;
  let leadIds: string[] = [];
  let entryIds: string[] = [];

  beforeAll(async () => {
    // Create dedicated SDR and Closer team members for this suite (isolated)
    sdrA = randomUUID();
    closerB = randomUUID();

    const tmInsert = await supabase.from('team_members').insert([
      {
        id: sdrA,
        organization_id: TEST_ORG_ID,
        role: 'membro',
        name: 'SDR Test A',
        email: `sdr-test-${sdrA.slice(0, 8)}@test.com`,
        is_active: true,
        metric_type: 'meetings',
        job_title: 'SDR',
      },
      {
        id: closerB,
        organization_id: TEST_ORG_ID,
        role: 'membro',
        name: 'Closer Test B',
        email: `closer-test-${closerB.slice(0, 8)}@test.com`,
        is_active: true,
        metric_type: 'meetings', // we expect closer to NOT show up; using 'meetings' makes the check stricter
        job_title: 'Closer',
      },
    ]);
    expect(tmInsert.error).toBeNull();

    // Locate the system 'confirmacao' pipeline for this org. Created by seed via
    // org bootstrap; if missing the test fails fast.
    const { data: pipeline, error: pipelineErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('organization_id', TEST_ORG_ID)
      .eq('slug', 'confirmacao')
      .eq('type', 'system')
      .maybeSingle();

    if (pipelineErr) throw pipelineErr;
    if (!pipeline) {
      throw new Error(
        'Seed missing: system pipeline slug=confirmacao for TEST_ORG_ID. ' +
        'Run `supabase db reset` with full seed applied.'
      );
    }
    const pipelineId = pipeline.id;

    // Helper: create a lead + pipeline_entry with the given metadata
    const createMeeting = async (
      name: string,
      meta: Record<string, unknown>,
    ): Promise<{ leadId: string; entryId: string }> => {
      const leadRes = await supabase
        .from('leads')
        .insert({
          name,
          phone: `+55119${Math.floor(Math.random() * 90000000 + 10000000)}`,
          organization_id: TEST_ORG_ID,
        })
        .select('id')
        .single();
      expect(leadRes.error).toBeNull();
      const leadId = leadRes.data!.id as string;

      const entryRes = await supabase
        .from('pipeline_entries')
        .insert({
          lead_id: leadId,
          organization_id: TEST_ORG_ID,
          pipeline_id: pipelineId,
          stage_key: 'compareceu',
          metadata: {
            meeting_date: PERIOD_AT,
            metrics_period_at: PERIOD_AT,
            ...meta,
          },
        })
        .select('id')
        .single();
      expect(entryRes.error).toBeNull();
      const entryId = entryRes.data!.id as string;
      return { leadId, entryId };
    };

    // Case 1: pre_sale=SDR_A + sale=CLOSER_B → only SDR_A
    const c1 = await createMeeting('SDR-merito Case 1', {
      pre_sale_responsible_id: sdrA,
      sale_responsible_id: closerB,
      sdr_id: sdrA,
      closer_id: closerB,
      responsible_id: closerB,
    });

    // Case 2: pre_sale=NULL, sdr_id=SDR_A, closer=CLOSER_B (fallback path)
    const c2 = await createMeeting('SDR-merito Case 2', {
      sdr_id: sdrA,
      closer_id: closerB,
      responsible_id: closerB,
    });

    // Case 3: pre_sale=NULL, sdr_id=NULL, closer=CLOSER_B (sem SDR bucket)
    const c3 = await createMeeting('SDR-merito Case 3', {
      closer_id: closerB,
      responsible_id: closerB,
    });

    // Case 4: duplicate-style — pre_sale=SDR_A AND sdr_id=SDR_A (no double count)
    const c4 = await createMeeting('SDR-merito Case 4', {
      pre_sale_responsible_id: sdrA,
      sdr_id: sdrA,
      closer_id: closerB,
    });

    leadIds = [c1.leadId, c2.leadId, c3.leadId, c4.leadId];
    entryIds = [c1.entryId, c2.entryId, c3.entryId, c4.entryId];
  });

  afterAll(async () => {
    if (entryIds.length > 0) {
      await supabase.from('pipeline_entries').delete().in('id', entryIds);
    }
    if (leadIds.length > 0) {
      await supabase.from('leads').delete().in('id', leadIds);
    }
    if (sdrA) await supabase.from('team_members').delete().eq('id', sdrA);
    if (closerB) await supabase.from('team_members').delete().eq('id', closerB);
  });

  it('attributes meeting credit exclusively to the SDR (pre_sale_responsible_id)', async () => {
    const { data, error } = await supabase.rpc('get_ranking_data', {
      p_month: TEST_MONTH,
      p_year: TEST_YEAR,
      p_organization_id: TEST_ORG_ID,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const meetingsRanking = (data as any).meetingsRanking as Array<{
      id: string;
      meetings: number;
      name: string;
    }>;

    const sdrRow = meetingsRanking.find((r) => r.id === sdrA);
    const closerRow = meetingsRanking.find((r) => r.id === closerB);

    // SDR A receives credit for cases 1, 2 and 4 → 3 meetings
    expect(sdrRow).toBeDefined();
    expect(sdrRow!.meetings).toBe(3);

    // Closer B is a meetings-typed member here so they DO appear in the ranking,
    // but with ZERO meetings because no compareceu entry has pre_sale or sdr
    // pointing to closerB.
    expect(closerRow).toBeDefined();
    expect(closerRow!.meetings).toBe(0);
  });

  it('drops meetings with NULL pre_sale_responsible_id AND NULL sdr_id (sem SDR bucket)', async () => {
    const { data, error } = await supabase.rpc('get_ranking_data', {
      p_month: TEST_MONTH,
      p_year: TEST_YEAR,
      p_organization_id: TEST_ORG_ID,
    });

    expect(error).toBeNull();
    const meetingsRanking = (data as any).meetingsRanking as Array<{
      id: string;
      meetings: number;
    }>;

    // Cases 1+2+4 credit SDR_A (3 meetings); case 3 has neither dual nor sdr_id
    // and is NOT credited to anyone (sem SDR). Closer B must have 0.
    const totalMeetingsForSeededMembers = meetingsRanking
      .filter((r) => r.id === sdrA || r.id === closerB)
      .reduce((sum, r) => sum + r.meetings, 0);

    expect(totalMeetingsForSeededMembers).toBe(3);
  });

  it('does NOT fall back to responsible_id (which often holds the closer)', async () => {
    // All 4 cases set responsible_id = closer_B (case 4 omits it). If the RPC
    // were falling back to responsible_id, closerB would receive credit from
    // case 3 (where pre_sale and sdr_id are both NULL but responsible_id is set).
    const { data, error } = await supabase.rpc('get_ranking_data', {
      p_month: TEST_MONTH,
      p_year: TEST_YEAR,
      p_organization_id: TEST_ORG_ID,
    });

    expect(error).toBeNull();
    const meetingsRanking = (data as any).meetingsRanking as Array<{
      id: string;
      meetings: number;
    }>;
    const closerRow = meetingsRanking.find((r) => r.id === closerB);
    expect(closerRow?.meetings ?? 0).toBe(0);
  });
});
