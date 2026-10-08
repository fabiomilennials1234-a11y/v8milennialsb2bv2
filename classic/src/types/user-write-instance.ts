/**
 * User-write-instance types — shared contract between frontend (TS) and edge
 * runtime (Deno via _shared/instance-write-guard.ts).
 *
 * As migration 20260930000000_user_write_instance is gated by feature flag
 * `user_write_instance_strict` (default OFF), these types describe the RPC
 * shapes added in Etapa A. Type regen is currently blocked, so this file is
 * the canonical source until `supabase gen types` runs again.
 *
 * Etapa B consumes only the read RPCs (get_lead_write_instance,
 * get_user_write_instance, can_user_write_instance). set_instance_owner is
 * an admin-only mutation invoked by Etapa D.
 */

export type WriteInstanceErrorCode =
  | 'LEAD_NOT_FOUND'
  | 'NO_RESPONSIBLE'
  | 'NO_INSTANCE'
  | 'INSTANCE_INACTIVE';

/**
 * Shape returned by RPC get_lead_write_instance(p_lead_id).
 * Returns a single TABLE row. error_code is NULL on success; on failure all
 * other fields except `responsible_user_id` may be NULL.
 */
export interface GetLeadWriteInstanceResult {
  instance_id: string | null;
  instance_name: string | null;
  owner_team_member_id: string | null;
  responsible_user_id: string | null;
  error_code: WriteInstanceErrorCode | null;
}

/**
 * Shape returned by RPC get_user_write_instance(p_user_id, p_organization_id).
 * Empty result set when the user has no instance vinculated in that org.
 */
export interface GetUserWriteInstanceResult {
  instance_id: string;
  instance_name: string;
}
