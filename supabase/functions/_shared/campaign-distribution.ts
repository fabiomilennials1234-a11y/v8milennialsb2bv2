/**
 * Campaign Lead Distribution
 *
 * Centralized logic to assign a responsible team member to leads
 * when they enter a campaign (via import, lead-webhook, webhook-new-lead, etc.)
 *
 * Unified: single pool of active members replaces separate SDR/Closer pools.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type DistributionMode = "random" | "round_robin" | "single" | null;

export interface CampaignDistributionSettings {
  lead_distribution_mode: DistributionMode;
  lead_assigned_to: string | null;
  // Legacy fields — kept for reading old campaign configs
  closer_distribution_mode?: DistributionMode;
  closer_assigned_to?: string | null;
}

/**
 * Get the team_member_id to assign as responsible for a new lead in a campaign.
 * Uses campaign distribution settings and campanha_members (all roles, unified pool).
 */
export async function getCampaignResponsibleAssignment(
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

  // Unified pool: all campanha_members (no role filter)
  const { data: members, error: membersError } = await supabase
    .from("campanha_members")
    .select("team_member_id")
    .eq("campanha_id", campaignId)
    .order("team_member_id");

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
    // "Least loaded" algorithm: pick member with fewest leads in this campaign
    const { data: counts } = await supabase
      .from("campanha_leads")
      .select("responsible_id")
      .eq("campanha_id", campaignId)
      .not("responsible_id", "is", null);

    const countMap: Record<string, number> = {};
    for (const id of memberIds) countMap[id] = 0;
    for (const cl of counts || []) {
      if (cl.responsible_id && countMap[cl.responsible_id] !== undefined) {
        countMap[cl.responsible_id]++;
      }
    }

    let minCount = Infinity;
    let chosen: string | null = null;
    for (const id of memberIds) {
      if (countMap[id] < minCount) {
        minCount = countMap[id];
        chosen = id;
      }
    }
    return chosen;
  }

  return null;
}

/** @deprecated Use getCampaignResponsibleAssignment instead */
export async function getCampaignLeadAssignment(
  supabase: SupabaseClient,
  campaignId: string
): Promise<string | null> {
  return getCampaignResponsibleAssignment(supabase, campaignId);
}

/** @deprecated Use getCampaignResponsibleAssignment instead */
export async function getCampaignCloserAssignment(
  supabase: SupabaseClient,
  campaignId: string
): Promise<string | null> {
  return getCampaignResponsibleAssignment(supabase, campaignId);
}
