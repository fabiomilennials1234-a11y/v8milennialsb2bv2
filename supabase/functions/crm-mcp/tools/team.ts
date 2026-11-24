/**
 * team.list (fatia 7 do v2) — the people of the org, so the AI can turn "the Ana's leads" into
 * the team member id the owner/assignee filters take, and name who owns what.
 *
 * Reads `org_visible_members` (runs as the caller; hides master users) and selects ONLY id,
 * name, role, job title and status — team_members also carries pay columns (ote_*,
 * commission_*) that must never reach an AI.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { dbErrorResult, errorResult, jsonResult, READ_ONLY, resolveOrgScope } from "./shared.ts";

export const TEAM_COLUMNS = "id,name,role,job_title,is_active";

export const customerTeamListTool: ToolDef = {
  name: "team.list",
  description:
    "The people of your organization: team member id (what assigned_to/owner filters take), " +
    "name, role and job title. Active members only, unless include_inactive.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "List team" },
  inputSchema: {
    type: "object",
    properties: { include_inactive: { type: "boolean" } },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    let q = (ctx.db as SupabaseClient)
      .from("org_visible_members")
      .select(TEAM_COLUMNS)
      .eq("organization_id", scope.orgId);
    if (args.include_inactive !== true) q = q.eq("is_active", true);
    const { data, error } = await q.order("name", { ascending: true }).limit(500);
    if (error) return dbErrorResult(error);
    return jsonResult({ count: (data ?? []).length, members: data ?? [] });
  },
};
