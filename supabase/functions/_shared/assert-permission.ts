/**
 * assert-permission.ts — Permission gate for edge functions.
 *
 * Provides assertPermission() which:
 *   1. Checks permission via cascading engine (master→admin→feature)
 *   2. Auto-provisions shadow team_member for master users on write
 *   3. Returns allowed/denied with reason
 *
 * Edge functions call this for all write operations.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canUserPerformAction,
  type PermissionAction,
  type PermissionResult,
} from "./permission_engine.ts";
import type { AppAction } from "./permission-actions.ts";

/**
 * Check if a user can perform an action within an organization.
 * For master users without team_member, auto-provisions a shadow member.
 *
 * Returns { allowed, reason, teamMemberId } — teamMemberId may be
 * freshly provisioned for master users.
 */
export async function assertPermission(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  action: string,
  resourceId?: string,
): Promise<{ allowed: boolean; reason: string; teamMemberId?: string }> {
  const result: PermissionResult = await canUserPerformAction({
    supabase,
    userId,
    organizationId,
    action: action as PermissionAction,
    resourceId,
  });

  let teamMemberId: string | undefined;

  if (result.allowed && result.reason === "master_user") {
    const { data: existingTm } = await supabase
      .from("team_members")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();

    if (existingTm) {
      teamMemberId = existingTm.id;
    } else {
      const { data: tmId } = await supabase.rpc("ensure_master_team_member", {
        p_org_id: organizationId,
      });
      teamMemberId = tmId ?? undefined;
    }
  }

  return {
    allowed: result.allowed,
    reason: result.reason ?? (result.allowed ? "allowed" : "denied"),
    teamMemberId,
  };
}

/**
 * Build a 403 Response with structured JSON body.
 * Use after assertPermission returns allowed=false.
 */
export function permissionDeniedResponse(reason: string, headers: HeadersInit): Response {
  return new Response(JSON.stringify({ error: "Permission denied", reason }), {
    status: 403,
    headers,
  });
}
