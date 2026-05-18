import type { ActionInput, ActionResult } from "./types.ts";

export async function addToCampaign(input: ActionInput): Promise<ActionResult> {
  const { supabase, leadId, params } = input;
  const campaignId = params.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  const { data: firstStage } = await supabase
    .from("campanha_stages")
    .select("id")
    .eq("campanha_id", campaignId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("campanha_leads").upsert(
    {
      campanha_id: campaignId,
      lead_id: leadId,
      stage_id: firstStage?.id || null,
    },
    { onConflict: "campanha_id,lead_id", ignoreDuplicates: true },
  );

  if (error) return { success: false, error: error.message };
  return { success: true, message: `Added to campaign ${params.campaignName || campaignId}` };
}

export async function removeFromCampaign(input: ActionInput): Promise<ActionResult> {
  const { supabase, leadId, params } = input;
  const campaignId = params.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  await supabase.from("campanha_leads").delete()
    .eq("campanha_id", campaignId).eq("lead_id", leadId);

  return { success: true, message: "Removed from campaign" };
}

export async function moveCampaignStage(input: ActionInput): Promise<ActionResult> {
  const { supabase, leadId, params } = input;
  const campaignId = params.campaignId as string;
  const stageName = params.campaignStageName as string;
  const stageId = params.campaignStageId as string;

  if (!campaignId) return { success: false, error: "No campaign configured" };

  let resolvedStageId = stageId;
  if (!resolvedStageId && stageName) {
    const { data: stage } = await supabase
      .from("campanha_stages")
      .select("id")
      .eq("campanha_id", campaignId)
      .ilike("name", stageName)
      .maybeSingle();
    resolvedStageId = stage?.id;
  }

  if (!resolvedStageId) return { success: false, error: "Campaign stage not found" };

  await supabase.from("campanha_leads")
    .update({ stage_id: resolvedStageId })
    .eq("campanha_id", campaignId)
    .eq("lead_id", leadId);

  return { success: true, message: `Moved to campaign stage "${stageName || stageId}"` };
}

export async function pauseCampaignSequence(input: ActionInput): Promise<ActionResult> {
  const { supabase, leadId, params } = input;
  const campaignId = params.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  const { error } = await supabase
    .from("scheduled_campaign_messages")
    .update({ status: "cancelled" })
    .eq("lead_id", leadId)
    .eq("campanha_id", campaignId)
    .eq("status", "scheduled");

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Campaign sequence paused" };
}

export async function resumeCampaignSequence(input: ActionInput): Promise<ActionResult> {
  const { supabase, leadId, params } = input;
  const campaignId = params.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  const { error } = await supabase
    .from("scheduled_campaign_messages")
    .update({
      status: "scheduled",
      scheduled_at: new Date().toISOString(),
    })
    .eq("lead_id", leadId)
    .eq("campanha_id", campaignId)
    .eq("status", "cancelled");

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Campaign sequence resumed" };
}
