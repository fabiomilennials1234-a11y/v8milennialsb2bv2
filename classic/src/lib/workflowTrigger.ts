import { supabase } from "@/integrations/supabase/client";

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
