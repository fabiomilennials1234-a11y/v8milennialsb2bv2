import { supabase } from "@/integrations/supabase/client";
import type { FollowUpAutomation } from "./useFollowUps";

interface TriggerAutomationParams {
  leadId: string;
  assignedTo: string | null;
  pipeType: "whatsapp" | "confirmacao" | "propostas";
  stage: string;
  sourcePipeId: string;
  organizationId: string;
}

export async function triggerFollowUpAutomation({
  leadId,
  assignedTo,
  pipeType,
  stage,
  sourcePipeId,
  organizationId,
}: TriggerAutomationParams): Promise<void> {
  try {
    if (!organizationId) return;

    const { data: automations, error: automationsError } = await supabase
      .from("follow_up_automations")
      .select("*")
      .eq("pipe_type", pipeType)
      .eq("stage", stage)
      .eq("is_active", true);

    if (automationsError) {
      console.error("Error fetching automations:", automationsError);
      return;
    }

    if (!automations || automations.length === 0) {
      return;
    }

    const followUps = automations.map((automation: FollowUpAutomation) => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + automation.days_offset);

      return {
        lead_id: leadId,
        assigned_to: assignedTo,
        title: automation.title_template,
        description: automation.description_template,
        due_date: dueDate.toISOString(),
        priority: automation.priority,
        source_pipe: pipeType,
        source_pipe_id: sourcePipeId,
        is_automated: true,
        organization_id: organizationId,
      };
    });

    const { error } = await supabase.from("follow_ups").insert(followUps);

    if (error) {
      console.error("Error creating automated follow ups:", error);
    } else {
      console.log(`Created ${followUps.length} automated follow-ups for stage "${stage}" in pipe "${pipeType}"`);
    }
  } catch (error) {
    console.error("Error in triggerFollowUpAutomation:", error);
  }
}
