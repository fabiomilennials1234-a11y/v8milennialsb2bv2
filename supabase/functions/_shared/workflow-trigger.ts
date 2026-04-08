/**
 * Workflow Trigger — central module for firing workflow triggers from Edge Functions
 *
 * Used by edge functions that need to fire triggers not handled by PG triggers:
 * - lead_replied (from agent-message)
 * - lead_no_reply (from pg_cron check)
 * - meeting_not_confirmed (from pg_cron check)
 * - followup_overdue (from pg_cron check)
 * - webhook_received (from process-webhook-deliveries)
 * - cron (from process-workflow-executions cron_triggers mode)
 * - stage_changed (migrated from frontend)
 *
 * PG triggers handle: lead_created, tag_added, score_reached, lead_assigned,
 * field_changed, meeting_confirmed, proposal_accepted, proposal_lost,
 * campaign_status_changed
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface FireTriggerParams {
  supabase: SupabaseClient;
  organizationId: string;
  triggerType: string;
  leadId: string;
  context?: Record<string, unknown>;
}

/**
 * Finds active workflows matching the trigger type, validates trigger_config,
 * and creates workflow_execution records.
 *
 * Returns the number of executions created.
 */
export async function fireTrigger(params: FireTriggerParams): Promise<number> {
  const { supabase, organizationId, triggerType, leadId, context } = params;

  try {
    const { data: workflows, error } = await supabase
      .from("workflows")
      .select("id, trigger_config")
      .eq("organization_id", organizationId)
      .eq("trigger_type", triggerType)
      .eq("is_active", true);

    if (error || !workflows?.length) return 0;

    // Filter by trigger_config match
    const matching = workflows.filter((w: { id: string; trigger_config: Record<string, unknown> }) =>
      matchesTriggerConfig(triggerType, w.trigger_config, context || {}),
    );

    if (matching.length === 0) return 0;

    const executions = matching.map((w: { id: string }) => ({
      workflow_id: w.id,
      organization_id: organizationId,
      lead_id: leadId,
      status: "running",
      context: { trigger_type: triggerType, ...(context || {}) },
    }));

    const { error: insertError } = await supabase
      .from("workflow_executions")
      .insert(executions);

    if (insertError) {
      console.warn("[workflow-trigger] Insert failed:", insertError.message);
      return 0;
    }

    console.log(`[workflow-trigger] Fired ${matching.length} workflows for ${triggerType}`);
    return matching.length;
  } catch (err) {
    console.warn("[workflow-trigger] Error:", err);
    return 0;
  }
}

/**
 * Validates that the trigger context matches the workflow's trigger_config.
 */
