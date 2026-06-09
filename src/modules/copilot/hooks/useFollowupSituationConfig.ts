/**
 * CRUD for per-Organization Follow-up Situation config (ADR-0006).
 *
 * The Org enables/disables each of the seven canonical Situations and tunes
 * basics on top of the Torque-curated catalog defaults. Stage mapping
 * (trigger_stage_keys) is populated by the AI Stage Classifier, not here.
 *
 * TODO(types): regenerate src/integrations/supabase/types.ts to include
 * copilot_followup_situation_config, then drop the `client` cast below.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

export type SituationId =
  | "new_lead_no_reply"
  | "qualified_no_meeting"
  | "cold_reengage"
  | "meeting_reminder"
  | "no_show_rebook"
  | "proposal_no_reply"
  | "dormant_winback";

export interface FollowupSituationConfig {
  id: string;
  organization_id: string;
  situation_id: SituationId;
  is_active: boolean;
  delay_hours: number;
  delay_minutes: number;
  touch_count: number | null;
  spacing_hours: number | null;
  copy_override: unknown | null;
  trigger_stage_keys: string[];
  send_only_business_hours: boolean;
  business_hours_start: string;
  business_hours_end: string;
  send_days: string[];
  timezone: string;
}

export type FollowupSituationPatch = Partial<
  Pick<
    FollowupSituationConfig,
    | "is_active"
    | "delay_hours"
    | "delay_minutes"
    | "touch_count"
    | "spacing_hours"
    | "send_only_business_hours"
    | "business_hours_start"
    | "business_hours_end"
    | "send_days"
    | "timezone"
  >
>;

const QUERY_KEY = "copilot_followup_situation_config";
// deno-lint-ignore no-explicit-any -- table not yet in generated types (see TODO)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = supabase as any;

export function useFollowupSituationConfig() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  return useQuery({
    queryKey: [QUERY_KEY, orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<FollowupSituationConfig[]> => {
      const { data, error } = await client
        .from(QUERY_KEY)
        .select("*")
        .eq("organization_id", orgId);
      if (error) throw error;
      return (data ?? []) as FollowupSituationConfig[];
    },
  });
}

/** Upsert a Situation's config. The classifier owns trigger_stage_keys. */
export function useUpsertFollowupSituationConfig() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { situationId: SituationId } & FollowupSituationPatch) => {
      const { situationId, ...patch } = input;
      const { error } = await client
        .from(QUERY_KEY)
        .upsert(
          { organization_id: orgId, situation_id: situationId, ...patch },
          { onConflict: "organization_id,situation_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, orgId] });
    },
  });
}
