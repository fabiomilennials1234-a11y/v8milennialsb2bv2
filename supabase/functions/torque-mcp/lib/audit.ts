import type { SupabaseClient } from "@supabase/supabase-js";
import { redact } from "../../_shared/mcp/redact.ts";

// Re-export redact so callers can import from a single audit module.
export { redact };

export interface AuditCtx {
  tool: string;
  org_id: string;
  target_type: string;
  target_id: string | null;
  params: Record<string, unknown>;
  plan: unknown;
  confirm_token: string;
}

/** Pure: build the master_audit_logs row (params redacted). */
export function buildAuditRow(masterUserId: string, userId: string, ctx: AuditCtx) {
  return {
    master_user_id: masterUserId,
    user_id: userId,
    action: `MCP_${ctx.tool.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}`,
    target_type: ctx.target_type,
    target_id: ctx.target_id,
    details: {
      tool: ctx.tool,
      org_id: ctx.org_id,
      params: redact(ctx.params),
      plan: ctx.plan,
      confirm_token: ctx.confirm_token,
    } as Record<string, unknown>,
  };
}

/**
 * Audit-first: record the master action BEFORE the mutation applies.
 * Throws on any failure so runMutation aborts (nothing applied without a trail).
 */
export async function auditMcpAction(db: SupabaseClient, ctx: AuditCtx): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("audit: no authenticated master user");
  const { data: mu, error: muErr } = await db
    .from("master_users")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (muErr || !mu) {
    throw new Error(`audit: master_users row not found (${muErr?.message ?? "none"})`);
  }
  const { error } = await db
    .from("master_audit_logs")
    .insert(buildAuditRow(mu.id as string, userId, ctx));
  if (error) throw new Error(`audit failed (mutation aborted): ${error.message}`);
}
