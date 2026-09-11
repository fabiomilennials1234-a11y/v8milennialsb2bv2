import { buildHallucinationAlert, buildWeeklyFeedbackDigest } from "./feedback-messages.ts";

export interface PendingFeedbackAlert {
  alertId: string;
  feedbackId: string;
  organizationName: string;
  comment: string | null;
}

export interface WeeklyFeedbackDigest {
  deliveryId: string;
  periodStart: string;
  periodEnd: string;
  conversations: number;
  positive: number;
  negative: number;
  invented: number;
}

export interface FeedbackWorkerDeps {
  claimAlert(id?: string): Promise<PendingFeedbackAlert | null>;
  finishAlert(id: string, sent: boolean, error?: string): Promise<void>;
  prepareWeekly(): Promise<WeeklyFeedbackDigest | null>;
  finishWeekly(id: string, sent: boolean, error?: string): Promise<void>;
  send(text: string): Promise<{ ok: boolean; error?: string }>;
}

export async function processFeedbackWorker(
  mode: "alerts" | "weekly",
  deps: FeedbackWorkerDeps,
  specificAlertId?: string,
): Promise<{ processed: number; sent: number; failed: number }> {
  if (mode === "weekly") {
    const digest = await deps.prepareWeekly();
    if (!digest) return { processed: 0, sent: 0, failed: 0 };
    const result = await deps.send(buildWeeklyFeedbackDigest(digest));
    await deps.finishWeekly(digest.deliveryId, result.ok, result.error);
    return { processed: 1, sent: result.ok ? 1 : 0, failed: result.ok ? 0 : 1 };
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const ceiling = specificAlertId ? 1 : 20;
  while (processed < ceiling) {
    const alert = await deps.claimAlert(specificAlertId);
    if (!alert) break;
    const result = await deps.send(buildHallucinationAlert(alert));
    await deps.finishAlert(alert.alertId, result.ok, result.error);
    processed++;
    if (result.ok) sent++;
    else failed++;
  }
  return { processed, sent, failed };
}
