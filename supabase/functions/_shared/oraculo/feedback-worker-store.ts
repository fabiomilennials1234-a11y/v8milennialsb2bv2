import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type FeedbackWorkerDeps,
  type PendingFeedbackAlert,
  type WeeklyFeedbackDigest,
} from "./feedback-worker.ts";
import { sendOwnedWhatsApp } from "./owned-whatsapp.ts";

export function createFeedbackWorkerDeps(db: SupabaseClient): FeedbackWorkerDeps {
  return {
    async claimAlert(id) {
      const { data, error } = await db.rpc("oraculo_claim_feedback_alert", {
        p_alert_id: id ?? null,
      });
      if (error) throw error;
      const row = record(data);
      return row
        ? {
          alertId: String(row.alert_id),
          feedbackId: String(row.feedback_id),
          organizationName: String(row.organization_name),
          comment: typeof row.comment === "string" ? row.comment : null,
        } satisfies PendingFeedbackAlert
        : null;
    },
    async finishAlert(id, sent, errorMessage) {
      const { error } = await db.rpc("oraculo_finish_feedback_alert", {
        p_alert_id: id,
        p_sent: sent,
        p_error: errorMessage ?? null,
      });
      if (error) throw error;
    },
    async prepareWeekly() {
      const { data, error } = await db.rpc("oraculo_prepare_weekly_feedback_digest");
      if (error) throw error;
      const row = record(data);
      return row
        ? {
          deliveryId: String(row.delivery_id),
          periodStart: String(row.period_start),
          periodEnd: String(row.period_end),
          conversations: number(row.conversations),
          positive: number(row.positive),
          negative: number(row.negative),
          invented: number(row.invented),
        } satisfies WeeklyFeedbackDigest
        : null;
    },
    async finishWeekly(id, sent, errorMessage) {
      const { error } = await db.rpc("oraculo_finish_weekly_feedback_digest", {
        p_delivery_id: id,
        p_sent: sent,
        p_error: errorMessage ?? null,
      });
      if (error) throw error;
    },
    send: sendOwnedWhatsApp,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
