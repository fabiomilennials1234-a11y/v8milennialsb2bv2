/**
 * Batched FK teardown before deleting a WhatsApp instance.
 *
 * Why this module exists
 * ----------------------
 * It was born for `whatsapp_messages`: ~2.3M rows carrying SEVEN indexes over
 * `instance_id`, where a single `UPDATE ... SET instance_id = NULL` blew the
 * statement timeout — 34 of 95 instance deletions failed that way (measured
 * 2026-07-14 → 2026-08-07).
 *
 * **That table stops being a target once — and only once — the
 * `whatsapp_messages_instance_id_fkey` FK is DROPPED**, which happens in
 * migration `20270811000000_whatsapp_messages_drop_instance_fk.sql`. That migration is
 * a MANUAL step and it is applied BEFORE the proxy that calls this module is
 * deployed; this module never assumes it already ran. `whatsapp-api-proxy`
 * decides the target list per deletion by probing the catalog
 * (`whatsappMessagesFkState`), so both deploy orders are safe.
 *
 * Why dropping the FK is the fix: after the DROP, `instance_id` is a historical
 * uuid on the message, immune to the instance lifecycle. Clearing it is what
 * makes a whole conversation vanish from the chat — which filters on
 * `instance_id` — every time an instance is deleted; the timeout is the loud
 * symptom, the lost history is the silent damage. With no FK there is neither
 * cascade nor nullify, so deleting an instance stops touching those 2.3M rows.
 *
 * While the FK is still there, this loop remains the ONLY safe way to clear it:
 * the cascade would do the same nulling anyway, in one statement, and time out.
 *
 * The other target is `scheduled_user_messages.whatsapp_instance_id`, still
 * ON DELETE SET NULL and staying that way. That one is a pending-send queue,
 * not history, and it is small — so for it, batching is not a cure for the
 * timeout but a bound: it keeps a pathologically large queue from turning into
 * one cascade statement, and keeps this call from occupying a connection
 * indefinitely.
 *
 * Batching in the CLIENT, not in a plpgsql loop, is deliberate. A server-side
 * loop is one transaction holding row locks — and this project has already had
 * an incident where a long-running backfill exhausted the connection pool and
 * stopped message ingestion for 42 minutes. One short transaction per batch
 * releases locks in between.
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
 * At the default batch size this covers 100k rows per call.
 *
 * Reachability depends on the target. For `scheduled_user_messages` — a
 * pending-send queue holding tens of rows in production — the ceiling is
 * unreachable in practice. For `whatsapp_messages`, while its FK is still
 * alive, it is NOT: the largest instance measured (Alamaster) carries ~155k
 * rows, so its first deletion attempt hits the ceiling by design and needs a
 * second call. That is the intended behaviour, not a defect.
 *
 * Hitting it returns `hitBatchCeiling: true` so the caller stops honestly and
 * is retried, rather than pretending the work finished.
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
