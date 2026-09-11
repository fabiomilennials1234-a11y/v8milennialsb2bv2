export interface SenderSnapshot { status: string; sent: number; failed: number; total: number }
/** Only an authoritative, valid response may replace the campaign snapshot. */
export async function refreshSenderSnapshot(
  load: () => Promise<SenderSnapshot>,
  save: (snapshot: SenderSnapshot) => Promise<void>,
): Promise<SenderSnapshot> {
  const snapshot = await load();
  if (!["queued", "running", "paused", "completed", "failed", "cancelled"].includes(snapshot.status)
    || ![snapshot.sent, snapshot.failed, snapshot.total].every(n => Number.isSafeInteger(n) && n >= 0)
    || snapshot.sent + snapshot.failed > snapshot.total) throw new Error("Invalid sender snapshot");
  await save(snapshot);
  return snapshot;
}
