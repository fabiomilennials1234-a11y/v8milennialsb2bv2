/** Small sequential transactions keep history from monopolizing live-chat writes. */
export const HISTORY_WRITE_BATCH_SIZE = 25;
type Row = { message_id: string; [key: string]: unknown };
type WriteError = { code?: string; message: string };
export async function persistHistoryBatches(
  rows: Row[],
  existing: Set<string>,
  write: (batch: Row[]) => Promise<{ error: WriteError | null }>,
): Promise<{ accepted: number; error: string | null; retryable: boolean }> {
  let accepted = 0;
  let firstError: string | null = null;
  let resourceFailure = false;
  const pending: Row[] = [];
  const seen = new Set<string>();
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    if (existing.has(row.message_id)) {
      accepted++;
      continue;
    }
    occurrences.set(row.message_id, (occurrences.get(row.message_id) ?? 0) + 1);
    if (seen.has(row.message_id)) continue;
    seen.add(row.message_id);
    pending.push(row);
  }
  const save = async (batch: Row[]): Promise<void> => {
    let error: WriteError | null;
    try {
      ({ error } = await write(batch));
    } catch (cause) {
      error = { message: cause instanceof Error ? cause.message : "History write failed" };
    }
    if (!error) {
      accepted += batch.reduce((sum, row) => sum + (occurrences.get(row.message_id) ?? 1), 0);
      return;
    }
    // Isolate invalid data, but never amplify timeouts/resource exhaustion.
    if (batch.length > 1 && /^(22|23)/.test(error.code ?? "")) {
      const middle = Math.floor(batch.length / 2);
      await save(batch.slice(0, middle));
      if (!resourceFailure) await save(batch.slice(middle));
    } else {
      firstError ??= error.message;
      if (!/^(22|23)/.test(error.code ?? "")) resourceFailure = true;
    }
  };
  for (let i = 0; i < pending.length; i += HISTORY_WRITE_BATCH_SIZE) {
    await save(pending.slice(i, i + HISTORY_WRITE_BATCH_SIZE));
    if (resourceFailure) break;
  }
  return { accepted, error: firstError, retryable: resourceFailure };
}
