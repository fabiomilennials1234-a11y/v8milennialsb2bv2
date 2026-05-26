import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface HumanPauseCheck {
  paused: boolean;
  pausedUntil: string | null;
}

export async function isHumanPauseActive(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
): Promise<HumanPauseCheck> {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("human_paused_until")
      .eq("lead_id", leadId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.human_paused_until) {
      return { paused: false, pausedUntil: null };
    }

    const pausedUntil = new Date(data.human_paused_until);
    return {
      paused: pausedUntil > new Date(),
      pausedUntil: data.human_paused_until,
    };
  } catch {
    return { paused: false, pausedUntil: null };
  }
}
