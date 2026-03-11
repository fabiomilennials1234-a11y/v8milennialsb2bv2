import { supabase } from "@/integrations/supabase/client";
import type { Workflow, TriggerConfigStageChanged } from "@/types/workflow";

/**
 * Checks for active workflows matching a stage_changed trigger and creates
 * execution records for each match. The actual execution engine (Edge Function)
 * will pick these up and process them.
 *
 * This is called from pipe update hooks after a lead changes stage.
 */
export async function triggerStageChangedWorkflows({
  organizationId,
  leadId,
  pipeType,
  pipelineId,
  fromStage,
  toStage,
}: {
  organizationId: string;
  leadId: string;
  pipeType?: string;
  pipelineId?: string;
  fromStage?: string;
  toStage: string;
}) {
  try {
    // Fetch all active stage_changed workflows for this org
    const { data: workflows, error } = await supabase
      .from("workflows")
      .select("id, trigger_config, definition")
      .eq("organization_id", organizationId)
      .eq("trigger_type", "stage_changed")
      .eq("is_active", true);

    if (error || !workflows?.length) return;

    // Filter workflows that match this specific stage change
    const matching = (workflows as unknown as Workflow[]).filter((w) => {
      const cfg = w.trigger_config as TriggerConfigStageChanged;
      if (!cfg) return false;

      // Match pipe
      if (pipeType && cfg.pipe_type && cfg.pipe_type !== pipeType) return false;
      if (pipelineId && cfg.pipeline_id && cfg.pipeline_id !== pipelineId) return false;
      if (!pipeType && !pipelineId) return false;
      if (cfg.pipe_type && !pipeType) return false;
      if (cfg.pipeline_id && !pipelineId) return false;

      // Match from_stage if specified
      if (cfg.from_stage && fromStage && cfg.from_stage !== fromStage) return false;

      // Match to_stage / stages
      if (cfg.stages && cfg.stages.length > 0) {
        if (!cfg.stages.includes(toStage)) return false;
      } else if (cfg.to_stage) {
        if (cfg.to_stage !== toStage) return false;
      }
      // If no stage filter, matches all stages

      return true;
    });

    if (!matching.length) return;

    // Create execution records for each matching workflow
    const executions = matching.map((w) => ({
      workflow_id: w.id,
      organization_id: organizationId,
      lead_id: leadId,
      status: "running",
      context: {
        trigger: "stage_changed",
        pipe_type: pipeType || null,
        pipeline_id: pipelineId || null,
        from_stage: fromStage || null,
        to_stage: toStage,
      },
    }));

    const { error: insertError } = await supabase
      .from("workflow_executions")
      .insert(executions as any);

    if (insertError) {
      console.warn("Error creating workflow executions:", insertError.message);
    }
  } catch (err) {
    // Non-blocking: workflow trigger failure shouldn't break the pipe update
    console.warn("Error triggering stage_changed workflows:", err);
  }
}
