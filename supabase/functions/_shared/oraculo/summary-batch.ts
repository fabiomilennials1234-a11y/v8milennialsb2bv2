export interface SummaryJob {
  id: string;
  leadId: string;
  instanceId: string;
}

export interface SummaryBatchDeps {
  claim(limit: number): Promise<SummaryJob[]>;
  summarize(job: SummaryJob): Promise<void>;
  finish(jobId: string, error: string | null): Promise<void>;
}

export interface SummaryBatchResult {
  claimed: number;
  completed: number;
  failed: number;
}

const DEFAULT_LIMIT = 10;
export const MAX_SUMMARY_BATCH = 20;

export async function processSummaryBatch(
  deps: SummaryBatchDeps,
  requestedLimit = DEFAULT_LIMIT,
): Promise<SummaryBatchResult> {
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_SUMMARY_BATCH)
    : DEFAULT_LIMIT;
  const jobs = await deps.claim(limit);
  const result = { claimed: jobs.length, completed: 0, failed: 0 };

  for (const job of jobs) {
    try {
      await deps.summarize(job);
      await deps.finish(job.id, null);
      result.completed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.finish(job.id, message.slice(0, 1000));
      result.failed++;
    }
  }
  return result;
}
