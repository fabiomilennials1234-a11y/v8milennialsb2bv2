import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startJob, finishJob, failJob } from '../../supabase/functions/_shared/job-tracker';

// ─── Supabase mock builder ──────────────────────────────

function createMockSupabase(overrides: {
  insertResult?: { data: unknown; error: unknown };
  selectResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
} = {}) {
  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue(overrides.updateResult ?? { data: null, error: null }),
  });

  const singleFn = vi.fn().mockResolvedValue(
    overrides.selectResult ?? { data: null, error: null },
  );

  const selectAfterInsertFn = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue(
      overrides.insertResult ?? { data: { id: 'job-123' }, error: null },
    ),
  });

  const selectFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: singleFn,
    }),
  });

  const insertFn = vi.fn().mockReturnValue({
    select: selectAfterInsertFn,
  });

  const mock = {
    from: vi.fn().mockReturnValue({
      insert: insertFn,
      update: updateFn,
      select: selectFn,
    }),
    _insertFn: insertFn,
    _updateFn: updateFn,
    _selectFn: selectFn,
  };

  return mock;
}

const defaultParams = {
  organizationId: 'org-1',
  sourceEngine: 'workflow' as const,
  entityType: 'lead',
  entityId: 'lead-1',
  actionType: 'add_tag',
};

describe('job-tracker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('startJob', () => {
    it('inserts job with status "running" and returns job id', async () => {
      const sb = createMockSupabase({
        insertResult: { data: { id: 'job-abc' }, error: null },
      });

      const result = await startJob(sb as any, defaultParams);
      expect(result).toBe('job-abc');
      expect(sb.from).toHaveBeenCalledWith('automation_jobs');
    });

    it('returns null if insert fails', async () => {
      const sb = createMockSupabase({
        insertResult: { data: null, error: { message: 'insert error' } },
      });

      const result = await startJob(sb as any, defaultParams);
      expect(result).toBeNull();
    });

    it('returns null if supabase throws exception', async () => {
      const sb = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('connection failed');
        }),
      };

      const result = await startJob(sb as any, defaultParams);
      expect(result).toBeNull();
    });
  });

  describe('finishJob', () => {
    it('updates job to status "success" with finished_at', async () => {
      const capturedUpdate: Record<string, unknown> = {};
      const eqFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateFn = vi.fn().mockImplementation((data) => {
        Object.assign(capturedUpdate, data);
        return { eq: eqFn };
      });

      const sb = {
        from: vi.fn().mockReturnValue({ update: updateFn }),
      };

      await finishJob(sb as any, 'job-123');

      expect(sb.from).toHaveBeenCalledWith('automation_jobs');
      expect(capturedUpdate.status).toBe('success');
      expect(capturedUpdate.finished_at).toBeDefined();
    });

    it('does not throw if supabase throws', async () => {
      const sb = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('connection failed');
        }),
      };

      await expect(finishJob(sb as any, 'job-123')).resolves.toBeUndefined();
    });
  });

  describe('failJob', () => {
    it('retry_count 0 → sets status retrying with backoff ~1min', async () => {
      const capturedUpdate: Record<string, unknown> = {};
      const eqAfterUpdate = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateFn = vi.fn().mockImplementation((data) => {
        Object.assign(capturedUpdate, data);
        return { eq: eqAfterUpdate };
      });

      const eqAfterSelect = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { retry_count: 0, max_retries: 3 },
          error: null,
        }),
      });

      const sb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ eq: eqAfterSelect }),
          update: updateFn,
        }),
      };

      const before = Date.now();
      await failJob(sb as any, 'job-1', 'timeout');

      expect(capturedUpdate.status).toBe('retrying');
      expect(capturedUpdate.retry_count).toBe(1);
      expect(capturedUpdate.error_message).toBe('timeout');

      const nextRetryAt = new Date(capturedUpdate.next_retry_at as string).getTime();
      // backoff = 1 min = 60000ms
      expect(nextRetryAt).toBeGreaterThanOrEqual(before + 55_000);
      expect(nextRetryAt).toBeLessThanOrEqual(before + 65_000);
    });

    it('retry_count 1 → sets status retrying with backoff ~5min', async () => {
      const capturedUpdate: Record<string, unknown> = {};
      const eqAfterUpdate = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateFn = vi.fn().mockImplementation((data) => {
        Object.assign(capturedUpdate, data);
        return { eq: eqAfterUpdate };
      });

      const eqAfterSelect = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { retry_count: 1, max_retries: 3 },
          error: null,
        }),
      });

      const sb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ eq: eqAfterSelect }),
          update: updateFn,
        }),
      };

      const before = Date.now();
      await failJob(sb as any, 'job-1', 'timeout');

      expect(capturedUpdate.status).toBe('retrying');
      expect(capturedUpdate.retry_count).toBe(2);

      const nextRetryAt = new Date(capturedUpdate.next_retry_at as string).getTime();
      // backoff = 5 min = 300000ms
      expect(nextRetryAt).toBeGreaterThanOrEqual(before + 295_000);
      expect(nextRetryAt).toBeLessThanOrEqual(before + 305_000);
    });

    it('retry_count 2 (max_retries 3) → sets status dead_letter', async () => {
      const capturedUpdate: Record<string, unknown> = {};
      const eqAfterUpdate = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateFn = vi.fn().mockImplementation((data) => {
        Object.assign(capturedUpdate, data);
        return { eq: eqAfterUpdate };
      });

      const eqAfterSelect = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { retry_count: 2, max_retries: 3 },
          error: null,
        }),
      });

      const sb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ eq: eqAfterSelect }),
          update: updateFn,
        }),
      };

      await failJob(sb as any, 'job-1', 'fatal');

      expect(capturedUpdate.status).toBe('dead_letter');
      expect(capturedUpdate.retry_count).toBe(3);
      expect(capturedUpdate.error_message).toBe('fatal');
      expect(capturedUpdate.finished_at).toBeDefined();
    });

    it('retry_count >= max_retries → dead_letter', async () => {
      const capturedUpdate: Record<string, unknown> = {};
      const eqAfterUpdate = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateFn = vi.fn().mockImplementation((data) => {
        Object.assign(capturedUpdate, data);
        return { eq: eqAfterUpdate };
      });

      const eqAfterSelect = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { retry_count: 5, max_retries: 3 },
          error: null,
        }),
      });

      const sb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ eq: eqAfterSelect }),
          update: updateFn,
        }),
      };

      await failJob(sb as any, 'job-1', 'fatal');
      expect(capturedUpdate.status).toBe('dead_letter');
    });

    it('does not throw if supabase throws', async () => {
      const sb = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('connection failed');
        }),
      };

      await expect(failJob(sb as any, 'job-1', 'err')).resolves.toBeUndefined();
    });
  });
});
