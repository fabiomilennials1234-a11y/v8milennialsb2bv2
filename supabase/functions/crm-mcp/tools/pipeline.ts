/**
 * Funnel structure: `pipeline.list` and `stage.list` (C3).
 *
 * Names come from `pipelines.name` — the canonical funnel name since ADR-0034
 * (`pipeline_display_config` is a legacy seed and no longer feeds any label). Stages are
 * keyed by `pipeline_id`; the few legacy rows that only carry `pipeline_type` belong to the
 * Carteira facet, which is not a funnel and is not listed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import {
  dbErrorResult,
  errorResult,
  jsonResult,
  optionalUuid,
  READ_ONLY,
  resolveOrgScope,
} from "./shared.ts";

export const customerPipelineListTool: ToolDef = {
  name: "pipeline.list",
  description:
    "List the funnels (pipelines) of your organization, in the order the team arranged them. " +
    "Use the returned id with stage.list and lead.list. Inactive funnels are omitted unless " +
    "include_inactive is true.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "List funnels" },
  inputSchema: {
    type: "object",
    properties: {
      include_inactive: { type: "boolean", description: "Also list archived funnels" },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);

    const db = ctx.db as SupabaseClient;
    let req = db
      .from("pipelines")
      .select("id,name,slug,type,description,is_active,display_order")
      .eq("organization_id", scope.orgId);
    if (args.include_inactive !== true) req = req.eq("is_active", true);

    const { data, error } = await req
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(200);
    if (error) return dbErrorResult(error);
    const pipelines = data ?? [];
    return jsonResult({ count: pipelines.length, pipelines });
  },
};

export const customerStageListTool: ToolDef = {
  name: "stage.list",
  description: "List the stages of one funnel in board order (pipeline_id from pipeline.list). " +
    "stage_role tells which stages count as won/lost. Use stage_key with lead.list.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "List funnel stages" },
  inputSchema: {
    type: "object",
    properties: {
      pipeline_id: { type: "string", description: "Funnel UUID" },
    },
    required: ["pipeline_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const pipelineId = optionalUuid(args.pipeline_id);
    if (!pipelineId || pipelineId === "invalid") return errorResult("pipeline_id must be a UUID.");

    const db = ctx.db as SupabaseClient;
    const { data, error } = await db
      .from("pipeline_stages")
      .select("id,stage_key,name,position,stage_role,is_final_positive,is_final_negative,sla_hours")
      .eq("organization_id", scope.orgId)
      .eq("pipeline_id", pipelineId)
      .eq("is_active", true)
      .order("position", { ascending: true })
      .limit(200);
    if (error) return dbErrorResult(error);
    const stages = data ?? [];
    if (stages.length === 0) {
      return jsonResult({
        count: 0,
        stages,
        note: "No stages visible: the funnel does not exist in your organization, has no active " +
          "stages, or your user cannot see it.",
      });
    }
    return jsonResult({ count: stages.length, stages });
  },
};
