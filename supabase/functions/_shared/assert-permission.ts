/**
 * assert-permission.ts — Thin wrapper around permission_engine for edge function use.
 *
 * Provides a simplified interface + a convenience Response builder for 403s.
 * Edge functions call this instead of reaching into permission_engine directly.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canUserPerformAction,
  type PermissionAction,
  type PermissionResult,
} from "./permission_engine.ts";

/**
 * Check if a user can perform an action within an organization.
 * Delegates entirely to the cascading permission engine.
 */
export async function assertPermission(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  action: string,
  resourceId?: string,
): Promise<{ allowed: boolean; reason: string }> {
  const result: PermissionResult = await canUserPerformAction({
    supabase,
    userId,
    organizationId,
    action: action as PermissionAction,
    resourceId,
  });

  return {
    allowed: result.allowed,
    reason: result.reason ?? (result.allowed ? "allowed" : "denied"),
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
