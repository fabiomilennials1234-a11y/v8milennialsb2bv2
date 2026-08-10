/**
 * Batched FK teardown before deleting a WhatsApp instance.
 *
 * Why this module exists
 * ----------------------
 * `whatsapp_messages` holds ~2.3M rows / 4.5 GB in production and carries SEVEN
 * indexes covering `instance_id`. Clearing the FK with a single
 * `UPDATE ... SET instance_id = NULL WHERE instance_id = $1` rewrites 7 index
 * entries per row, and it blew the statement timeout: 34 of 95 instance
 * deletions failed with `canceling statement due to statement timeout`
 * (measured 2026-07-14 → 2026-08-07). The user saw the action fail, had no idea
 * whether it half-happened, and clicked again.
 *
 * Batching in the CLIENT, not in a plpgsql loop, is deliberate. A server-side
 * loop is one transaction holding row locks on a table the WhatsApp webhook
 * writes to continuously — and this project has already had an incident where a
 * long-running backfill exhaust the connection pool and stop message
 * ingestion for 42 minutes. One short transaction per batch releases locks in
 * between.
 *
 * IO is injected so the loop is testable without a database.
 */

/**
 * How many rows one statement touches.
 *
 * Bounded by URL length, not by database cost. The write filters on an explicit
 * id list, and PostgREST carries that filter in the request URL — 200 UUIDs is
 * roughly 7.5 KB, already close to the usual 8–16 KB ceiling. A larger batch
 * would trade `statement timeout` for `414 URI Too Long`, which is not a fix.
 */
export const DEFAULT_BATCH_SIZE = 200;

/**
 * Upper bound on batches per call, so a pathological instance cannot occupy a
 * connection indefinitely — this project has already had a long-running backfill
 * exhaust the connection pool and stop message ingestion for 42 minutes.
 *
 * At the default batch size this covers 100k rows per call, above the average
 * instance (~19k rows across 117 instances holding 2.3M) but not above the
 * worst. Hitting the ceiling returns `hitBatchCeiling: true` so the caller can
 * stop honestly and be retried, rather than pretending the work finished.
 */
export const DEFAULT_MAX_BATCHES = 500;

export interface BatchNullifyIO {
  /** Ids of up to `limit` rows where `column` still equals `value`. */
  selectIds(
    table: string,
    column: string,
    value: string,
    limit: number
  ): Promise<string[]>;

  /** Set `column` to NULL for exactly these ids. */
  nullifyByIds(table: string, column: string, ids: string[]): Promise<void>;
}

export interface BatchNullifyTarget {
  table: string;
  column: string;
  value: string;
  batchSize?: number;
  maxBatches?: number;
}

export interface BatchNullifyResult {
  /** Rows whose FK was cleared by this call. */
  rows: number;
  /** Write statements issued. */
  batches: number;
  /** True when the batch ceiling stopped the loop before the table was drained. */
  hitBatchCeiling: boolean;
}

/**
 * Clear `column` on every row matching `value`, one bounded statement at a time.
 *
 * Returns when the table is drained (`hitBatchCeiling: false`) or when the batch
 * ceiling is reached with rows still matching (`hitBatchCeiling: true`). Write errors
 * propagate — a partially drained table must never read as success.
 */
export async function nullifyInBatches(
  io: BatchNullifyIO,
  target: BatchNullifyTarget
): Promise<BatchNullifyResult> {
  const batchSize = target.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = target.maxBatches ?? DEFAULT_MAX_BATCHES;

  let rows = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const ids = await io.selectIds(
      target.table,
      target.column,
      target.value,
      batchSize
    );

    if (ids.length === 0) {
      return { rows, batches, hitBatchCeiling: false };
    }

    await io.nullifyByIds(target.table, target.column, ids);
    rows += ids.length;
    batches += 1;
  }

  return { rows, batches, hitBatchCeiling: true };
}
