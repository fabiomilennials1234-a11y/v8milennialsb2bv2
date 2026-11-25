/**
 * The ONLY door from a customer tool to a Postgres function (ADR 0012, emenda "allowlist de
 * RPC"). v1 banned `.rpc(` outright: a SECURITY DEFINER function runs as its owner and can
 * ignore the caller's RLS — the anti-bypass rule. The metrics engine the app itself uses is
 * DEFINER, so the rule became an allowlist with a stated gate per entry:
 *
 *  - DEFINER entries must authorize the CALLER as their first act (assert_org_access /
 *    auth.uid()) — the same function the app calls with the same user session;
 *  - INVOKER entries run under the caller's RLS like any table read.
 *
 * Adding a name here is a security decision: tools.test.ts pins this list, and
 * supabase/tests/crm_mcp_rpc_allowlist_test.sql proves each gate on the real database.
 * Never add an RPC that takes an organization id WITHOUT checking the caller against it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "../../_shared/mcp/types.ts";

export const RPC_ALLOWLIST = {
  /** INVOKER — reads the metric catalog tables (readable by authenticated). */
  fn_metric_catalog: "invoker",
  /** DEFINER — first statement is assert_org_access(p_org_id). The Métricas engine. */
  fn_metric_measure: "definer:assert_org_access",
  /** DEFINER — answers for auth.uid() inside the given org (team_members of the caller). */
  has_feature_permission: "definer:auth.uid",
  /**
   * INVOKER — the card move the app (kanban), the public API and the DB triggers all share.
   * Runs under the caller's RLS (pipeline.view_all / strict-owner regimes apply).
   */
  mover_negocio: "invoker",
  /**
   * INVOKER — the funnel board's own count of cards per column (optionally only those stalled
   * N+ days). Runs under the caller's RLS; p_org_id only narrows, it grants nothing.
   */
  get_pipeline_stage_counts_by_id: "invoker",
  /**
   * INVOKER — the Agenda screen's events. First statement refuses an org the caller is not a
   * member of; then narrows to the caller's own events unless admin / agenda.view_all.
   */
  get_agenda_events_scoped: "invoker",
  /**
   * INVOKER — the Comando tab's "awaiting a human reply" queue. First statement is
   * assert_org_access(p_org); only the WhatsApp numbers the caller may read are scanned.
   */
  get_comando_fila: "invoker",
  /**
   * DEFINER — the deal card's Won/Lost buttons. Its gate is assert_org_access(org of the
   * card) BEFORE any write; it does NOT check that the caller sees the card nor
   * pipeline.move_cards — deal.outcome.* reads each card under the caller's RLS in the token
   * org and checks that permission first. Never call it with an entry id not so verified.
   */
  definir_desfecho_da_entrada: "definer:assert_org_access",
} as const;

export type AllowedRpc = keyof typeof RPC_ALLOWLIST;

export class RpcNotAllowedError extends Error {
  constructor(name: string) {
    super(`RPC not allowed from a customer tool: ${name}`);
    this.name = "RpcNotAllowedError";
  }
}

/** Call an allowlisted function through the caller's own client. */
export async function callRpc<T = unknown>(
  ctx: ToolContext,
  name: AllowedRpc,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { message?: string; code?: string } | null }> {
  if (!Object.hasOwn(RPC_ALLOWLIST, name)) throw new RpcNotAllowedError(name);
  const db = ctx.db as SupabaseClient;
  const { data, error } = await db.rpc(name, args);
  return { data: (data as T) ?? null, error: error ?? null };
}

/**
 * Feature permission of the CALLER in the TOKEN's org (two-argument form — the one-argument
 * overload resolves the user's FIRST org and is wrong for multi-org users).
 */
export async function callerHasFeature(ctx: ToolContext, featureKey: string): Promise<boolean> {
  const { data, error } = await callRpc<boolean>(ctx, "has_feature_permission", {
    p_feature_key: featureKey,
    p_org_id: ctx.orgId,
  });
  return !error && data === true;
}
