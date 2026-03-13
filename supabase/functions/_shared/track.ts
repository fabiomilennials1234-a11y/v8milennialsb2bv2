/**
 * Usage event tracker for Supabase Edge Functions.
 *
 * Inserts structured records into the usage_events table using the service
 * role key. Fire-and-forget — never throws, never blocks the main flow.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type EdgeEventType =
  | "lead_created"
  | "lead_updated"
  | "card_moved"
  | "message_sent"
  | "automation_triggered"
  | "campaign_started"
  | "import_completed"
  | "workflow_triggered"
  | "meeting_scheduled"
  | "lead_qualified"
  | "lead_disqualified";

interface TrackEventParams {
  organizationId: string;
  userId?: string;
  eventType: EdgeEventType;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Inserts a usage_events record using the service role key.
 * Never throws — if the insert fails, it silently logs to console and returns.
 */
export async function trackEvent(params: TrackEventParams): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await supabase.from("usage_events").insert({
      organization_id: params.organizationId,
      user_id: params.userId || null,
      event_type: params.eventType,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      metadata: params.metadata || null,
    });
  } catch (err) {
    console.warn("[trackEvent] Failed to write usage event (non-fatal):", err);
  }
}