function matchesTriggerConfig(
  triggerType: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  switch (triggerType) {
    case "stage_changed": {
      if (config.pipe_type && context.pipe_type && config.pipe_type !== context.pipe_type) return false;
      if (config.pipeline_id && context.pipeline_id && config.pipeline_id !== context.pipeline_id) return false;
      if (config.campanha_id && context.campanha_id && config.campanha_id !== context.campanha_id) return false;
      if (config.from_stage && context.from_stage && config.from_stage !== context.from_stage) return false;
      const stages = config.stages as string[] | undefined;
      const toStage = context.to_stage as string;
      if (stages && stages.length > 0 && toStage) {
        if (!stages.includes(toStage)) return false;
      } else if (config.to_stage && toStage) {
        if (config.to_stage !== toStage) return false;
      }
      return true;
    }

    case "lead_created": {
      if (config.filter_origin && context.origin && config.filter_origin !== context.origin) return false;
      return true;
    }

    case "tag_added": {
      if (config.tag_id && context.tag_id && config.tag_id !== context.tag_id) return false;
      if (config.tag_name && context.tag_name) {
        if (String(config.tag_name).toLowerCase() !== String(context.tag_name).toLowerCase()) return false;
      }
      return true;
    }

    case "score_reached": {
      const minScore = Number(config.min_score) || 0;
      const currentScore = Number(context.score) || 0;
      return currentScore >= minScore;
    }

    case "lead_replied": {
      if (config.channel && config.channel !== "any" && context.channel && config.channel !== context.channel) return false;
      if (config.contains_text && context.message) {
        return String(context.message).toLowerCase().includes(String(config.contains_text).toLowerCase());
      }
      return true;
    }

    case "lead_no_reply": {
      // Timeout is checked by the caller; config match is always true
      return true;
    }

    case "meeting_confirmed": {
      if (config.pipe_type && context.pipe_type && config.pipe_type !== context.pipe_type) return false;
      return true;
    }

    case "meeting_not_confirmed": {
      // hours_before is checked by the caller
      return true;
    }

    case "proposal_accepted":
    case "proposal_lost": {
      return true;
    }

    case "followup_overdue": {
      return true;
    }

    case "webhook_received": {
      if (config.webhook_key && context.webhook_key && config.webhook_key !== context.webhook_key) return false;
      return true;
    }

    case "lead_assigned": {
      if (config.role && config.role !== "any" && context.role && config.role !== context.role) return false;
      return true;
    }

    case "campaign_status_changed":
    case "lead_added_to_campaign":
    case "lead_removed_from_campaign":
    case "campaign_lead_replied":
    case "campaign_lead_no_reply":
    case "campaign_completed": {
      if (config.campaign_id && context.campanha_id && config.campaign_id !== context.campanha_id) return false;
      return true;
    }

    case "field_changed": {
      if (config.field_name && context.field_name && config.field_name !== context.field_name) return false;
      if (config.new_value && context.new_value && config.new_value !== context.new_value) return false;
      return true;
    }

    case "cron": {
      // Cron matching is done by the caller
      return true;
    }

    default:
      return true;
  }
}

/**
 * Fire stage_changed trigger — replacement for frontend workflowTrigger.ts
 */
export async function fireStageChangedTrigger(params: {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string;
  pipeType?: string;
  pipelineId?: string;
  fromStage?: string;
  toStage: string;
}): Promise<number> {
  return fireTrigger({
    supabase: params.supabase,
    organizationId: params.organizationId,
    triggerType: "stage_changed",
    leadId: params.leadId,
    context: {
      trigger: "stage_changed",
      pipe_type: params.pipeType || null,
      pipeline_id: params.pipelineId || null,
      from_stage: params.fromStage || null,
      to_stage: params.toStage,
    },
  });
}

/**
 * Process cron-type workflow triggers.
 * Called every minute by pg_cron. Checks each cron workflow's expression
 * against the current minute.
 */
export async function processCronTriggers(supabase: SupabaseClient): Promise<number> {
  const { data: cronWorkflows, error } = await supabase
    .from("workflows")
    .select("id, organization_id, trigger_config")
    .eq("trigger_type", "cron")
    .eq("is_active", true);

  if (error || !cronWorkflows?.length) return 0;

  let count = 0;
  const now = new Date();

  for (const wf of cronWorkflows) {
    const config = wf.trigger_config as { cron_expression?: string };
    if (!config.cron_expression) continue;

    if (matchesCronExpression(config.cron_expression, now)) {
      // Cron workflows don't have a specific lead — they run org-wide
      // The workflow definition should have its own logic for selecting leads
      const { error: insertError } = await supabase.from("workflow_executions").insert({
        workflow_id: wf.id,
        organization_id: wf.organization_id,
        lead_id: null,
        status: "running",
        context: { trigger_type: "cron", cron_expression: config.cron_expression },
      });

      if (!insertError) count++;
    }
  }

  return count;
}

/**
 * Simple cron expression matcher (minute hour day month weekday)
 */
function matchesCronExpression(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;

  return (
    matchesCronField(minExpr, date.getMinutes()) &&
    matchesCronField(hourExpr, date.getHours()) &&
    matchesCronField(dayExpr, date.getDate()) &&
    matchesCronField(monthExpr, date.getMonth() + 1) &&
    matchesCronField(weekdayExpr, date.getDay())
  );
}

function matchesCronField(expr: string, value: number): boolean {
  if (expr === "*") return true;

  // Handle */N
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.substring(2));
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // Handle comma-separated values
  const parts = expr.split(",");
  for (const part of parts) {
    // Handle range N-M
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) return true;
    } else {
      if (parseInt(part) === value) return true;
    }
  }

  return false;
}
