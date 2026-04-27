import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";

/**
 * Fires a lead_created workflow trigger for leads entering a custom pipeline.
 * Only workflows with filter_pipeline_id matching the pipeline will fire.
 */
export async function triggerLeadCreatedInCustomPipeline({
  organizationId,
  leadId,
  pipelineId,
}: {
  organizationId: string;
  leadId: string;
  pipelineId: string;
}) {
  try {
    const { error } = await supabase.functions.invoke("process-workflow-executions", {
      body: {
        mode: "fire_trigger",
        organization_id: organizationId,
        trigger_type: "lead_created",
        lead_id: leadId,
        context: {
          trigger: "lead_created",
          pipeline_id: pipelineId,
        },
      },
    });

    if (error) {
      console.warn("Error firing lead_created trigger for custom pipeline:", error.message);
    }
  } catch (err) {
    console.warn("Error triggering lead_created for custom pipeline:", err);
  }
}

/**
 * Fires a stage_changed workflow trigger via the backend Edge Function.
 * The Edge Function handles matching, creating executions, and processing.
 *
 * Called from pipe update hooks after a lead changes stage.
 */
export async function triggerStageChangedWorkflows({
  organizationId,
  leadId,
  pipeType,
  pipelineId,
  campaignId,
  fromStage,
  toStage,
}: {
  organizationId: string;
  leadId: string;
  pipeType?: string;
  pipelineId?: string;
  campaignId?: string;
  fromStage?: string;
  toStage: string;
}) {
  try {
    const { error } = await supabase.functions.invoke("process-workflow-executions", {
      body: {
        mode: "fire_trigger",
        organization_id: organizationId,
        trigger_type: "stage_changed",
        lead_id: leadId,
        context: {
          trigger: "stage_changed",
          pipe_type: pipeType || null,
          pipeline_id: pipelineId || null,
          campanha_id: campaignId || null,
          from_stage: fromStage || null,
          to_stage: toStage,
        },
      },
    });

    if (error) {
      console.warn("Error firing stage_changed trigger:", error.message);
    } else {
      track({
        event: "automation_triggered",
        organizationId,
        entityType: "workflow",
        metadata: { trigger: "stage_changed", toStage },
      });
    }
  } catch (err) {
    // Non-blocking: workflow trigger failure shouldn't break the pipe update
    console.warn("Error triggering stage_changed workflows:", err);
  }
}
