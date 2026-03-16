/**
 * Integration tests for Job Tracker against local Supabase.
 *
 * Requires local Supabase (`supabase start`).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { supabase, TEST_ORG_ID } from './setup';
import { startJob, finishJob, failJob } from '../../supabase/functions/_shared/job-tracker';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const createdJobIds: string[] = [];

describe.skipIf(shouldSkip)('Job Tracker — integration', () => {
  afterAll(async () => {
    for (const id of createdJobIds) {
      await supabase.from('automation_jobs').delete().eq('id', id);
    }
  });

  it('startJob inserts a job with status "running"', async () => {
    const jobId = await startJob(supabase as any, {
      organizationId: TEST_ORG_ID,
      sourceEngine: 'workflow',
      entityType: 'lead',
      entityId: '00000000-0000-0000-0000-000000001001',
      actionType: 'add_tag',
    });

    expect(jobId).not.toBeNull();
    if (jobId) createdJobIds.push(jobId);

    const { data } = await supabase
      .from('automation_jobs')
      .select('status')
      .eq('id', jobId!)
      .single();

    expect(data?.status).toBe('running');
  });

  it('finishJob updates to "success"', async () => {
    const jobId = await startJob(supabase as any, {
      organizationId: TEST_ORG_ID,
      sourceEngine: 'workflow',
      entityType: 'lead',
      entityId: '00000000-0000-0000-0000-000000001001',
      actionType: 'send_message',
    });

    expect(jobId).not.toBeNull();
    if (jobId) createdJobIds.push(jobId);

    await finishJob(supabase as any, jobId!);

    const { data } = await supabase
      .from('automation_jobs')
      .select('status, finished_at')
      .eq('id', jobId!)
      .single();

    expect(data?.status).toBe('success');
    expect(data?.finished_at).not.toBeNull();
  });

  it('failJob 3x promotes to dead_letter', async () => {
    const jobId = await startJob(supabase as any, {
      organizationId: TEST_ORG_ID,
      sourceEngine: 'workflow',
      entityType: 'lead',
      entityId: '00000000-0000-0000-0000-000000001001',
      actionType: 'webhook',
      maxRetries: 3,
    });

    expect(jobId).not.toBeNull();
    if (jobId) createdJobIds.push(jobId);

    // Fail 3 times
    await failJob(supabase as any, jobId!, 'Error 1');
    await failJob(supabase as any, jobId!, 'Error 2');
    await failJob(supabase as any, jobId!, 'Error 3');

    const { data } = await supabase
      .from('automation_jobs')
      .select('status, retry_count')
      .eq('id', jobId!)
      .single();

    expect(data?.status).toBe('dead_letter');
    expect(data?.retry_count).toBeGreaterThanOrEqual(3);
  });
});
