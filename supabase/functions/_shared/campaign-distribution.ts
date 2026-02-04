/**
 * Campaign Lead Distribution
 *
 * Centralized logic to assign SDR/Closer to leads when they enter a campaign
 * (via import, lead-webhook, webhook-new-lead, Meta Ads, etc.)
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type DistributionMode = "random" | "round_robin" | "single" | null;

export interface CampaignDistributionSettings {
  lead_distribution_mode: DistributionMode;
  lead_assigned_to: string | null;
}

/**
 * Get the SDR/team_member_id to assign to a new lead in a campaign.
 * Uses campaign distribution settings (random, round_robin, single) and campanha_members.
 *
 * @param supabase - Supabase client
 * @param campaignId - Campaign UUID
 * @returns team_member_id to assign, or null if no assignment
 */
export async function getCampaignLeadAssignment(
  supabase: SupabaseClient,
  campaignId: string
): Promise<string | null> {
  const { data: campaign, error: campError } = await supabase
    .from("campanhas")
    .select("lead_distribution_mode, lead_assigned_to")
    .eq("id", campaignId)
    .single();

  if (campError || !campaign) {
    console.warn("[campaign-distribution] Campaign not found:", campaignId, campError);
    return null;
  }

  const mode = campaign.lead_distribution_mode as DistributionMode;
  if (!mode) return campaign.lead_assigned_to ?? null;

  if (mode === "single" && campaign.lead_assigned_to) {
    return campaign.lead_assigned_to;
  }

  // For random and round_robin, we need campanha_members
  const { data: members, error: membersError } = await supabase
    .from("campanha_members")
    .select("team_member_id")
    .eq("campanha_id", campaignId);

  if (membersError || !members || members.length === 0) {
    console.warn("[campaign-distribution] No members in campaign:", campaignId);
    return null;
  }

  const memberIds = members.map((m) => m.team_member_id);

  if (mode === "random") {
    const idx = Math.floor(Math.random() * memberIds.length);
    return memberIds[idx];
  }

  if (mode === "round_robin") {
    const { count } = await supabase
      .from("campanha_leads")
      .select("id", { count: "exact", head: true })
      .eq("campanha_id", campaignId);
    const nextIndex = (count || 0) % memberIds.length;
    return memberIds[nextIndex];
  }

  return null;
}
