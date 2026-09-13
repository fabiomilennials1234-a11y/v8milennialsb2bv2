import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** A user-triggered workflow derives its tenant from membership, never the body. */
export async function resolveWorkflowTriggerScope(
  supabase: SupabaseClient,
  userId: string | null,
  requestedOrg: unknown,
  leadId: unknown,
): Promise<string | null> {
  if (typeof requestedOrg !== "string" || !requestedOrg || typeof leadId !== "string" || !leadId) return null;
  let organizationId = requestedOrg;
  if (userId) {
    const { data, error } = await supabase.from("team_members")
      .select("organization_id").eq("user_id", userId).eq("is_active", true).maybeSingle();
    if (error || !data?.organization_id || data.organization_id !== requestedOrg) return null;
    organizationId = data.organization_id;
  }
  const { data: lead, error } = await supabase.from("leads").select("id")
    .eq("id", leadId).eq("organization_id", organizationId).maybeSingle();
  return !error && lead ? organizationId : null;
}
