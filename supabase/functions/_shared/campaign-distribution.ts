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
  closer_distribution_mode: DistributionMode;
  closer_assigned_to: string | null;
}

/**
 * Get the SDR team_member_id to assign to a new lead in a campaign.
 * Uses campaign distribution settings and campanha_members WHERE role = 'sdr'.
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

  // For random and round_robin, we need campanha_members with role = 'sdr'
  const { data: members, error: membersError } = await supabase
    .from("campanha_members")
    .select("team_member_id")
    .eq("campanha_id", campaignId)
    .eq("role", "sdr");

  if (membersError || !members || members.length === 0) {
    console.warn("[campaign-distribution] No SDR members in campaign:", campaignId);
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

/**
 * Get the Closer team_member_id to assign to a new lead in a campaign.
 * Uses campaign closer distribution settings and campanha_members WHERE role = 'closer'.
 */
export async function getCampaignCloserAssignment(
  supabase: SupabaseClient,
  campaignId: string
): Promise<string | null> {
  const { data: campaign, error: campError } = await supabase
    .from("campanhas")
    .select("closer_distribution_mode, closer_assigned_to")
    .eq("id", campaignId)
    .single();

  if (campError || !campaign) {
    console.warn("[campaign-distribution] Campaign not found for closer:", campaignId, campError);
    return null;
  }

  const mode = campaign.closer_distribution_mode as DistributionMode;
  if (!mode) return campaign.closer_assigned_to ?? null;

  if (mode === "single" && campaign.closer_assigned_to) {
    return campaign.closer_assigned_to;
  }

  // For random and round_robin, we need campanha_members with role = 'closer'
  const { data: members, error: membersError } = await supabase
    .from("campanha_members")
    .select("team_member_id")
    .eq("campanha_id", campaignId)
    .eq("role", "closer");

  if (membersError || !members || members.length === 0) {
    console.warn("[campaign-distribution] No Closer members in campaign:", campaignId);
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
      .eq("campanha_id", campaignId)
      .not("closer_id", "is", null);
    const nextIndex = (count || 0) % memberIds.length;
    return memberIds[nextIndex];
  }

  return null;
}
